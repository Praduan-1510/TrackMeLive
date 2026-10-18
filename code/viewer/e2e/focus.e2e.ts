/**
 * Keyboard and screen reader behavior: focus stays put or moves on purpose after every action (never
 * to the top of the page), the help dialog closes with Escape and gives focus back, the polite status
 * region and the alert say what changed, and share back works with the browser's real location API.
 */

import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { focused, launch, open, plain, until, waitForHeading, waitForStatus, waitForText } from './harness';

const LIVE = 'Alex is sharing their location with you';
/** The sample's viewer location, about 1.2 km north-east of Alex (src/sample/sample-session-source.ts). */
const MOM = { latitude: 37.80187, longitude: -122.38513 };

let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser.close();
});

/** A control's name, matched whether or not the sharer's name in it is direction-isolated. */
const named = (name: string): RegExp => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/Alex/g, '[\\u2068]?Alex[\\u2069]?')}$`);

/** Focuses a control the way Tab would land on it, then activates it from the keyboard. */
async function press(page: Page, name: string, key = 'Enter'): Promise<void> {
  const el = page.getByRole('button', { name: named(name) });
  await el.waitFor({ state: 'visible' });
  await el.focus();
  await page.keyboard.press(key);
}

async function waitForFocus(page: Page, want: string): Promise<string> {
  try {
    return await until(() => focused(page), (f) => f === want, `focus on ${want}`);
  } catch (e) {
    const trace = await page.evaluate(() => (window as unknown as { __focusTrace: string[] }).__focusTrace.join(' → '));
    throw new Error(`${e instanceof Error ? e.message : String(e)}\nFocus went: ${trace}`, { cause: e });
  }
}

describe.concurrent('focus moves on purpose', () => {
  it('Not now hands focus to the button that replaces the card', async ({ expect }) => {
    const { page, context, problems } = await open(browser, { state: 'offer' });
    await waitForHeading(page, LIVE);
    await press(page, 'Not now');
    await waitForFocus(page, 'button: Share my location with Alex');
    expect(problems).toEqual([]);
    await context.close();
  });

  it('Share my location: focus goes to Stop sharing my location, and Stop sends it to the heading', async ({ expect }) => {
    const { page, context, problems } = await open(browser, { state: 'offer' });
    await waitForHeading(page, LIVE);
    await press(page, 'Share my location');
    await waitForHeading(page, 'You’re both live');
    await waitForFocus(page, 'button: Stop sharing my location');
    await waitForStatus(page, 'You’re both live.');
    // A destructive button that has just appeared ignores a tap carried over from a double tap.
    await page.waitForTimeout(450);
    await page.keyboard.press('Enter');
    await waitForHeading(page, LIVE);
    await waitForFocus(page, `h1: ${LIVE}`);
    await waitForStatus(page, 'You stopped sharing your location.');
    expect(problems).toEqual([]);
    await context.close();
  });

  it('a refusal moves focus to Try again; the help dialog takes focus, closes with Escape and gives it back', async ({ expect }) => {
    const { page, context, problems } = await open(browser, { state: 'offer', geo: 'denied' });
    await waitForHeading(page, LIVE);
    await press(page, 'Share my location');
    await waitForText(page, 'Location is off for this page');
    await waitForFocus(page, 'button: Try again');
    await waitForStatus(page, 'Location is off for this page.');

    await press(page, 'How to turn it on');
    const dialog = page.getByRole('dialog', { name: 'Turn on location for this page' });
    await dialog.waitFor({ state: 'visible' });
    await waitForFocus(page, 'button: Done');
    // Tab stays inside the dialog: the page behind it is inert.
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('dialog') !== null || document.activeElement === document.body)).toBe(true);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await waitForFocus(page, 'button: How to turn it on');

    // Try again asks again (and is refused again): focus stays on it.
    await press(page, 'Try again');
    await waitForFocus(page, 'button: Try again');
    expect(problems).toEqual([]);
    await context.close();
  });

  it('the map’s Try again moves focus to the heading, and the map comes back', async ({ expect }) => {
    const { page, context, problems } = await open(browser, { state: 'map-failed' });
    await waitForText(page, 'The map didn’t load');
    await waitForStatus(page, 'The map didn’t load.');
    expect(await page.locator('#map').isVisible()).toBe(false);
    expect(await page.getByRole('link', { name: 'Open in Maps' }).isVisible()).toBe(true);
    await press(page, 'Try again');
    await waitForFocus(page, `h1: ${LIVE}`);
    await until(() => page.locator('#map').isVisible(), (v) => v, 'the map');
    expect(await page.getByRole('button', { name: named('Show Alex') }).isVisible()).toBe(true);
    expect(problems).toEqual([]);
    await context.close();
  });

  it('Show Alex keeps focus and says what it did', async ({ expect }) => {
    const { page, context, problems } = await open(browser, { state: 'offer' });
    await waitForHeading(page, LIVE);
    await press(page, 'Show Alex');
    await waitForStatus(page, 'Map centered on Alex.');
    expect(await focused(page)).toBe('button: Show Alex');
    expect(problems).toEqual([]);
    await context.close();
  });
});

describe.concurrent('changes the viewer didn’t make', () => {
  it('sharing ended: the heading is said once as an alert, and focus never drops to the page', async ({ expect }) => {
    const { page, context, problems } = await open(browser, { state: 'ended' });
    // Focus the card's button as soon as the live page shows it; Alex stops sharing a moment later.
    await page.getByRole('button', { name: 'Share my location', exact: true }).focus();
    await waitForHeading(page, /^Alex stopped sharing at /);
    await waitForStatus(page, 'Alex stopped sharing.', '#alert');
    // The card that had focus is gone: focus is on the heading, not the page.
    expect(await focused(page)).toMatch(/^h1: Alex stopped sharing at /);
    expect(plain(await page.locator('#status').textContent())).not.toContain('stopped sharing');
    expect(problems).toEqual([]);
    await context.close();
  });

  it('the call ends while sharing back: share back stops, it’s said why, and focus lands on the heading', async ({ expect }) => {
    const { page, context, problems } = await open(browser, { state: 'call-ended' });
    await waitForText(page, 'Your call ended. Visible until');
    await waitForStatus(page, 'Your call ended, so your location is no longer shared.');
    expect(await focused(page)).toBe(`h1: ${LIVE}`);
    expect(await page.getByText('On your call').count()).toBe(0);
    expect(problems).toEqual([]);
    await context.close();
  });

  it('Alex asks to see where you are: it’s said, and the ask describes the button', async ({ expect }) => {
    const { page, context, problems } = await open(browser, { state: 'asked' });
    await waitForStatus(page, 'Alex asked to see where you are.');
    const button = page.getByRole('button', { name: 'Share my location', exact: true });
    expect(plain(await button.getAttribute('aria-describedby'))).toBe('sb-ask sb-t2 sb-hint');
    expect(problems).toEqual([]);
    await context.close();
  });

  it('the page loads: what it shows is said once, politely', async ({ expect }) => {
    const { page, context, problems } = await open(browser, { state: 'offer' });
    await waitForStatus(page, 'Alex is sharing their location with you. Near Harbor Way.');
    expect(await page.locator('main').getAttribute('aria-busy')).toBeNull();
    expect(problems).toEqual([]);
    await context.close();
  });
});

describe.concurrent('the map for keyboard and screen readers', () => {
  it('reads each marker as one focusable phrase, after the page in reading order', async ({ expect }) => {
    const { page, context, problems } = await open(browser, { state: 'both' });
    await waitForHeading(page, 'You’re both live');
    const sharer = page.locator('#map .mk.sharer .disc');
    expect(plain(await sharer.getAttribute('aria-label'))).toMatch(/^Alex, live, 0\.7 miles away, updated (now|\d+ seconds? ago)$/);
    expect(await page.locator('#map .mk.viewer .disc').getAttribute('aria-label')).toBe('You, sharing your location');
    expect(await page.locator('#map svg.mapsvg').getAttribute('aria-label')).toBe('Street map around Harbor Way');
    // Tab from the last control in the sheet reaches the markers next.
    await page.getByRole('button', { name: 'Stop sharing my location' }).focus();
    await page.keyboard.press('Tab');
    expect(plain(await focused(page))).toMatch(/^div: Alex, live/);
    expect(problems).toEqual([]);
    await context.close();
  });
});

describe.concurrent('share back with the browser’s real location API', () => {
  it('shares once location is allowed', async ({ expect }) => {
    const { page, context, problems } = await open(browser, { state: 'offer', geo: 'browser', permissions: ['geolocation'], geolocation: MOM });
    await waitForHeading(page, LIVE);
    await press(page, 'Share my location');
    await waitForHeading(page, 'You’re both live');
    await waitForText(page, '0.7 mi south-west of you');
    expect(problems).toEqual([]);
    await context.close();
  });

  it('says location is off when the browser refuses', async ({ expect }) => {
    const { page, context, problems } = await open(browser, { state: 'offer', geo: 'browser' });
    await waitForHeading(page, LIVE);
    await page.context().clearPermissions();
    await press(page, 'Share my location');
    await waitForText(page, 'Location is off for this page');
    expect(problems).toEqual([]);
    await context.close();
  });

  it('says this browser can’t share when it has no location API', async ({ expect }) => {
    const { page, context, problems } = await open(browser, {
      state: 'offer',
      geo: 'browser',
      initScript: 'delete Navigator.prototype.geolocation;',
    });
    await waitForText(page, 'This browser can’t share your location');
    expect(await page.getByRole('button', { name: 'Share my location', exact: true }).count()).toBe(0);
    expect(problems).toEqual([]);
    await context.close();
  });
});
