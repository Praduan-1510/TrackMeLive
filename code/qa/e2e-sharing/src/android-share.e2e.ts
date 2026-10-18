/**
 * Gate G2, the phone half: Alex shares from the Android app on the emulator, and Chrome follows.
 *
 *   npm --prefix code/qa/e2e-sharing run test:android
 *
 * Sign-in (code/android/scripts/sign-in.sh), Home › Share live location, the share screen ("Who it's
 * for": Mom), the location explanation and the system's permission dialog, the system share sheet
 * (the link read from its preview, then Copy, which counts as sent), the alerts explanation (Not
 * now), the live screen; a route played into the emulator's GPS with `adb emu geo fix`
 * (code/qa/routes/play.ts); Chrome opening the link and following; "Mom opened your link"; Stop and its
 * confirmation; the ended state on both sides. Copy and flow follow prototype/js/android.js and
 * code/android/app/src/main/res/values/strings_*.xml.
 *
 * Needs: the Pixel_9 emulator running with the debug app installed (code/android/run.sh), the dev
 * Firebase emulators (code/backend/run.sh, which the debug app talks to) and their dev scheduler.
 * Each step is its own test; after a failed step the rest are skipped and the report says which step
 * blocked them. Screenshots of the phone and the page go to $TMPDIR/tml-e2e-sharing/.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test, type TestContext } from 'node:test';
import type { Browser } from 'playwright-core';
import { LOCK_SCRIPT, play, type SentFix } from '../../routes/play.ts';
import { distanceMeters, loadRoute } from '../../routes/route.ts';
import { APP_ID, LOCK_HELD, StepError, assertEmulatorLockHeld, checkDevice, hideKeyboard, installedAt, screenshot, shell, tap, type as typeText, waitFor, waitForNode, words, type UiNode } from './android.ts';
import { CODE_DIR, launchChrome, openPage, setName, shot, startViewer, until, type Opened, type Viewer } from './harness.ts';
import { readViewer, type ViewerState } from './probe.ts';
import { redeemAsWatcher, type Watcher } from './watcher.ts';

const NAME = 'Alex';
/** Where createSession points dev-set links (VIEWER_ORIGIN for demo-trackmelive): the viewer's dev server. */
const LINK_ORIGIN = 'http://localhost:5173';
const VIEWER_NAME = 'Mom';
const ROUTE = loadRoute('walk-ferry-building');
/** Route seconds per real second: a brisk walk, so a few pings move Alex visibly. */
const SPEED = 4;
/** A fix that left the emulator becomes a ping at most this far from it (fused location, 6-decimal fixes). */
const FIX_SLACK_M = 25;

let viewer: Viewer;
let browser: Browser;
let page: Opened | null = null;
let token = '';
let sessionId = '';
let watcher: Watcher | null = null;
const fixes: SentFix[] = [];
const player = new AbortController();
let playing: Promise<unknown> | null = null;
let blockedBy: string | null = null;
const shots = join(process.env.TML_E2E_SHOTS ?? join(tmpdir(), 'tml-e2e-sharing'), `android-${new Date().toISOString().replace(/[:.]/g, '-')}`);

/** One step of the scenario: skipped once an earlier step failed, and on failure the phone's screen is saved. */
function step(name: string, fn: (t: TestContext) => Promise<void>, timeout = 120_000): void {
  test(name, { timeout }, async (t) => {
    if (blockedBy) {
      t.skip(`blocked by: ${blockedBy}`);
      return;
    }
    try {
      await fn(t);
    } catch (e) {
      blockedBy = name;
      const path = await screenshot(shots, `failed-${name.replace(/\W+/g, '-')}`).catch(() => null);
      if (path) t.diagnostic(`phone screen: ${path}`);
      if (page) t.diagnostic(`page screen: ${await shot(page.page, `failed-page-${name.replace(/\W+/g, '-')}`).catch(() => '?')}`);
      throw e;
    }
  });
}

const run = (file: string, args: readonly string[]): Promise<string> =>
  new Promise((done, fail) => {
    execFile(file, [...args], { maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
      if (error) fail(new StepError(`${args.join(' ')} failed:\n${stdout}${stderr}`));
      else done(stdout);
    });
  });

before(async () => {
  await mkdir(shots, { recursive: true });
  if (setName() !== 'dev') throw new Error('The Android scenario runs against the dev emulator set, which the debug app talks to; not under with-test-emulators.sh.');
  assertEmulatorLockHeld();
  // Chrome opens the link exactly as the phone sent it: createSession builds dev links on the
  // viewer's dev server. Without that server, the scenario serves the page itself and opens the same token there.
  if (!process.env.TML_VIEWER_BASE) {
    const up = await fetch(`${LINK_ORIGIN}/`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false);
    if (up) process.env.TML_VIEWER_BASE = LINK_ORIGIN;
  }
  viewer = await startViewer();
  browser = await launchChrome();
  console.log(`# viewer ${viewer.base}; screenshots in ${shots}`);
});

after(async () => {
  player.abort();
  await playing?.catch(() => undefined);
  await browser?.close();
  await viewer?.close();
});

step('the emulator is up and the app is installed', async () => {
  await checkDevice();
});

let installStamp = '';

step('the app is settled: it draws its first screen', async () => {
  // The run holds the emulator lock, so nothing that takes it can install or clear the app from here on.
  // run.sh takes no lock: the install-time check after sign-in catches a reinstall from it.
  installStamp = await installedAt();
  // The first launch after an install is the slowest (the system verifies and compiles the app);
  // take it here, with room, so sign-in.sh's own waits start on an app that's quick to open.
  await shell('am', 'force-stop', APP_ID);
  await shell('am', 'start', '-W', '-n', `${APP_ID}/.MainActivity`);
  await waitFor('the app’s first screen', (nodes) => (nodes.some((n) => n.pkg === APP_ID && (n.text !== '' || n.desc !== '')) ? true : null), 90_000);
}, 180_000);

step('sign in from a fresh install to Home (sign-in.sh)', async () => {
  const number = `650555${String(randomInt(0, 10_000)).padStart(4, '0')}`;
  const signIn = [join(CODE_DIR, 'android/scripts/sign-in.sh'), '--name', NAME, '--number', number];
  // Inside this run's lock it runs as is; on its own it takes the lock for its several screens.
  await (LOCK_HELD ? run(signIn[0] as string, signIn.slice(1)) : run(LOCK_SCRIPT, ['emulator', ...signIn]));
  const now = await installedAt();
  if (now !== installStamp) throw new StepError(`the app was reinstalled during sign-in (${installStamp} → ${now}): a build finished mid-run. Run the scenario again once it's done.`);
  await waitForNode('Share live location', 'Home with "Share live location"');
  await screenshot(shots, '1-home');
});

step('start the route on the emulator GPS', async () => {
  playing = play({
    route: ROUTE,
    target: 'android',
    via: 'geo',
    speed: SPEED,
    signal: player.signal,
    log: () => undefined,
    onFix: (f) => fixes.push(f),
  });
  await until(async () => fixes.length, (n) => n >= 2, 'the first fixes to reach the emulator');
});

/**
 * The first share attempt asks for location (FSD §8; prototype app.js openShare): the app's own
 * explanation, then the system's dialog. Taps through both if they show; a grant already there skips them.
 */
async function allowLocationIfAsked(next: 'the share screen' | 'the share sheet', done: (nodes: UiNode[]) => boolean): Promise<void> {
  const seen = await waitFor(`the location explanation or ${next}`, (nodes) => (nodes.some((n) => n.text === 'Allow location to share') ? 'explain' : done(nodes) ? 'done' : null));
  if (seen === 'done') return;
  await screenshot(shots, '2-location-explanation');
  await tap('Continue', 'Continue on the location explanation');
  await tap(/^While using the app$/i, 'the system dialog’s While using the app');
  await waitFor(next, (nodes) => (done(nodes) ? true : null));
}

const linkIn = (nodes: readonly UiNode[]): { origin: string; token: string; text: string } | null => {
  for (const n of nodes) {
    const m = /(\S+)\/s\/([A-Za-z0-9_-]{22})(?![A-Za-z0-9_-])/.exec(n.text);
    if (m?.[1] && m[2]) return { origin: m[1], token: m[2], text: n.text };
  }
  return null;
};

step('Home › Share live location: the location explanation, the system permission, then the share screen', async () => {
  await tap('Share live location', 'Home’s Share live location');
  await allowLocationIfAsked('the share screen', (nodes) => nodes.some((n) => n.text === 'Share where you are'));
});

step('the share screen: Who it’s for is Mom', async () => {
  // The field is prefilled with the last name used; a fresh account has none. Clear whatever is there.
  const clear = (await waitFor('the share screen’s fields', (nodes) => (nodes.some((n) => n.text === 'Share where you are') ? nodes : null))).find((n) => n.desc === 'Clear the name');
  if (clear) await shell('input', 'tap', String(clear.x), String(clear.y));
  await tap((n) => n.cls.endsWith('EditText'), 'the Who it’s for field');
  await typeText(VIEWER_NAME);
  await waitForNode((n) => n.cls.endsWith('EditText') && n.text === VIEWER_NAME, `the name ${VIEWER_NAME} in the field`);
  await hideKeyboard();
  await screenshot(shots, '3-share-screen');
});

step('Share live location opens the system share sheet', async () => {
  // The share screen's own button sits at the bottom, over "Next, choose who gets the link."
  const button = await waitFor('the share button', (nodes) => {
    const fine = nodes.find((n) => n.text === 'Next, choose who gets the link.');
    return nodes.filter((n) => n.text === 'Share live location' || n.desc === 'Share live location').sort((a, b) => b.y - a.y).find((n) => !fine || n.y < fine.y) ?? null;
  });
  await shell('input', 'tap', String(button.x), String(button.y));
  await allowLocationIfAsked('the share sheet', (nodes) => linkIn(nodes) !== null);
});

step('the share sheet carries the link; Copy sends it', async () => {
  const link = await waitFor('the share sheet with the link', linkIn, 45_000);
  token = link.token;
  assert.match(link.text, /^I’m sharing my live location with you\. /, 'the message the sheet carries');
  assert.equal(link.origin, LINK_ORIGIN, 'dev-set links open the viewer’s dev server');
  console.log(`# link: ${link.origin}/s/${token}; Chrome opens ${viewer.url(token)}`);
  await screenshot(shots, '4-share-sheet');
  // The chooser's own copy button: "Copy text" on Android 16's sheet, "Copy" on older ones.
  await tap((n) => ['Copy text', 'Copy'].includes(n.desc) || n.text === 'Copy', 'the share sheet’s Copy button');
});

step('the alerts explanation (Turn on alerts, Allow) and the live screen', async () => {
  const where = await waitFor('the alerts explanation or the live screen', (nodes) =>
    nodes.some((n) => n.text === `Know when ${VIEWER_NAME} opens it`) ? 'alerts' : nodes.some((n) => n.text === 'Stop sharing') ? 'live' : null,
  );
  if (where === 'alerts') {
    await screenshot(shots, '5-alerts');
    await tap('Turn on alerts', 'Turn on alerts');
    // Android 13+ asks with its own dialog; an Allow that's already there skips it.
    const next = await waitFor('the notification dialog or the live screen', (nodes) => (nodes.some((n) => n.text === 'Allow') ? 'ask' : nodes.some((n) => n.text === 'Stop sharing') ? 'live' : null));
    if (next === 'ask') await tap('Allow', 'the system dialog’s Allow');
  }
  await waitForNode('Stop sharing', 'the live screen’s Stop sharing');
  await waitForNode(`Link sent to ${VIEWER_NAME}. You’ll know when it’s opened.`, 'the live sheet’s "Link sent to Mom"');
  await screenshot(shots, '6-live');
});

step('Chrome opens the link and follows the route', async () => {
  page = await openPage(browser, viewer.url(token));
  const seen: ViewerState[] = [];
  const nearAFix = (s: ViewerState): boolean => s.maps !== null && fixes.some((f) => distanceMeters(f, s.maps as { lat: number; lng: number }) <= FIX_SLACK_M);
  let v = await until(() => readViewer(page?.page as Opened['page']), (s) => s.kind === 'page' && s.maps !== null, 'the live page', 60_000);
  assert.equal(v.heading, `${NAME} is sharing their location with you`);
  assert.ok(nearAFix(v), `the page shows Alex at ${JSON.stringify(v.maps)}, which is no fix the emulator got`);
  await shot(page.page, 'android-viewer-1-live');
  // Three different places, each one a fix the phone's GPS reported.
  v = await until(
    async () => {
      const s = await readViewer(page?.page as Opened['page']);
      if (s.maps && !seen.some((p) => p.maps?.lat === s.maps?.lat && p.maps?.lng === s.maps?.lng)) seen.push(s);
      return s;
    },
    () => seen.length >= 3,
    'the page to show Alex in three places along the route',
    90_000,
  );
  for (const s of seen) assert.ok(nearAFix(s), `the page showed Alex at ${JSON.stringify(s.maps)}, which is no fix the emulator got`);
  assert.match(v.status, /^Live · updated /);
  console.log(`# followed: ${seen.map((s) => `${String(s.maps?.lat)},${String(s.maps?.lng)}`).join(' → ')}`);
  await shot(page.page, 'android-viewer-2-moved');
  watcher = await redeemAsWatcher(viewer.set, token);
  sessionId = watcher.sessionId;
  assert.equal(watcher.role, 'watcher', 'Chrome opened first, so it is the viewer and this browser only watches');
  assert.equal((await watcher.pings()).status, 200);
});

step('the phone hears that Mom opened the link', async () => {
  await waitForNode(new RegExp(`^${VIEWER_NAME} opened your link at `), '"Mom opened your link at …" on the live sheet', 45_000);
  await screenshot(shots, '7-opened');
});

/** The functions' log lines about this session's alerts. The dev set's CLI writes them to code/backend/firebase-debug.log. */
async function alertLines(): Promise<{ sent: string[]; logged: string[] }> {
  const lines = (await readFile(join(CODE_DIR, 'backend/firebase-debug.log'), 'utf8')).split('\n').filter((l) => l.startsWith('[info] >') && l.includes(`"session_id":"${sessionId}"`));
  return {
    sent: lines.filter((l) => l.includes('"message":"alert sent"') && l.includes('"kind":"link_opened"')),
    logged: lines.filter((l) => l.includes('alert (emulator: logged, not sent)')),
  };
}

step('the link-opened alert fired once, though two browsers opened the link', async (t) => {
  const { sent, logged } = await until(alertLines, (a) => a.sent.length > 0, `a link_opened alert for session ${sessionId} in the functions log`);
  assert.equal(sent.length, 1, `exactly one link_opened alert: ${JSON.stringify(sent.map((l) => l.slice(0, 300)))}`);
  const devices = /"devices":(\d+)/.exec(sent[0] ?? '')?.[1];
  t.diagnostic(`alert sent to ${devices ?? '?'} device(s); "logged, not sent" lines: ${String(logged.length)}`);
  if (devices === '0') t.diagnostic('no device doc: FCM issues no token on the demo project, so the alert has nowhere to go and "logged, not sent" never appears');
});

step('Stop sharing, confirmed', async () => {
  await tap('Stop sharing', 'Stop sharing');
  await waitForNode('Stop sharing your location?', 'the Stop sharing? dialog');
  await screenshot(shots, '8-stop-dialog');
  await tap('Stop', 'the dialog’s Stop');
});

step('the ended state on the phone and in Chrome; no location after the end', async (t) => {
  const nodes = await waitFor('the phone’s ended screen', (n) => (n.some((x) => x.text === 'Sharing ended') ? n : null));
  assert.ok(nodes.some((n) => /^You stopped sharing at /.test(n.text)), `the phone says why: ${JSON.stringify(words(nodes))}`);
  await screenshot(shots, '9-ended');
  assert.ok(page);
  const v = await until(() => readViewer(page?.page as Opened['page']), (s) => /^Alex stopped sharing at \d{1,2}:\d{2} [ap]m$/.test(s.heading), 'the page’s stopped state');
  assert.match(v.status, /^Sharing ended at /);
  assert.equal(v.maps, null, 'Open in Maps is gone');
  await shot(page.page, 'android-viewer-3-stopped');
  assert.ok(watcher);
  const session = await watcher.session();
  assert.deepEqual(session, { status: 'stopped', end_reason: 'stopped' });
  assert.equal((await watcher.pings()).status, 403, 'nobody but the sharer reads pings after the end');
  assert.deepEqual(page.errors, [], 'the page logged errors');
  for (const e of new Set(page.external)) t.diagnostic(`from Google's scripts (environment): ${e.slice(0, 300)}`);
});

step('Done goes back to Home, still signed in', async () => {
  const nodes = await waitFor('the ended summary', (n) => (n.some((x) => x.text === 'Shared with') ? n : null));
  const text = words(nodes);
  assert.ok(text.includes(VIEWER_NAME), `the summary names who it was for: ${JSON.stringify(text)}`);
  assert.ok(text.includes(`${VIEWER_NAME} opened it`), `the summary says Mom opened it: ${JSON.stringify(text)}`);
  await tap('Done', 'the ended screen’s Done');
  await waitForNode('Share live location', 'Home');
  await screenshot(shots, '10-home');
});

step('the link-opened alert still fired only once', async () => {
  assert.equal((await alertLines()).sent.length, 1);
});

step('stop the route', async () => {
  player.abort();
  await playing;
  const app = await shell('pidof', APP_ID);
  console.log(`# ${String(fixes.length)} fixes sent; app pid ${app.trim() || 'none'}`);
});
