/**
 * What every Gate G2 scenario shares: which emulator set it runs on, a viewer page server, the
 * system's Google Chrome (headless, channel 'chrome': no downloaded browsers), waits on conditions
 * (never fixed sleeps), and the server's stop job.
 *
 * Emulator sets:
 *   test  under code/backend/scripts/with-test-emulators.sh (TML_TEST_EMULATORS=1): its own project,
 *         ports and data. Nothing runs the scheduled jobs there, so stopDue() runs the real compiled
 *         stopDueSessions handler once, where a test needs a due session marked stopped.
 *   dev   otherwise: the shared dev set (code/backend/run.sh), whose dev scheduler
 *         (code/backend/scripts/dev-scheduler.sh) runs stopDueSessions every 5 s; stopDue() waits.
 *
 * The viewer: its own Vite dev server from code/viewer on a free port, configured for the set
 * through the viewer's VITE_TML_* seam (code/viewer/src/session/firebase/config.ts), with a private
 * cache folder so it never disturbs anyone's `npm run dev`. TML_VIEWER_BASE=<url> uses a viewer
 * that's already running instead (it must point at the same set).
 */

import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { emulatorSet, type EmulatorSet } from '../../fake-sharer/src/env.ts';

export const QA_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const CODE_DIR = resolve(QA_DIR, '..');
export const VIEWER_DIR = join(CODE_DIR, 'viewer');
export const BACKEND_DIR = join(CODE_DIR, 'backend');

export const TIME_ZONE = 'America/Los_Angeles';
export const PHONE = { width: 390, height: 844 } as const;

export type SetName = 'test' | 'dev';
export const setName = (): SetName => (process.env.TML_TEST_EMULATORS === '1' ? 'test' : 'dev');

/** The machine may be busy (Gradle, the Android emulator): wait generously, never for long on a pass. */
export const WAIT_MS = 30_000;

/** Polls `read` until `ok` holds and returns the value; throws with the last value after `ms`. */
export async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, what: string, ms = WAIT_MS): Promise<T> {
  const end = Date.now() + ms;
  let last: T | undefined;
  let lastError: unknown;
  for (;;) {
    try {
      last = await read();
      if (ok(last)) return last;
    } catch (e) {
      lastError = e;
    }
    if (Date.now() > end) {
      const why = lastError instanceof Error ? ` (last error: ${lastError.message})` : '';
      throw new Error(`Timed out after ${String(ms / 1000)} s waiting for ${what}; last: ${JSON.stringify(last)}${why}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Resolves at `when` (epoch ms): for keeping a ping cadence, never for waiting on a result. */
export const at = (when: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, when - Date.now())));

/** "9:41 pm" in the page's time zone, the way the viewer writes times (code/viewer/src/format/time.ts). */
export function clock(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const h = Number(parts.find((p) => p.type === 'hour')?.value);
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '??';
  return `${String(h % 12 || 12)}:${mm} ${h < 12 ? 'am' : 'pm'}`;
}

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const srv = createNetServer();
    srv.once('error', fail);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => {
        if (addr && typeof addr === 'object') done(addr.port);
        else fail(new Error('no port'));
      });
    });
  });
}

export interface Viewer {
  readonly base: string;
  readonly set: EmulatorSet;
  url(token: string): string;
  close(): Promise<void>;
}

interface ViteServer {
  listen(): Promise<unknown>;
  close(): Promise<void>;
}

/** The viewer page, served for this emulator set. */
export async function startViewer(): Promise<Viewer> {
  const set = emulatorSet();
  const url = (base: string) => (token: string) => `${base}/s/${token}`;
  const external = process.env.TML_VIEWER_BASE?.replace(/\/$/, '');
  if (external) {
    await until(
      async () => (await fetch(`${external}/`, { signal: AbortSignal.timeout(3000) })).status,
      (s) => s === 200,
      `the viewer at ${external} (TML_VIEWER_BASE) to answer`,
      10_000,
    );
    return { base: external, set, url: url(external), close: () => Promise.resolve() };
  }
  // The viewer's own mapping from an emulator set to its VITE_TML_* values, checked as the page checks them.
  const config = (await import(pathToFileURL(join(VIEWER_DIR, 'src/session/firebase/config.ts')).href)) as {
    viteEnvForEmulators(env: Record<string, string | undefined>): Record<string, string>;
  };
  const viteEnv = config.viteEnvForEmulators({
    GCLOUD_PROJECT: set.projectId,
    FIRESTORE_EMULATOR_HOST: `${set.firestore.host}:${String(set.firestore.port)}`,
    FIREBASE_AUTH_EMULATOR_HOST: `${set.auth.host}:${String(set.auth.port)}`,
    FUNCTIONS_EMULATOR_HOST: `${set.functions.host}:${String(set.functions.port)}`,
  });
  Object.assign(process.env, viteEnv);
  // No Maps key, whatever code/viewer/.env.local holds (Vite never overrides a variable already set):
  // tests must not call paid Google APIs, and the page's own place fallback is what's under test.
  process.env.VITE_MAPS_API_KEY = '';
  const require = createRequire(join(VIEWER_DIR, 'package.json'));
  let vitePath: string;
  try {
    vitePath = require.resolve('vite');
  } catch {
    throw new Error('code/viewer/node_modules is missing: run npm ci --prefix code/viewer');
  }
  const vite = (await import(pathToFileURL(vitePath).href)) as { createServer(config: Record<string, unknown>): Promise<ViteServer> };
  const cacheDir = await mkdtemp(join(tmpdir(), 'tml-qa-vite-'));
  const port = await freePort();
  const server = await vite.createServer({
    root: VIEWER_DIR,
    configFile: join(VIEWER_DIR, 'vite.config.ts'),
    mode: 'development',
    cacheDir,
    logLevel: 'warn',
    clearScreen: false,
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null },
  });
  await server.listen();
  const base = `http://127.0.0.1:${String(port)}`;
  return {
    base,
    set,
    url: url(base),
    close: async () => {
      await server.close();
      await rm(cacheDir, { recursive: true, force: true });
    },
  };
}

export const launchChrome = (): Promise<Browser> => chromium.launch({ channel: 'chrome', headless: process.env.TML_HEADED !== '1' });

export interface Opened {
  readonly page: Page;
  readonly context: BrowserContext;
  /** Uncaught errors and the page's own console errors seen so far. */
  readonly errors: string[];
  readonly warnings: string[];
  /** Console errors from Google's Maps scripts (a key's quota or billing): the environment, not the page. */
  readonly external: string[];
}

/** A phone-sized page in a fixed locale and time zone, with Reduce Motion on (no animations to wait out). */
export async function openPage(browser: Browser, url: string): Promise<Opened> {
  const context = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    locale: 'en-US',
    timezoneId: TIME_ZONE,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors: string[] = [];
  const warnings: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // Google's scripts log by URL, or (through Vite's client in a dev server) by their own prefix.
    const google = /^https:\/\/([a-z0-9-]+\.)*(googleapis|gstatic)\.com\//.test(m.location().url) || /^(Geocoding Service|Google Maps JavaScript API)\b/.test(m.text());
    if (m.type() === 'error' && google) {
      external.push(`${m.text()} (${m.location().url})`);
      return;
    }
    // "Failed to load resource" is Chrome's network log for an HTTP error status, such as a
    // callable's not-found for a dead link: an expected answer, not the page failing.
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(`console error: ${m.text()}`);
    else if (m.type() === 'warning') warnings.push(`console warning: ${m.text()}`);
  });
  await page.goto(url);
  return { page, context, errors, warnings, external };
}

let shotDir: string | null = null;
/** Saves a screenshot under $TMPDIR/tml-e2e-sharing/<run>/ and returns its path. */
export async function shot(page: Page, name: string): Promise<string> {
  if (!shotDir) {
    shotDir = join(process.env.TML_E2E_SHOTS ?? join(tmpdir(), 'tml-e2e-sharing'), new Date().toISOString().replace(/[:.]/g, '-'));
    await mkdir(shotDir, { recursive: true });
  }
  const path = join(shotDir, `${name}.png`);
  await page.screenshot({ path });
  return path;
}

type Job = { run(event: { scheduleTime: string }): Promise<unknown> };
let stopJob: Job | null = null;

/**
 * Makes sure the stop job has run since `dueAt` (epoch ms) passed. On the test set it runs the real
 * compiled stopDueSessions handler once, as Cloud Scheduler would (code/backend/tests/src/lifecycle.test.ts
 * does the same); on the dev set the dev scheduler does it every 5 s, so this only waits for the time.
 */
export async function stopDue(dueAt: number): Promise<void> {
  await at(dueAt + 50);
  if (setName() !== 'test') return;
  if (!stopJob) {
    process.env.METADATA_SERVER_DETECTION ??= 'none';
    const lib = join(BACKEND_DIR, 'functions/lib/index.js');
    const mod = (await import(pathToFileURL(lib).href)) as { stopDueSessions: Job };
    stopJob = mod.stopDueSessions;
  }
  await stopJob.run({ scheduleTime: new Date().toISOString() });
}
