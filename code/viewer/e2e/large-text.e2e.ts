/**
 * 200% text (the browser's text-size setting) and 2× zoom (a 390×844 phone at 200%: 195×422 CSS px).
 * The map always keeps a band of 160px or more; when the page needs more room than that leaves, it
 * becomes one column that scrolls as a whole, with the bar stuck on top and the bar and sheet solid.
 * Nothing scrolls sideways or gets cut off, every target stays 48px or more, and when focus moves,
 * its target lands in view, never under the bar or off screen.
 */

import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  axe,
  describeViolations,
  focused,
  launch,
  open,
  PHONE,
  shot,
  smallTargets,
  until,
  waitForHeading,
  waitForText,
  ZOOMED,
  type OpenOptions,
} from './harness';

const LIVE = 'Alex is sharing their location with you';

const MODES: readonly { readonly name: string; readonly options: OpenOptions }[] = [
  { name: 'text-200', options: { viewport: PHONE, textScale: 2 } },
  { name: 'zoom-200', options: { viewport: ZOOMED } },
];

const STATES: readonly { readonly state: string; readonly heading: string | RegExp; readonly page: boolean; readonly shows?: string }[] = [
  { state: 'offer', heading: LIVE, page: true },
  { state: 'both', heading: 'You’re both live', page: true },
  { state: 'denied', heading: LIVE, page: true, shows: 'Location is off for this page' },
  { state: 'lost-both', heading: 'Alex’s signal dropped', page: true },
  { state: 'ended', heading: /^Alex stopped sharing at /, page: true },
  { state: 'map-failed', heading: LIVE, page: true, shows: 'The map didn’t load' },
  { state: 'expired', heading: 'This location is no longer being shared', page: false },
];

let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser.close();
});

interface Layout {
  readonly tall: boolean;
  /** The page itself scrolls (one column), with no scroller inside it. */
  readonly scrolls: boolean;
  /** Surfaces the map would show through: none when solid. */
  readonly seeThrough: string[];
  readonly band: number;
  readonly sideways: string[];
  readonly barBottom: number;
  readonly headingTop: number;
}

/** Measures the column at the top of the page: the band, solid surfaces, nothing past the sides. */
const layout = (page: Page): Promise<Layout> =>
  page.evaluate(() => {
    window.scrollTo(0, 0);
    const vp = document.querySelector('main.vp');
    const seeThrough = ['.glassbar', '.sheet']
      .map((sel) => ({ sel, bg: vp?.querySelector(sel) ? getComputedStyle(vp.querySelector(sel) as Element).backgroundColor : 'missing' }))
      .filter(({ bg }) => !/^rgb\(/.test(bg))
      .map(({ sel, bg }) => `${sel}: ${bg}`);
    const width = document.documentElement.clientWidth;
    const sideways = [...document.querySelectorAll('main *, main')]
      .filter((el) => !el.closest('.sr-only') && el.getClientRects().length > 0)
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.right > width + 0.5 || r.left < -0.5;
      })
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
    if (document.documentElement.scrollWidth > width) sideways.push('the page scrolls sideways');
    return {
      tall: vp?.classList.contains('tall') ?? false,
      scrolls: document.documentElement.scrollHeight > window.innerHeight,
      seeThrough,
      band: vp?.querySelector('.vp-gap')?.getBoundingClientRect().height ?? 0,
      sideways,
      barBottom: vp?.querySelector('.glassbar')?.getBoundingClientRect().bottom ?? 0,
      headingTop: document.querySelector('main h1')?.getBoundingClientRect().top ?? 0,
    };
  });

/** Where the focused element sits: below the bar and inside the window, or not. */
const focusInView = (page: Page): Promise<{ top: number; bottom: number; barBottom: number; height: number }> =>
  page.evaluate(() => {
    const r = document.activeElement?.getBoundingClientRect();
    return {
      top: r?.top ?? -1,
      bottom: r?.bottom ?? -1,
      barBottom: document.querySelector('main .glassbar')?.getBoundingClientRect().bottom ?? 0,
      height: window.innerHeight,
    };
  });

for (const mode of MODES) {
  describe.concurrent(mode.name, () => {
    for (const s of STATES) {
      it(s.state, async ({ expect }) => {
        const { page, context, problems } = await open(browser, { state: s.state, ...mode.options });
        try {
          await waitForHeading(page, s.heading);
          if (s.shows) await waitForText(page, s.shows);
          const l = await layout(page);
          expect(l.sideways).toEqual([]);
          if (s.page) {
            // The map always keeps its band; a page that needs more room scrolls as one solid column.
            expect(l.band).toBeGreaterThanOrEqual(159.5);
            if (l.tall) expect(l).toMatchObject({ scrolls: true, seeThrough: [] });
            expect(l.headingTop).toBeGreaterThanOrEqual(l.barBottom);
          }
          expect(await smallTargets(page)).toEqual([]);
          expect(describeViolations(await axe(page))).toEqual([]);
          await shot(page, `large/${mode.name}-${s.state}`);
          if (s.page) {
            await page.evaluate(() => {
              window.scrollTo(0, document.documentElement.scrollHeight);
            });
            await shot(page, `large/${mode.name}-${s.state}-end`);
          }
          expect(problems).toEqual([]);
        } finally {
          await context.close();
        }
      });
    }

    it('focus moves land in view, below the bar', async ({ expect }) => {
      const { page, context, problems } = await open(browser, { state: 'offer', ...mode.options });
      try {
        await waitForHeading(page, LIVE);
        const share = page.getByRole('button', { name: 'Share my location', exact: true });
        await share.focus();
        await page.keyboard.press('Enter');
        await waitForHeading(page, 'You’re both live');
        await until(() => focused(page), (f) => f === 'button: Stop sharing my location', 'focus on Stop sharing my location');
        let at = await focusInView(page);
        expect(at.top).toBeGreaterThanOrEqual(at.barBottom);
        expect(at.bottom).toBeLessThanOrEqual(at.height);

        await page.waitForTimeout(450);
        await page.keyboard.press('Enter');
        await waitForHeading(page, LIVE);
        await until(() => focused(page), (f) => f === `h1: ${LIVE}`, 'focus on the heading');
        at = await focusInView(page);
        // The heading sits just under the bar: never under it, never off screen.
        expect(at.top).toBeGreaterThanOrEqual(at.barBottom);
        expect(at.top - at.barBottom).toBeLessThan(40);
        expect(at.top).toBeLessThan(at.height);
        await shot(page, `large/${mode.name}-focus-heading`);
        expect(problems).toEqual([]);
      } finally {
        await context.close();
      }
    });
  });
}
