/**
 * The page's layout over the map. Phones: the glass bar, the open band for the map, the glass sheet.
 * When the page needs more room than the window has to leave the map a 160px band (large text,
 * zoom), it turns into one column that scrolls as a whole (.tall on the column, .column on the
 * body): the bar sticks to the top, the band keeps 160px with the people framed in it, and the sheet
 * goes solid. Wide screens: a floating column at the left, the map fills the rest
 * (src/styles/page.css).
 */

import type { Band } from '../map/map-view';

const MIN_BAND = 160;
/** Room the map keeps beside the column on a wide screen, at the least. */
const MIN_SIDE = 80;

/** The bar's margins and a little air, in px. */
const INSETS = 12;
/** Back from the column only with this much room to spare, so the layout never flips back and forth at the edge. */
const HYSTERESIS = 24;

export function updateTall(vp: HTMLElement, wide: boolean): void {
  const bar = vp.querySelector<HTMLElement>('.glassbar');
  const sheet = vp.querySelector<HTMLElement>('.sheet');
  let tall = false;
  if (!wide && bar && sheet) {
    const style = getComputedStyle(vp);
    const need = parseFloat(style.paddingTop) + bar.offsetHeight + MIN_BAND + sheet.scrollHeight + parseFloat(style.paddingBottom) + INSETS;
    tall = need > window.innerHeight - (vp.classList.contains('tall') ? HYSTERESIS : 0);
    // A focused heading or control scrolls to just under the bar.
    vp.style.setProperty('--bar-h', `${String(bar.offsetHeight)}px`);
  }
  vp.classList.toggle('tall', tall);
  document.body.classList.toggle('column', tall);
}

/** Where the people go: the band the bar and the sheet leave open, in viewport pixels. */
export function openBand(vp: HTMLElement | null, map: HTMLElement, wide: boolean): Band {
  const box = map.getBoundingClientRect();
  const full: Band = { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
  if (!vp) return full;
  if (wide) {
    const right = vp.getBoundingClientRect().right;
    return { ...full, left: Math.min(Math.max(full.left, right), full.right - MIN_SIDE) };
  }
  const gapEl = vp.querySelector<HTMLElement>('.vp-gap');
  if (!gapEl) return full;
  const g = gapEl.getBoundingClientRect();
  if (vp.classList.contains('tall')) {
    // The band as it sits with the page scrolled to the top, wherever the page is scrolled now.
    const top = g.top + window.scrollY;
    return { ...full, top, bottom: top + MIN_BAND };
  }
  return g.height > 0 ? { ...full, top: g.top, bottom: g.bottom } : full;
}
