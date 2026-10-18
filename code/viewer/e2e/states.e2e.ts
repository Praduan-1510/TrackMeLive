/**
 * Every viewer state, in light and dark: its heading and document title, one <main> and one h1, the
 * map as a labelled region (or gone, on message pages), no axe violations, every target 48px or
 * more, no errors or failed requests, and a screenshot in test-results/screenshots/states/.
 */

import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { axe, describeViolations, launch, open, plain, shot, smallTargets, waitForHeading, waitForText } from './harness';

interface StateCase {
  readonly state: string;
  readonly path?: string;
  readonly heading: string | RegExp;
  readonly title: string;
  /** Text that has to be on the page once the state is reached. */
  readonly shows?: string;
  /** Text that must not be. */
  readonly hides?: string;
  readonly map: boolean;
}

const LIVE = 'Alex is sharing their location with you';
const LIVE_TITLE = 'Alex is sharing their location · Track Me Live';

const CASES: readonly StateCase[] = [
  { state: 'loading', heading: 'Loading the live location', title: 'Loading · Track Me Live', map: true },
  { state: 'offer', heading: LIVE, title: LIVE_TITLE, shows: 'Let Alex see you too', map: true },
  { state: 'not-now', heading: LIVE, title: LIVE_TITLE, shows: 'Share my location with Alex', hides: 'Let Alex see you too', map: true },
  { state: 'asked', heading: LIVE, title: LIVE_TITLE, shows: 'Alex asked to see where you are', map: true },
  { state: 'denied', heading: LIVE, title: LIVE_TITLE, shows: 'Location is off for this page', map: true },
  { state: 'unavailable', heading: LIVE, title: LIVE_TITLE, shows: 'Your location couldn’t be shared', map: true },
  { state: 'no-geo', heading: LIVE, title: LIVE_TITLE, shows: 'This browser can’t share your location', map: true },
  { state: 'both', heading: 'You’re both live', title: 'You’re both live · Track Me Live', shows: 'Stop sharing my location', map: true },
  { state: 'stopped-back', heading: LIVE, title: LIVE_TITLE, shows: 'Alex can’t see you now', map: true },
  { state: 'lost', heading: 'Alex’s signal dropped', title: 'Alex’s signal dropped · Track Me Live', shows: 'Last seen near Harbor Way', map: true },
  { state: 'lost-both', heading: 'Alex’s signal dropped', title: 'Alex’s signal dropped · Track Me Live', shows: 'NO SIGNAL', map: true },
  { state: 'call-ended', heading: LIVE, title: LIVE_TITLE, shows: 'Your call ended. Visible until', hides: 'On your call', map: true },
  { state: 'ended', heading: /^Alex stopped sharing at \d{1,2}:\d{2} [ap]m$/, title: 'Alex stopped sharing · Track Me Live', shows: 'It won’t move again.', map: true },
  { state: 'ended-timer', heading: /^Sharing ended at \d{1,2}:\d{2} [ap]m$/, title: 'Sharing ended · Track Me Live', shows: 'It won’t move again.', map: true },
  { state: 'expired', heading: 'This location is no longer being shared', title: 'Location no longer shared · Track Me Live', shows: 'Ask Alex to share again', map: false },
  { state: 'invalid', heading: 'This link doesn’t work', title: 'This link doesn’t work · Track Me Live', shows: 'Check that you have the whole link', map: false },
  { state: 'cant-open', heading: 'This link can’t be opened right now', title: 'Can’t open this link · Track Me Live', shows: 'Try again', map: false },
  { state: 'deleted', heading: /^Sharing ended at \d{1,2}:\d{2} [ap]m$/, title: 'Sharing ended · Track Me Live', shows: 'It won’t move again.', map: true },
  // A real share link never shows sample data: until the Firestore source lands, it can't be opened.
  { state: 'real-link', path: '/s/AbCdEfGhIjKlMnOpQr-_12', heading: 'This link can’t be opened right now', title: 'Can’t open this link · Track Me Live', map: false },
  // The built page with no link and no review state.
  { state: 'no-link', path: '/', heading: 'This link doesn’t work', title: 'This link doesn’t work · Track Me Live', map: false },
  { state: 'invalid-path', path: '/s/not-a-whole-token', heading: 'This link doesn’t work', title: 'This link doesn’t work · Track Me Live', map: false },
  { state: 'map-failed', heading: LIVE, title: LIVE_TITLE, shows: 'The map didn’t load', hides: 'Show Alex', map: false },
  { state: 'approximate', heading: LIVE, title: LIVE_TITLE, shows: 'In the Market area', map: true },
  { state: 'warning', heading: LIVE, title: LIVE_TITLE, shows: 'Sharing stops at', map: true },
  { state: 'reconnecting', heading: LIVE, title: LIVE_TITLE, shows: 'Reconnecting', map: true },
  { state: 'watcher', heading: LIVE, title: LIVE_TITLE, hides: 'Share my location', map: true },
];

let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser.close();
});

for (const theme of ['light', 'dark'] as const) {
  describe.concurrent(`every state, ${theme}`, () => {
    for (const c of CASES) {
      it(c.state, async ({ expect }) => {
        const { page, context, problems } = await open(browser, { theme, ...(c.path ? { path: c.path } : { state: c.state }) });
        try {
          await waitForHeading(page, c.heading);
          if (c.shows) await waitForText(page, c.shows);
          if (c.hides) expect(plain(await page.locator('body').innerText())).not.toContain(c.hides);
          expect(plain(await page.title())).toBe(c.title);
          expect(await page.locator('main').count()).toBe(1);
          expect(await page.locator('h1').count()).toBe(1);
          expect(await page.locator('#map').isVisible()).toBe(c.map);
          if (c.map) expect(await page.locator('#map').getAttribute('aria-label')).toBe('Map');

          const violations = await axe(page);
          expect(describeViolations(violations)).toEqual([]);
          expect(await smallTargets(page)).toEqual([]);
          await shot(page, `states/${c.state}-${theme}`);
          expect(problems).toEqual([]);
        } finally {
          await context.close();
        }
      });
    }
  });
}
