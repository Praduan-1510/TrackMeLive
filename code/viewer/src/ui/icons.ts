/**
 * The page's icons: small inline SVGs drawn for the viewer page (the prototype's Mom page uses the
 * same set), so the page loads no icon font and never flashes a ligature's name. Always hidden from
 * screen readers: the words next to an icon carry its meaning. Sized by CSS (.ic) in em, so they
 * grow with the text.
 */

const svg = (body: string): string => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  /** Share my location: the location arrow. */
  share: svg('<path d="M21 3 3 10.5 11 13l2.5 8z" fill="currentColor"/>'),
  /** Where Alex is. */
  pin: svg('<path d="M12 2.8a7 7 0 0 0-7 7c0 5.1 6 10.9 6.3 11.2a1 1 0 0 0 1.4 0c.3-.3 6.3-6.1 6.3-11.2a7 7 0 0 0-7-7zm0 9.7a2.7 2.7 0 1 1 0-5.4 2.7 2.7 0 0 1 0 5.4z" fill="currentColor"/>'),
  /** Show Alex: center the map. */
  target: svg('<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  map: svg('<path d="M3.5 6.5 9 4l6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5zM9 4v13.5M15 6.5V20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'),
  /** Location is off for this page. */
  lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.2"/>'),
  /** Something that can't happen here: no location, no sharing from this browser. */
  warn: svg('<circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.2v6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.6" r="1.3" fill="currentColor"/>'),
  /** The 1-hour warning. */
  clock: svg('<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  /** A link that doesn't work. */
  brokenLink: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1M4 4l16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  /** The viewer on their own page: a person, never an initial (they have no account). */
  person: svg('<circle cx="12" cy="8" r="4.3" fill="currentColor"/><path d="M3.8 20.4c.8-4.2 4.1-6.6 8.2-6.6s7.4 2.4 8.2 6.6z" fill="currentColor"/>'),
} as const;
