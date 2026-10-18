/** Small DOM helpers. Everything from the session (the sharer's name above all) is escaped before it meets innerHTML. */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);

/** Text shown one way and spoken another ("1.2 km", "1.2 kilometers"). */
export const dual = (shown: string, spoken: string, bind?: string): string =>
  `<span aria-hidden="true"${bind ? ` data-bind="${bind}"` : ''}>${esc(shown)}</span><span class="sr-only"${bind ? ` data-bind="${bind}-sr"` : ''}>${esc(spoken)}</span>`;

/**
 * Updates bound text (data-bind) and links (data-bind-href) in place, so ticking times and a moving
 * sharer never re-render (or re-announce) what's around them.
 */
export function setBinds(root: ParentNode, binds: Readonly<Record<string, string>>): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-bind]')) {
    const text = binds[el.dataset.bind ?? ''];
    if (text !== undefined && el.textContent !== text) el.textContent = text;
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-bind-href]')) {
    const href = binds[el.dataset.bindHref ?? ''];
    if (href !== undefined && el.getAttribute('href') !== href) el.setAttribute('href', href);
  }
}

/** Plays a class's CSS animation again from the start. */
export function replayClass(el: Element, cls: string): void {
  el.classList.remove(cls);
  el.getBoundingClientRect(); // a reflow between, so the animation starts over
  el.classList.add(cls);
}
