/**
 * Gate G2, the browser half: a fake sharer shares a simulated walk through the real backend, and
 * Chrome follows the link (FSD §4 Live map link, Stop sharing, Auto-expiry, Where Alex is in words;
 * §7 Performance and Offline behavior; prototype/: the Mom page).
 *
 *   code/backend/scripts/with-test-emulators.sh npm --prefix code/qa/e2e-sharing run test:viewer
 *   npm --prefix code/qa/e2e-sharing run test:viewer            (the dev set; its dev scheduler must run)
 *
 * Every wait is on a condition. Pings follow FSD §7's cadence (one every 3 s); each must reach the page
 * within 5 s of capture. TML_LATENCY=soft reports a slower one instead of failing (a loaded machine).
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Browser } from 'playwright-core';
import { LIVE_STALE_MIN_SECONDS, LIVE_STALE_PING_INTERVALS } from '../../../shared/schema/generated/ts/schema.ts';
import { loadRoute, positionAt, type Route } from '../../routes/route.ts';
import { FakeSharer, WriteRefused, type Session, type WrittenPing } from '../../fake-sharer/src/sharer.ts';
import { at, clock, launchChrome, openPage, setName, shot, startViewer, stopDue, until, type Opened, type Viewer } from './harness.ts';
import { onlyShows, readViewer, showsAt, type ViewerState } from './probe.ts';
import { redeemAsWatcher } from './watcher.ts';

const INTERVAL_S = 3;
/** FSD §7: both maps reflect a new ping within 5 seconds of capture. */
const PING_TO_PAGE_MS = 5000;
const NAME = 'Alex';

let viewer: Viewer;
let browser: Browser;
const opened: Opened[] = [];

before(async () => {
  viewer = await startViewer();
  browser = await launchChrome();
  console.log(`# emulator set: ${setName()} (${viewer.set.projectId}); viewer: ${viewer.base}`);
});

after(async () => {
  await browser?.close();
  await viewer?.close();
});

async function open(url: string): Promise<Opened> {
  const o = await openPage(browser, url);
  opened.push(o);
  return o;
}

/** No uncaught errors and no console errors on the page. */
function assertClean(o: Opened, what: string): void {
  assert.deepEqual(o.errors, [], `${what}: the page logged errors`);
}

/** Writes a ping, then waits until the page shows Alex there; returns the ping and how long it took from capture. */
async function pingAndSee(sharer: FakeSharer, session: Session, o: Opened, route: Route, routeT: number): Promise<{ ping: WrittenPing; ms: number; view: ViewerState }> {
  const p = positionAt(route, routeT);
  const ping = await sharer.ping(session, { lat: p.lat, lng: p.lng, accuracy_m: p.accuracy_m }, { interval_s: INTERVAL_S });
  await until(() => readViewer(o.page), (v) => v.kind === 'page' && showsAt(v, ping), `the page to show ${NAME} at ping ${ping.lat},${ping.lng} (route ${String(routeT)} s)`);
  const ms = Date.now() - ping.recorded_at.getTime();
  // The marker moves on the map's next frames; read it once the map has settled.
  const view = await until(() => readViewer(o.page), (v) => !v.moving, 'the map to settle');
  return { ping, ms, view };
}

function checkLatency(samples: readonly number[], what: string): void {
  const worst = Math.max(...samples);
  console.log(`# ${what}: ping to page ${samples.map((ms) => `${String(ms)} ms`).join(', ')} (worst ${String(worst)} ms; FSD §7 allows ${String(PING_TO_PAGE_MS)})`);
  if (process.env.TML_LATENCY === 'soft') return;
  assert.ok(worst <= PING_TO_PAGE_MS, `${what}: a ping took ${String(worst)} ms to reach the page; FSD §7 allows ${String(PING_TO_PAGE_MS)} ms`);
}

/**
 * Pings along the route at the FSD cadence until the server refuses one because the session is over.
 * Returns the refusal and the last ping it took.
 */
async function pingUntilRefused(sharer: FakeSharer, session: Session, route: Route, first: WrittenPing, deadline: number): Promise<{ refused: WriteRefused; last: WrittenPing }> {
  let last = first;
  for (let k = 1; ; k++) {
    // FSD §7 cadence, counted from the last ping: the rules refuse pings under 2 s apart.
    await at(last.recorded_at.getTime() + INTERVAL_S * 1000);
    const p = positionAt(route, k * 20);
    try {
      last = await sharer.ping(session, { lat: p.lat, lng: p.lng, accuracy_m: p.accuracy_m }, { interval_s: INTERVAL_S });
    } catch (e) {
      if (e instanceof WriteRefused) return { refused: e, last };
      throw e;
    }
    if (Date.now() > deadline) throw new Error('the server still took pings after the session was due to end');
  }
}

async function expectExpiredPage(url: string, what: string): Promise<void> {
  const o = await open(url);
  const v = await until(() => readViewer(o.page), (s) => s.kind === 'message', `${what}: a fresh open to show a message page`);
  assert.equal(v.heading, 'This location is no longer being shared', `${what}: heading`);
  assert.equal(v.detail, `Ask ${NAME} to share again if you still need it.`, `${what}: detail`);
  assert.ok(!v.marker?.shown, `${what}: a fresh open must not show a marker`);
  assert.deepEqual(v.coordinates, [], `${what}: a fresh open must show no coordinates`);
  await shot(o.page, `${what.replace(/\W+/g, '-')}-reopened`);
  assertClean(o, `${what} (reopened)`);
  await o.context.close();
}

describe('Gate G2: Chrome follows a live share', { concurrency: true }, () => {
  test('follows a walk live, shows Last seen when pings stop, then the stopped state; no location after Stop', async () => {
    const route = loadRoute('walk-ferry-building');
    const sharer = await FakeSharer.signIn({ profile: { name: NAME } });
    try {
      const session = await sharer.share({ stop_rule: 'minutes', stop_minutes: 30 });
      assert.ok(session.stopAt, 'a 30-minute share has a stop_at');

      // The first ping, then the link opens (as Mom taps it a moment after it arrives).
      let first = await sharer.ping(session, positionAt(route, 0), { interval_s: INTERVAL_S });
      const o = await open(viewer.url(session.linkToken));
      let v = await until(() => readViewer(o.page), (s) => s.kind === 'page' && showsAt(s, first), `the live page at the first ping`, 45_000);
      assert.equal(v.heading, `${NAME} is sharing their location with you`);
      assert.match(v.status, /^Live · updated /);
      assert.match(v.where, /^(Near|In) \S/, 'the where line names where Alex is');
      assert.equal(v.sub, `Visible until ${clock(session.stopAt.getTime())}.`);
      assert.ok(v.marker?.shown && v.marker.onScreen, 'the marker is on screen');
      assert.match(v.marker.phrase, /^Alex, live, /);
      assert.equal(v.marker.label, NAME);
      await shot(o.page, 'follow-1-live');

      // Along the route at FSD cadence: the marker follows every ping, and the where line keeps up.
      const latency: number[] = [];
      const positions: string[] = [`${v.marker.x.toFixed(0)},${v.marker.y.toFixed(0)}`];
      let lastPing = first;
      for (const routeT of [60, 120, 180, 240]) {
        await at(lastPing.recorded_at.getTime() + INTERVAL_S * 1000);
        const r = await pingAndSee(sharer, session, o, route, routeT);
        latency.push(r.ms);
        lastPing = r.ping;
        v = r.view;
        assert.match(v.status, /^Live · updated /, `still live at route ${String(routeT)} s`);
        assert.match(v.where, /^(Near|In) \S/, `the where line at route ${String(routeT)} s`);
        assert.ok(v.marker?.shown && v.marker.onScreen, `the marker is on screen at route ${String(routeT)} s`);
        assert.match(v.marker.phrase, /^Alex, live, /);
        positions.push(`${v.marker.x.toFixed(0)},${v.marker.y.toFixed(0)}`);
      }
      checkLatency(latency, 'walk');
      console.log(`# marker on screen: ${positions.join(' → ')}`);
      assert.ok(new Set(positions).size > 1, `the marker moved on screen along the walk: ${positions.join(' → ')}`);
      await shot(o.page, 'follow-2-moved');

      // Pings stop: Live while the newest ping is under 3 intervals old (at least 15 s), then Last seen (FSD §7).
      const staleAfterMs = Math.max(LIVE_STALE_PING_INTERVALS * INTERVAL_S, LIVE_STALE_MIN_SECONDS) * 1000;
      const seenAt = clock(lastPing.recorded_at.getTime());
      v = await until(() => readViewer(o.page), (s) => s.status !== '' && !s.status.startsWith('Live'), 'the page to stop saying Live', staleAfterMs + 15_000);
      const flippedAfter = Date.now() - lastPing.recorded_at.getTime();
      assert.equal(v.status, `Last seen ${seenAt}`);
      assert.ok(flippedAfter >= staleAfterMs - 1000, `Last seen came after ${String(flippedAfter)} ms; the FSD keeps Live for ${String(staleAfterMs)} ms`);
      assert.equal(v.heading, `${NAME}’s signal dropped`);
      assert.match(v.where, /^Last seen (near|in|at) /);
      assert.ok(v.marker?.seen, 'the marker shows last seen');
      assert.equal(v.marker.label, `Last seen ${seenAt}`);
      assert.ok(showsAt(v, lastPing), 'Open in Maps still opens the last place Alex was seen');
      await shot(o.page, 'follow-3-last-seen');

      // A new ping brings Alex back to Live.
      const back = await pingAndSee(sharer, session, o, route, 300);
      assert.match(back.view.status, /^Live · updated /);
      first = back.ping;

      // A second browser on the same link can read the pings while the session is live.
      const watcher = await redeemAsWatcher(viewer.set, session.linkToken);
      assert.equal(watcher.role, 'watcher', 'the page redeemed first, so this browser only watches');
      const live = await watcher.pings();
      assert.equal(live.status, 200, 'a watcher reads pings while live');
      assert.ok(live.count >= 6, `a watcher sees the pings (got ${String(live.count)})`);

      // Stop.
      const stopped = await sharer.stop(session);
      assert.equal(stopped.end_reason, 'stopped');
      const endedAt = clock(stopped.ended_at);
      v = await until(() => readViewer(o.page), (s) => s.heading === `${NAME} stopped sharing at ${endedAt}`, 'the stopped state');
      assert.equal(v.title, `${NAME} stopped sharing · Track Me Live`);
      assert.equal(v.status, `Sharing ended at ${endedAt}`);
      assert.ok(v.ended, 'the Ended pill shows');
      assert.equal(v.sub, `The map shows where ${NAME} was when sharing stopped. It won’t move again.`);
      assert.equal(v.maps, null, 'Open in Maps is gone once sharing ended');
      assert.ok(v.marker?.seen, 'the marker is a last-seen marker');
      assert.equal(v.marker.label, `Last seen ${endedAt}`);
      assert.match(v.marker.phrase, /when sharing stopped/);
      await shot(o.page, 'follow-4-stopped');

      // No location after the end: the rules refuse the sharer's ping and the viewer's read alike.
      const p = positionAt(route, 360);
      await assert.rejects(sharer.ping(session, { lat: p.lat, lng: p.lng, accuracy_m: p.accuracy_m }), WriteRefused, 'a ping after Stop is refused');
      const afterStop = await watcher.pings();
      assert.equal(afterStop.status, 403, 'a viewer can no longer read pings once sharing ended');
      v = await readViewer(o.page);
      assert.ok(onlyShows(v, first), `the ended page shows only where Alex was last seen: ${JSON.stringify(v.coordinates)}`);
      assertClean(o, 'the followed page');
      await o.context.close();

      // Opened again, the link says it's over, with no map position at all.
      await expectExpiredPage(viewer.url(session.linkToken), 'after Stop');
    } finally {
      await sharer.close();
    }
  });

  test('ends at its timer, enforced by the server', async () => {
    const route = loadRoute('drive-embarcadero-south');
    const sharer = await FakeSharer.signIn({ profile: { name: NAME } });
    try {
      // TEST-ONLY shortcut: a 15-minute timer, backdated so it ends 20 s from now.
      const session = await sharer.share({ stop_rule: 'minutes', stop_minutes: 15, end_in_s: 20 });
      const stopAt = session.stopAt?.getTime() ?? NaN;
      const ping = await sharer.ping(session, positionAt(route, 0), { interval_s: INTERVAL_S });
      const o = await open(viewer.url(session.linkToken));
      let v = await until(() => readViewer(o.page), (s) => s.kind === 'page' && showsAt(s, ping), 'the live page', 45_000);
      assert.equal(v.sub, `Visible until ${clock(stopAt)}.`);
      await shot(o.page, 'timer-1-live');

      const { refused, last } = await pingUntilRefused(sharer, session, route, ping, stopAt + 10_000);
      assert.ok(refused.over && Date.now() >= stopAt, `the server refused a ping only once the timer passed (${refused.message})`);
      await stopDue(stopAt);
      const ended = await until(() => sharer.read(session.id), (s) => s.status === 'stopped', 'the stop job to end the session', 30_000);
      assert.equal(ended.end_reason, 'timer');
      assert.equal(ended.ended_at?.getTime(), stopAt, 'ended_at is when the timer was due, not when the job ran');

      v = await until(() => readViewer(o.page), (s) => s.heading === `Sharing ended at ${clock(stopAt)}`, 'the ended state');
      assert.equal(v.title, 'Sharing ended · Track Me Live');
      assert.equal(v.status, `Sharing ended at ${clock(stopAt)}`);
      assert.ok(v.ended, 'the Ended pill shows');
      assert.equal(v.maps, null, 'Open in Maps is gone');
      assert.ok(onlyShows(v, last), `after the end the page shows only where Alex was last seen: ${JSON.stringify(v.coordinates)}`);
      await shot(o.page, 'timer-2-ended');
      assertClean(o, 'the timer page');
      await o.context.close();
      await expectExpiredPage(viewer.url(session.linkToken), 'after the timer');
    } finally {
      await sharer.close();
    }
  });

  test('warns, then ends at the 1-hour limit, enforced by the server', async () => {
    const route = loadRoute('stopgo-market-street');
    const sharer = await FakeSharer.signIn({ profile: { name: NAME } });
    try {
      // TEST-ONLY shortcut: started 59 min 35 s ago, so the 1-hour limit is 25 s away.
      const session = await sharer.share({ stop_rule: 'limit', limit_in_s: 25 });
      const limit = session.expiresAt.getTime();
      assert.equal(session.stopAt?.getTime(), limit, 'stop_at is the limit');
      const ping = await sharer.ping(session, positionAt(route, 0), { interval_s: INTERVAL_S });
      const o = await open(viewer.url(session.linkToken));
      let v = await until(() => readViewer(o.page), (s) => s.kind === 'page' && showsAt(s, ping), 'the live page', 45_000);
      // FSD §4 1-hour warning: the viewer's page shows "Sharing stops at 10:38 pm" in the last 5 minutes.
      assert.equal(v.sub, `Sharing stops at ${clock(limit)}.`);
      await shot(o.page, 'limit-1-warning');

      const { refused, last } = await pingUntilRefused(sharer, session, route, ping, limit + 10_000);
      assert.ok(refused.over && Date.now() >= limit, `the server refused a ping only at the limit (${refused.message})`);
      await stopDue(limit);
      const ended = await until(() => sharer.read(session.id), (s) => s.status === 'stopped', 'the stop job to end the session', 30_000);
      assert.equal(ended.end_reason, 'limit');
      assert.equal(ended.ended_at?.getTime(), limit, 'ended_at is the 1-hour limit');

      v = await until(() => readViewer(o.page), (s) => s.heading === `Sharing ended at ${clock(limit)}`, 'the ended state');
      assert.equal(v.status, `Sharing ended at ${clock(limit)}`);
      assert.equal(v.maps, null, 'Open in Maps is gone');
      assert.ok(onlyShows(v, last), `after the end the page shows only where Alex was last seen: ${JSON.stringify(v.coordinates)}`);
      await shot(o.page, 'limit-2-ended');
      assertClean(o, 'the limit page');
      await o.context.close();
      await expectExpiredPage(viewer.url(session.linkToken), 'after the limit');
    } finally {
      await sharer.close();
    }
  });

  test('a link that matches no session says so', async () => {
    const o = await open(viewer.url('AAAAAAAAAAAAAAAAAAAAAA'));
    const v = await until(() => readViewer(o.page), (s) => s.kind === 'message', 'a message page');
    assert.equal(v.heading, 'This link doesn’t work');
    assert.ok(!v.marker?.shown, 'no marker');
    assertClean(o, 'the invalid link page');
    await o.context.close();
  });
});
