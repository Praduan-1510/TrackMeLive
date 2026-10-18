/**
 * A real share, followed live: the page trades the link, follows the pings, names the street through
 * the Maps API's Geocoder (a local stand-in), says when the signal drops and comes back, draws an
 * approximate share as a circle, keeps the viewer's role across a reload, shares back, and says when
 * it's offline. Each test starts its own sharer and session on the emulator set, and pings every 4 s
 * as the sharer's app does.
 */

import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { axe, describeViolations, focused, launch, open, plain, shot, smallTargets, until, waitForHeading, waitForStatus, waitForText } from '../harness';
import { newShare, north, ping, realProblems, sessionField, viewerPingCount, walk } from './emulators';
import { blockMaps, stubMaps } from './maps-stub';

const LIVE = 'Alex is sharing their location with you';
/** By the Ferry Building, in San Francisco. */
const HERE = { lat: 37.79548, lng: -122.39367 };
/** Firestore's own notes while the network is gone. */
const OFFLINE_NOTES = /@firebase\/firestore|net::ERR_INTERNET_DISCONNECTED/;

let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser.close();
});

const markerAt = (page: Page): Promise<string | null> => page.locator('.mk.sharer').getAttribute('style');
const where = async (page: Page): Promise<string> => plain(await page.locator('.where [data-bind="where"]').textContent());
const mapsLink = (page: Page): Promise<string | null> => page.locator('a[data-key="maps"]').getAttribute('href');
/** Open in Maps for this point: Apple Maps on Apple devices (this Chrome says Macintosh), Google Maps elsewhere. */
function mapsHref(p: { lat: number; lng: number }): string {
  const ll = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  return process.platform === 'darwin' ? `https://maps.apple.com/?ll=${ll}&q=Alex` : `https://www.google.com/maps/search/?api=1&query=${ll}`;
}
const phrase = async (page: Page): Promise<string> => plain(await page.locator('.mk.sharer .disc').getAttribute('aria-label'));

describe.concurrent('following a live share', () => {
  it('trades the link, follows each ping, and names the street in words', async ({ expect }) => {
    const share = await newShare();
    const walker = walk(share, HERE);
    const { page, context, problems } = await open(browser, { path: share.path, prepare: stubMaps });
    try {
      await waitForHeading(page, LIVE);
      await waitForText(page, 'Near The Embarcadero');
      // Said once, politely, with where in words.
      await waitForStatus(page, `${LIVE}. Near The Embarcadero.`);
      expect(plain(await page.title())).toBe('Alex is sharing their location · Track Me Live');
      // The map has no streets until the Maps API draws it: a plain ground, hidden from screen readers.
      expect(await page.locator('#map svg.mapsvg.plain[aria-hidden="true"]').count()).toBe(1);
      expect(await phrase(page)).toMatch(/^Alex, live, updated /);
      expect(await page.locator('.mk.sharer.seen').count()).toBe(0);
      expect(describeViolations(await axe(page))).toEqual([]);
      expect(await smallTargets(page)).toEqual([]);
      await shot(page, 'live/following');

      // Alex walks 300 m north: the marker follows, Open in Maps follows, and the street changes.
      const before = await markerAt(page);
      const next = north(HERE, 300);
      walker.moveTo(next);
      await until(() => markerAt(page), (s) => s !== before, 'the marker to move');
      await until(() => mapsLink(page), (h) => h === mapsHref(next), 'Open in Maps to follow');
      await until(() => where(page), (t) => t === 'Near Pier Walk', 'the where line to name the new street');
      // The trail keeps where Alex was.
      expect(await page.locator('.m-trail circle').count()).toBeGreaterThan(0);

      // Show Alex: the map centers on the marker, it's said, and focus stays on the button.
      await page.locator('[data-act="show-sharer"]').click();
      await waitForStatus(page, 'Map centered on Alex.');
      expect(await focused(page)).toBe('button: Show Alex');
      expect(realProblems(problems)).toEqual([]);
    } finally {
      await walker.stop();
      await context.close();
    }
  });

  it('shows Last seen once the newest ping is three intervals old (15 s at least), then Live again', async ({ expect }) => {
    const share = await newShare();
    const walker = walk(share, HERE);
    const { page, context, problems } = await open(browser, { path: share.path, prepare: stubMaps });
    try {
      await waitForHeading(page, LIVE);
      await waitForText(page, 'Near The Embarcadero');
      // The app goes quiet. createSession's ping interval is 5 s, so the newest ping is stale after 15 s.
      await walker.stop();
      await waitForHeading(page, 'Alex’s signal dropped');
      await waitForStatus(page, 'Alex’s signal dropped. Last seen');
      expect(await page.locator('.mk.sharer.seen').count()).toBe(1);
      expect(plain(await page.locator('.mk.sharer .name').textContent())).toMatch(/^Last seen \d{1,2}:\d{2} [ap]m$/);
      expect(await phrase(page)).toMatch(/^Alex, last seen at \d{1,2}:\d{2} [ap]m$/);
      await waitForText(page, 'Last seen near The Embarcadero');
      expect(describeViolations(await axe(page))).toEqual([]);
      await shot(page, 'live/last-seen');

      await ping(share, north(HERE, 10));
      await waitForHeading(page, LIVE);
      await waitForStatus(page, 'Alex is live again.');
      expect(await page.locator('.mk.sharer.seen').count()).toBe(0);
      expect(realProblems(problems)).toEqual([]);
    } finally {
      await walker.stop();
      await context.close();
    }
  });

  it('draws an approximate share as a circle, with no trail, naming only the area', async ({ expect }) => {
    const share = await newShare({ precision: 'approximate' });
    const walker = walk(share, HERE, { accuracy: 500 });
    const { page, context, problems } = await open(browser, { path: share.path, prepare: stubMaps });
    try {
      await waitForHeading(page, LIVE);
      walker.moveTo(north(HERE, 500));
      await waitForText(page, 'In the Embarcadero area');
      expect(await page.locator('.mk.sharer.approx .area').isVisible()).toBe(true);
      expect(await phrase(page)).toMatch(/^Alex, live, approximate location, /);
      await until(() => mapsLink(page), (h) => h === mapsHref(north(HERE, 500)), 'Open in Maps to open the rounded point');
      expect(await page.locator('.m-trail circle').count()).toBe(0);
      expect(describeViolations(await axe(page))).toEqual([]);
      await shot(page, 'live/approximate');
      expect(realProblems(problems)).toEqual([]);
    } finally {
      await walker.stop();
      await context.close();
    }
  });

  it('keeps the first browser the viewer across a reload; a forwarded link only watches', async ({ expect }) => {
    const share = await newShare({ call: true });
    const walker = walk(share, HERE);
    const first = await open(browser, { path: share.path, prepare: stubMaps });
    try {
      await waitForText(first.page, 'Let Alex see you too');
      await first.page.reload();
      await waitForHeading(first.page, LIVE);
      await waitForText(first.page, 'Let Alex see you too');
      const second = await open(browser, { path: share.path, prepare: stubMaps });
      try {
        await waitForHeading(second.page, LIVE);
        await waitForText(second.page, 'Near The Embarcadero');
        expect(plain(await second.page.locator('body').innerText())).not.toContain('Share my location');
        expect(realProblems(second.problems)).toEqual([]);
      } finally {
        await second.context.close();
      }
      expect(realProblems(first.problems)).toEqual([]);
    } finally {
      await walker.stop();
      await first.context.close();
    }
  });

  it('shares back: the viewer’s pings and viewer_sharing on, then off with Stop', async ({ expect }) => {
    const share = await newShare({ call: true });
    const walker = walk(share, HERE);
    const mom = north(HERE, 1200);
    const { page, context, problems } = await open(browser, {
      path: share.path,
      prepare: stubMaps,
      permissions: ['geolocation'],
      geolocation: { latitude: mom.lat, longitude: mom.lng },
    });
    try {
      await waitForText(page, 'Let Alex see you too');
      await page.locator('[data-act="share-back"]').click();
      await waitForHeading(page, 'You’re both live');
      await waitForText(page, '0.7 mi south of you');
      await until(() => sessionField(share, 'viewer_sharing'), (v) => v === true, 'viewer_sharing to turn on');
      await until(() => viewerPingCount(share), (n) => n >= 1, 'a viewer ping');
      expect(describeViolations(await axe(page))).toEqual([]);
      await shot(page, 'live/both');

      await page.locator('[data-act="stop-share-back"]').click();
      await waitForHeading(page, LIVE);
      await until(() => sessionField(share, 'viewer_sharing'), (v) => v === false, 'viewer_sharing to turn off');
      expect(realProblems(problems)).toEqual([]);
    } finally {
      await walker.stop();
      await context.close();
    }
  });

  it('says Reconnecting while offline, and Connected again', async ({ expect }) => {
    const share = await newShare();
    const walker = walk(share, HERE);
    const { page, context, problems } = await open(browser, { path: share.path, prepare: stubMaps });
    try {
      await waitForText(page, 'Near The Embarcadero');
      await context.setOffline(true);
      await waitForText(page, 'Reconnecting');
      await waitForStatus(page, 'Reconnecting.');
      expect(describeViolations(await axe(page))).toEqual([]);
      await shot(page, 'live/reconnecting');
      await context.setOffline(false);
      await waitForStatus(page, 'Connected again.');
      await until(async () => plain(await page.locator('.glassbar').innerText()), (t) => !t.includes('Reconnecting'), 'the pill to go');
      await waitForHeading(page, LIVE);
      expect(realProblems(problems).filter((p) => !OFFLINE_NOTES.test(p))).toEqual([]);
    } finally {
      await walker.stop();
      await context.close();
    }
  });

  it('says where in coordinates when the Maps API can’t load', async ({ expect }) => {
    const share = await newShare();
    const walker = walk(share, HERE);
    const { page, context, problems } = await open(browser, { path: share.path, prepare: blockMaps });
    try {
      await waitForHeading(page, LIVE);
      await waitForText(page, 'Near 37.7955° N, 122.3937° W');
      expect(await page.locator('.where .sr-only').textContent()).toBe('Near 37.7955 degrees north, 122.3937 degrees west');
      expect(realProblems(problems).filter((p) => !p.includes('maps.googleapis.com') && !p.includes('ERR_INTERNET_DISCONNECTED'))).toEqual([]);
    } finally {
      await walker.stop();
      await context.close();
    }
  });
});
