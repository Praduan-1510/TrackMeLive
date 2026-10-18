/**
 * What the viewer page shows, read from its DOM in one go. This is the only file that knows the
 * page's markup (code/viewer/src/ui/templates.ts and src/map/markers.ts), so a markup change is fixed
 * here once. Text is read without the direction isolates the page puts around names.
 */

import type { Page } from 'playwright-core';

export interface MarkerState {
  /** The marker is in the page and not hidden. */
  readonly shown: boolean;
  /** Its one phrase for screen readers: "Alex, live, updated 2 seconds ago". */
  readonly phrase: string;
  /** The capsule under it: the name, or "Last seen 9:41 pm". */
  readonly label: string;
  readonly seen: boolean;
  readonly approximate: boolean;
  /** Its center on screen, CSS px, and whether that's inside the viewport. */
  readonly x: number;
  readonly y: number;
  readonly onScreen: boolean;
}

export interface ViewerState {
  /** loading, the live or ended page, or a message page (expired, invalid, unavailable). */
  readonly kind: 'loading' | 'page' | 'message';
  readonly title: string;
  readonly heading: string;
  /** The bar's status line: "Live · updated 3 s ago", "Last seen 9:41 pm", "Sharing ended at 9:52 pm". */
  readonly status: string;
  /** "Where Alex is, in words". */
  readonly where: string;
  /** The line under it: "Visible until 10:38 pm.", "Sharing stops at 10:38 pm.", … */
  readonly sub: string;
  readonly ended: boolean;
  /** The coordinates Open in Maps opens: where the page says Alex is now. Null once sharing ended. */
  readonly maps: { readonly lat: number; readonly lng: number } | null;
  readonly marker: MarkerState | null;
  /** A message page's detail line. */
  readonly detail: string;
  /** Every place the page spells out as coordinates, in its text ("37.7943° N, 122.3947° W") or links. */
  readonly coordinates: readonly { readonly lat: number; readonly lng: number; readonly text: string }[];
  /** The map is still moving the camera or a marker (the SVG map sets data-moving while it animates). */
  readonly moving: boolean;
}

export function readViewer(page: Page): Promise<ViewerState> {
  return page.evaluate(() => {
    // The direction isolates (U+2066 to U+2069) the page puts around names, built from code points.
    const isolates = new RegExp(`[${String.fromCodePoint(0x2066)}-${String.fromCodePoint(0x2069)}]`, 'g');
    const clean = (s: string | null | undefined): string => (s ?? '').replace(isolates, '').replace(/\s+/g, ' ').trim();
    const q = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
    const main = q('main');
    const busy = main?.getAttribute('aria-busy') === 'true';
    const kind: 'loading' | 'page' | 'message' = !main || busy ? 'loading' : main.classList.contains('msg') ? 'message' : 'page';
    const href = q('a[data-key="maps"]')?.getAttribute('href') ?? '';
    const ll = /(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/.exec(decodeURIComponent(href));
    const mk = q('.mk.sharer');
    let marker: MarkerState | null = null;
    if (mk) {
      const disc = mk.querySelector<HTMLElement>('.disc');
      const r = (disc ?? mk).getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      marker = {
        shown: !mk.hidden && mk.getClientRects().length > 0,
        phrase: clean(disc?.getAttribute('aria-label')),
        label: clean(mk.querySelector('.name')?.textContent),
        seen: mk.classList.contains('seen'),
        approximate: mk.classList.contains('approx'),
        x,
        y,
        onScreen: x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight,
      };
    }
    const coordinates: { lat: number; lng: number; text: string }[] = [];
    for (const m of document.body.innerText.matchAll(/(\d{1,2}\.\d{3,})°\s*([NS]),\s*(\d{1,3}\.\d{3,})°\s*([EW])/g)) {
      coordinates.push({ lat: Number(m[1]) * (m[2] === 'S' ? -1 : 1), lng: Number(m[3]) * (m[4] === 'W' ? -1 : 1), text: m[0] });
    }
    for (const a of document.querySelectorAll('a[href]')) {
      for (const m of decodeURIComponent(a.getAttribute('href') ?? '').matchAll(/(-?\d{1,2}\.\d{3,}),(-?\d{1,3}\.\d{3,})/g)) {
        coordinates.push({ lat: Number(m[1]), lng: Number(m[2]), text: m[0] });
      }
    }
    return {
      kind,
      title: clean(document.title),
      heading: clean(q('main h1')?.textContent),
      status: clean(q('[data-bind="status"]')?.textContent),
      where: clean(q('[data-bind="where"]')?.textContent),
      sub: clean(q('.sheet .sub')?.textContent),
      ended: q('.pill.ended') !== null,
      maps: ll ? { lat: Number(ll[1]), lng: Number(ll[2]) } : null,
      marker,
      detail: clean(q('main.msg .detail')?.textContent),
      coordinates,
      moving: q('#map[data-moving]') !== null,
    };
  });
}

/** Whether the page shows these coordinates as where Alex is (Open in Maps uses 5 decimals). */
export const showsAt = (s: ViewerState, p: { lat: number; lng: number }): boolean =>
  s.maps !== null && Math.abs(s.maps.lat - p.lat) < 0.6e-5 && Math.abs(s.maps.lng - p.lng) < 0.6e-5;

/** Meters between two points (haversine). */
function meters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The page asks for a new place name only once the sharer has moved 25 m (code/viewer/src/app/
 * place-asker.ts), so the where line may name a point up to that far from the newest ping; the
 * 4 decimals it writes add about 6 m.
 */
export const WHERE_SLACK_M = 32;

/**
 * Every place the page spells out is near this point: after the end the page keeps where Alex was
 * last seen, and never anything newer.
 */
export function onlyShows(s: ViewerState, p: { lat: number; lng: number }): boolean {
  return s.coordinates.every((c) => meters(c, p) <= WHERE_SLACK_M);
}
