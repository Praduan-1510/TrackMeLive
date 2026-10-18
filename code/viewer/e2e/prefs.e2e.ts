/**
 * The person's settings and the page's budget: forced colors, more contrast, reduced and full motion,
 * a theme set by the page against the system's, the wide layout, no layout shift while the page
 * loads, and under 150 KB of JavaScript and CSS.
 */

import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { axe, DESKTOP, describeViolations, launch, open, shot, until, waitForHeading } from './harness';

const LIVE = 'Alex is sharing their location with you';

let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser.close();
});

/** The marker's CSS animations that are running, by name. */
const markerAnimations = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    (document.querySelector('#map .mk.sharer')?.getAnimations({ subtree: true }) ?? [])
      .filter((a) => a.playState === 'running')
      .map((a) => (a instanceof CSSAnimation ? a.animationName : 'other')),
  );

describe.concurrent('the person’s settings', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`forced colors, ${theme}`, async ({ expect }) => {
      const { page, context, problems } = await open(browser, { state: 'both', theme, forcedColors: true });
      await waitForHeading(page, 'You’re both live');
      expect(describeViolations(await axe(page))).toEqual([]);
      // Surfaces whose backgrounds drop out keep an edge.
      expect(await page.locator('main .sheet').evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('solid');
      await shot(page, `prefs/forced-colors-${theme}`);
      expect(problems).toEqual([]);
      await context.close();
    });
  }

  it('more contrast: solid glass with a firmer edge', async ({ expect }) => {
    const { page, context, problems } = await open(browser, { state: 'offer', contrastMore: true });
    await waitForHeading(page, LIVE);
    const sheet = await page.locator('main .sheet').evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, edge: getComputedStyle(el).boxShadow }));
    expect(sheet.bg).toMatch(/^rgb\(/);
    expect(sheet.edge).toContain('2px');
    expect(describeViolations(await axe(page))).toEqual([]);
    await shot(page, 'prefs/contrast-more');
    expect(problems).toEqual([]);
    await context.close();
  });

  it('reduced motion: nothing bobs or breathes, even after a ping', async ({ expect }) => {
    const { page, context, problems } = await open(browser, { state: 'offer', motion: 'reduce' });
    await waitForHeading(page, LIVE);
    // Alex pings every 4 s; a moved marker only cross-fades.
    await page.waitForTimeout(4600);
    expect((await markerAnimations(page)).filter((n) => n !== 'mk-xfade')).toEqual([]);
    expect(await page.locator('#map[data-moving]').count()).toBe(0);
    expect(problems).toEqual([]);
    await context.close();
  });

  it('full motion: the marker arrives and pulses for a moment, then rests', async ({ expect }) => {
    const { page, context, problems } = await open(browser, { state: 'lost', motion: 'no-preference' });
    await waitForHeading(page, 'Alex’s signal dropped');
    // A stale marker is still.
    await page.waitForTimeout(800);
    expect(await markerAnimations(page)).toEqual([]);
    await context.close();

    const live = await open(browser, { state: 'offer', motion: 'no-preference' });
    await waitForHeading(live.page, LIVE);
    const names = await until(() => markerAnimations(live.page), (n) => n.length > 0, 'the marker to pulse');
    expect(names.some((n) => ['halo', 'ripple', 'bob', 'mk-in', 'fade-in', 'name-in'].includes(n))).toBe(true);
    expect(problems).toEqual([]);
    expect(live.problems).toEqual([]);
    await live.context.close();
  });
});

describe.concurrent('themes and layouts', () => {
  it('a theme set by the page wins over the system’s, the browser bar included', async ({ expect }) => {
    const { page, context, problems } = await open(browser, { state: 'offer', theme: 'dark', forceTheme: true });
    await waitForHeading(page, LIVE);
    expect(await page.locator('html').getAttribute('data-theme')).toBe('dark');
    expect((await page.locator('meta[name="theme-color"]').getAttribute('content'))?.toLowerCase()).toBe('#11171a');
    expect(problems).toEqual([]);
    await context.close();
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`wide screens: a column at the left, the people framed in the map beside it, ${theme}`, async ({ expect }) => {
      const { page, context, problems } = await open(browser, { state: 'both', theme, viewport: DESKTOP });
      await waitForHeading(page, 'You’re both live');
      await until(() => page.locator('#map[data-moving]').count(), (n) => n === 0, 'the map to settle');
      const place = await page.evaluate(() => {
        const column = document.querySelector('main.vp')?.getBoundingClientRect().right ?? 0;
        const marker = (sel: string): number => document.querySelector(sel)?.getBoundingClientRect().left ?? 0;
        return { column, sharer: marker('#map .mk.sharer .disc'), viewer: marker('#map .mk.viewer .disc') };
      });
      expect(place.sharer).toBeGreaterThan(place.column);
      expect(place.viewer).toBeGreaterThan(place.column);
      expect(describeViolations(await axe(page))).toEqual([]);
      await shot(page, `prefs/wide-${theme}`);
      expect(problems).toEqual([]);
      await context.close();
    });
  }
});

describe.concurrent('the map didn’t load, on a wide screen', () => {
  it('says so on the open map beside the column, and keeps Try again reachable', async ({ expect }) => {
    const { page, context, problems } = await open(browser, { state: 'map-failed', viewport: DESKTOP });
    const notice = page.locator('.map-failed');
    await notice.waitFor({ state: 'visible' });
    const at = await page.evaluate(() => ({
      column: document.querySelector('main.vp .sheet')?.getBoundingClientRect().right ?? 0,
      notice: document.querySelector('.map-failed')?.getBoundingClientRect().left ?? 0,
    }));
    expect(at.notice).toBeGreaterThan(at.column);
    expect(describeViolations(await axe(page))).toEqual([]);
    await shot(page, 'prefs/wide-map-failed');
    expect(problems).toEqual([]);
    await context.close();
  });
});

describe.concurrent('performance', () => {
  it('loads with no layout shift', async ({ expect }) => {
    const { page, context, problems } = await open(browser, {
      state: 'offer',
      motion: 'no-preference',
      initScript: `window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });`,
    });
    await waitForHeading(page, LIVE);
    await page.waitForTimeout(1500);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.01);
    expect(problems).toEqual([]);
    await context.close();
  });

  it('ships under 150 KB of JavaScript and CSS', async ({ expect }) => {
    const { page, context } = await open(browser, { state: 'offer' });
    await waitForHeading(page, LIVE);
    const bytes = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((e): e is PerformanceResourceTiming => e instanceof PerformanceResourceTiming)
        .filter((e) => /\.(js|css)(\?|$)/.test(e.name))
        .reduce((sum, e) => sum + e.decodedBodySize, 0),
    );
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(150 * 1024);
    await context.close();
  });
});
