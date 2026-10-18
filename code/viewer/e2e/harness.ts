/**
 * The end-to-end harness: the system's Google Chrome (channel 'chrome', headless) through
 * playwright-core, a phone-sized page in a fixed locale and time zone, axe-core, and screenshots.
 *
 * "200% text" is the browser's own text-size setting (CDP Page.setFontSizes), which scales rem and
 * the em in media queries alike, as Chrome's and Safari's text-size settings do. "2× zoom" is the
 * layout a 390×844 phone has at 200% zoom: 195×422 CSS pixels.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { AxeResults, Result } from 'axe-core';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { inject } from 'vitest';

export const BASE = inject('baseURL');
export const PHONE = { width: 390, height: 844 } as const;
export const ZOOMED = { width: 195, height: 422 } as const;
export const DESKTOP = { width: 1280, height: 800 } as const;
const SHOTS = fileURLToPath(new URL('../test-results/screenshots/', import.meta.url));
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
/** Records where focus goes, so a focus wait that times out can say how it got where it is. */
const FOCUS_TRACE = `window.__focusTrace = [];
const t0 = performance.now();
document.addEventListener('focusin', (e) => {
  const el = e.target;
  const what = el instanceof Element ? el.tagName.toLowerCase() + ': ' + (el.getAttribute('aria-label') || el.textContent || '').replace(/[\\u2066-\\u2069]/g, '').trim().slice(0, 40) : String(el);
  window.__focusTrace.push(Math.round(performance.now() - t0) + 'ms ' + what);
}, true);`;

/** The machine may be busy (other builds, emulators): wait generously for the page, never for long on a pass. */
const WAIT_MS = 30_000;

/**
 * Polls `read` until `ok` holds, and returns the value; throws with the last value after 30 s.
 * (Vitest's expect.poll needs the test's own expect in concurrent tests; this works anywhere.)
 */
export async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, what: string): Promise<T> {
  const end = Date.now() + WAIT_MS;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}; last: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export const launch = (): Promise<Browser> => chromium.launch({ channel: 'chrome', headless: true });

export interface OpenOptions {
  readonly state?: string;
  readonly theme?: 'light' | 'dark';
  /** Force the theme with ?theme= instead of the system setting. */
  readonly forceTheme?: boolean;
  readonly geo?: string;
  readonly path?: string;
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly textScale?: number;
  readonly motion?: 'reduce' | 'no-preference';
  readonly forcedColors?: boolean;
  readonly contrastMore?: boolean;
  readonly permissions?: readonly string[];
  readonly geolocation?: { readonly latitude: number; readonly longitude: number };
  readonly initScript?: string;
}

export interface Opened {
  readonly page: Page;
  readonly context: BrowserContext;
  /** Uncaught errors, console errors and failed requests seen so far. */
  readonly problems: string[];
}

export async function open(browser: Browser, o: OpenOptions = {}): Promise<Opened> {
  const theme = o.theme ?? 'light';
  const motion = o.motion ?? 'reduce';
  const context = await browser.newContext({
    viewport: o.viewport ?? PHONE,
    deviceScaleFactor: 2,
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    colorScheme: theme,
    reducedMotion: motion,
    forcedColors: o.forcedColors ? 'active' : 'none',
    permissions: [...(o.permissions ?? [])],
    ...(o.geolocation ? { geolocation: { ...o.geolocation } } : {}),
  });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`console ${m.type()}: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${String(r.status())}: ${r.url()}`);
  });
  await page.addInitScript(FOCUS_TRACE);
  if (o.initScript) await page.addInitScript(o.initScript);
  if (o.textScale !== undefined || o.contrastMore) {
    const cdp = await context.newCDPSession(page);
    if (o.textScale !== undefined) await cdp.send('Page.setFontSizes', { fontSizes: { standard: 16 * o.textScale, fixed: 13 * o.textScale } });
    if (o.contrastMore) {
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-contrast', value: 'more' },
          { name: 'prefers-color-scheme', value: theme },
          { name: 'prefers-reduced-motion', value: motion },
        ],
      });
    }
  }
  const params = new URLSearchParams();
  if (o.state) params.set('state', o.state);
  if (o.geo) params.set('geo', o.geo);
  if (o.forceTheme) params.set('theme', theme);
  const query = params.size > 0 ? `?${params.toString()}` : '';
  await page.goto(`${BASE}${o.path ?? '/'}${query}`);
  return { page, context, problems };
}

/** Text without the direction isolates around names. */
export const plain = (s: string | null): string => (s ?? '').replace(/[\u2066-\u2069]/g, '').trim();

export const headingText = async (page: Page): Promise<string> => plain(await page.locator('main h1').first().textContent());

export async function waitForHeading(page: Page, want: string | RegExp): Promise<void> {
  const check = typeof want === 'string' ? (t: string) => t === want : (t: string) => want.test(t);
  await until(() => headingText(page), check, `the heading ${String(want)}`);
}

/** Waits until the page's visible text includes `text`. */
export async function waitForText(page: Page, text: string): Promise<void> {
  await until(async () => plain(await page.locator('body').innerText()), (t) => t.includes(text), `"${text}" on the page`);
}

/** The element with focus, described: its tag and its text or label. */
export const focused = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return 'body';
    const text = (a.getAttribute('aria-label') ?? a.textContent).replace(/[\u2066-\u2069]/g, '').trim();
    return `${a.tagName.toLowerCase()}: ${text}`;
  });

/** Waits until the polite status region has said something matching. */
export async function waitForStatus(page: Page, want: string, region = '#status'): Promise<void> {
  await until(async () => plain(await page.locator(region).textContent()), (t) => t.includes(want), `${region} to say "${want}"`);
}

/** Holds every animation at its end while axe looks, so it judges the settled page, not a frame mid-fade. */
const SETTLED = '*, *::before, *::after { animation: none !important; transition: none !important; }';

/** Runs axe-core on the page (every rule but the experimental ones) and returns its violations. */
export async function axe(page: Page): Promise<Result[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  const settle = await page.addStyleTag({ content: SETTLED });
  try {
    const results = await page.evaluate(() => (window as unknown as { axe: { run: (c: Document) => Promise<AxeResults> } }).axe.run(document));
    return results.violations;
  } finally {
    await settle.evaluate((el) => {
      el.parentNode?.removeChild(el);
    });
  }
}

/** One line per violation and node, for a readable failure. */
export const describeViolations = (v: readonly Result[]): string[] =>
  v.flatMap((r) => r.nodes.map((n) => `${r.id} (${r.impact ?? '?'}): ${n.target.join(' ')} ${n.failureSummary ?? ''}`.trim()));

/** Every control in the page and dialogs, smaller than 48×48 CSS px. */
export const smallTargets = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('main button, main a[href], dialog button, #map [tabindex="0"]')]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width < 47.5 || r.height < 47.5)
      .map(({ el, r }) => `${el.textContent.trim() || el.className}: ${r.width.toFixed(0)}×${r.height.toFixed(0)}`),
  );

/** Waits for fonts and for the map to stop moving, then saves a screenshot. */
export async function shot(page: Page, name: string): Promise<string> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await until(() => page.locator('#map[data-moving]').count(), (n) => n === 0, 'the map to settle');
  const path = `${SHOTS}${name}.png`;
  await page.screenshot({ path });
  return path;
}
