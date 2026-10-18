/**
 * Focus stays where it was or moves on purpose after every action, never to the top of the page
 * (design-system/README.md, Accessibility → Focus). A move skips the browser's own scroll jump, then
 * brings the target into view: a heading to the top, just under the sticky bar (its scroll-margin-top
 * is the bar's height), a control only as far as needed. Never under the bar, never off screen.
 */

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]';

export function moveFocus(el: HTMLElement): void {
  if (!el.matches(FOCUSABLE)) el.tabIndex = -1;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: /^H[1-6]$/.test(el.tagName) ? 'start' : 'nearest', inline: 'nearest' });
}

/** Rebuilds `region` and gives focus back to the same control (by its data-key) if it had it. */
export function rebuildKeepingFocus(region: HTMLElement, html: string): void {
  const active = document.activeElement;
  const key = active instanceof HTMLElement && region.contains(active) ? active.dataset.key : undefined;
  region.innerHTML = html;
  if (key === undefined) return;
  region.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}
