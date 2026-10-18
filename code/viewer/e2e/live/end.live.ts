/**
 * How a real share ends on the page: Stop, its timer and its 1-hour limit, enforced by the server
 * (the rules refuse its pings from the due time, whatever the session document says yet), on a page
 * whose own clock may be behind; then a link opened after the end, one that matches nothing, and one
 * too many browsers have opened. No location ever moves after the end.
 */

import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { axe, describeViolations, launch, open, plain, shot, waitForHeading, waitForStatus, waitForText } from '../harness';
import { call, newShare, north, patchSession, ping, realProblems, stopShare, walk, type Share } from './emulators';
import { stubMaps } from './maps-stub';

const LIVE = 'Alex is sharing their location with you';
/** Chrome logs a refused callable (404, 400, 429) as a failed resource; the page itself says nothing more. */
const refused = (p: string): boolean =>
  /^HTTP 4(00|04|29): \S+\/redeemLinkToken$/.test(p) || /^console error: Failed to load resource: the server responded with a status of 4(00|04|29)/.test(p);
const HERE = { lat: 37.79548, lng: -122.39367 };
const HOUR = 3_600_000;

let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser.close();
});

/** "9:41 pm", as the page writes a time in the tests' locale and time zone. */
function clock(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('hour')}:${get('minute')} ${get('dayPeriod').toLowerCase()}`;
}

const markerAt = (page: Page): Promise<string | null> => page.locator('.mk.sharer').getAttribute('style');
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The end leaves the last location in place: a ping written after it (bypassing the rules) never shows. */
async function nothingMovesAfter(page: Page, share: Share): Promise<boolean> {
  const before = await markerAt(page);
  await ping(share, north(HERE, 300));
  await wait(3000);
  return (await markerAt(page)) === before;
}

/** Brings the session's due end to `ms` from now, keeping it a valid session (started an hour before its limit). */
async function endsIn(share: Share, ms: number, by: 'limit' | 'timer'): Promise<Date> {
  const end = new Date(Date.now() + ms);
  if (by === 'limit') await patchSession(share, { expires_at: end, started_at: new Date(end.getTime() - HOUR) });
  else await patchSession(share, { stop_at: end });
  return end;
}

describe.concurrent('the end of a share', () => {
  it('Stop: says who stopped and when, announces it once as an alert, and the marker stays put', async ({ expect }) => {
    const share = await newShare();
    const walker = walk(share, HERE);
    const { page, context, problems } = await open(browser, { path: share.path, prepare: stubMaps });
    try {
      await waitForText(page, 'Near The Embarcadero');
      await walker.stop();
      await stopShare(share);
      await waitForHeading(page, /^Alex stopped sharing at \d{1,2}:\d{2} [ap]m$/);
      await waitForStatus(page, 'Alex stopped sharing.', '#alert');
      expect(plain(await page.title())).toBe('Alex stopped sharing · Track Me Live');
      await waitForText(page, 'It won’t move again.');
      expect(await page.locator('.mk.sharer.seen').count()).toBe(1);
      expect(await page.locator('[data-act="show-sharer"], a[data-key="maps"]').count()).toBe(0);
      expect(await nothingMovesAfter(page, share)).toBe(true);
      expect(describeViolations(await axe(page))).toEqual([]);
      await shot(page, 'live/stopped');
      expect(realProblems(problems)).toEqual([]);
    } finally {
      await walker.stop();
      await context.close();
    }
  });

  it('the 1-hour limit: ends at expires_at even while the session still says active; reopening finds it over', async ({ expect }) => {
    const share = await newShare();
    const walker = walk(share, HERE);
    const { page, context, problems } = await open(browser, { path: share.path, prepare: stubMaps });
    try {
      await waitForHeading(page, LIVE);
      const end = await endsIn(share, 6000, 'limit');
      await waitForText(page, `Sharing stops at ${clock(end)}.`);
      await waitForHeading(page, `Sharing ended at ${clock(end)}`);
      await walker.stop();
      await waitForStatus(page, 'Sharing ended.', '#alert');
      expect(plain(await page.locator('.glassbar').innerText())).toContain(`Sharing ended at ${clock(end)}`);
      expect(await nothingMovesAfter(page, share)).toBe(true);
      expect(describeViolations(await axe(page))).toEqual([]);
      await shot(page, 'live/limit');

      // The server refuses the link from expires_at on: a reload shows no location at all.
      await page.reload();
      await waitForHeading(page, 'This location is no longer being shared');
      await waitForText(page, 'Ask Alex to share again if you still need it.');
      expect(await page.locator('#map').isVisible()).toBe(false);
      expect(realProblems(problems).filter((p) => !refused(p))).toEqual([]);
    } finally {
      await walker.stop();
      await context.close();
    }
  });

  it('the timer: ends at stop_at the same way', async ({ expect }) => {
    const share = await newShare();
    const walker = walk(share, HERE);
    const { page, context, problems } = await open(browser, { path: share.path, prepare: stubMaps });
    try {
      await waitForHeading(page, LIVE);
      const end = await endsIn(share, 6000, 'timer');
      await waitForText(page, `Visible until ${clock(end)}.`);
      await waitForHeading(page, `Sharing ended at ${clock(end)}`);
      await walker.stop();
      await waitForStatus(page, 'Sharing ended.', '#alert');
      expect(await nothingMovesAfter(page, share)).toBe(true);
      expect(realProblems(problems)).toEqual([]);
    } finally {
      await walker.stop();
      await context.close();
    }
  });

  it('a page whose clock is behind still ends at the server’s end, never as “signal dropped”', async ({ expect }) => {
    const share = await newShare();
    const walker = walk(share, HERE);
    // This browser's clock runs 40 s behind the server's.
    const behind = `(() => { const R = Date; const skew = -40000;
      class D extends R { constructor(...a) { if (a.length === 0) super(R.now() + skew); else super(...a); } static now() { return R.now() + skew; } }
      window.Date = D; })();`;
    const { page, context, problems } = await open(browser, { path: share.path, prepare: stubMaps, initScript: behind });
    try {
      await waitForHeading(page, LIVE);
      const end = await endsIn(share, 5000, 'limit');
      await wait(Math.max(0, end.getTime() - Date.now()) + 1000);
      await walker.stop();
      // Listening again after the end (a dropped connection) is refused by the rules.
      await context.setOffline(true);
      await wait(1500);
      await context.setOffline(false);
      await waitForHeading(page, `Sharing ended at ${clock(end)}`);
      expect(await page.evaluate(() => Date.now())).toBeLessThan(end.getTime());
      expect(await page.locator('.mk.sharer.seen').count()).toBe(1);
      expect(realProblems(problems).filter((p) => !/@firebase\/firestore|net::ERR_INTERNET_DISCONNECTED/.test(p))).toEqual([]);
    } finally {
      await walker.stop();
      await context.close();
    }
  });

  it('a link opened after the share ended shows no location, only whose it was', async ({ expect }) => {
    const share = await newShare();
    await ping(share, HERE);
    await stopShare(share);
    const { page, context, problems } = await open(browser, { path: share.path, prepare: stubMaps });
    try {
      await waitForHeading(page, 'This location is no longer being shared');
      expect(plain(await page.title())).toBe('Location no longer shared · Track Me Live');
      expect(await page.locator('#map').isVisible()).toBe(false);
      expect(await page.locator('main .ring img').getAttribute('src')).toBe('/mascots/fox.png');
      expect(describeViolations(await axe(page))).toEqual([]);
      expect(realProblems(problems).filter((p) => !refused(p))).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it('a link that matches no session doesn’t work', async ({ expect }) => {
    const { page, context, problems } = await open(browser, { path: '/s/AAAAAAAAAAAAAAAAAAAAAA', prepare: stubMaps });
    try {
      await waitForHeading(page, 'This link doesn’t work');
      expect(await page.locator('#map').isVisible()).toBe(false);
      expect(describeViolations(await axe(page))).toEqual([]);
      expect(realProblems(problems).filter((p) => !refused(p))).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it('a link too many browsers have opened can’t be opened here, with Try again', async ({ expect }) => {
    const share = await newShare();
    await ping(share, HERE);
    // Ten browsers have it already (the cap): each redeem without a sign-in is a new browser.
    for (let i = 0; i < 10; i++) await call('redeemLinkToken', { link_token: share.token });
    const { page, context, problems } = await open(browser, { path: share.path, prepare: stubMaps });
    try {
      await waitForHeading(page, 'This link can’t be opened right now');
      expect(await page.locator('button[data-act="reload"]').isVisible()).toBe(true);
      expect(describeViolations(await axe(page))).toEqual([]);
      expect(realProblems(problems).filter((p) => !refused(p))).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
