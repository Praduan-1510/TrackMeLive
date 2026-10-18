/**
 * Icons. The page uses Material Symbols Rounded from the vendored subset (public/fonts/
 * material-symbols-icons.txt lists what it has). Where the subset lacks an icon, a small inline SVG
 * drawn to match it (rounded joins, the same stroke weight) stands in. Always hidden from screen
 * readers: the words next to an icon carry its meaning.
 */

/** A Material Symbols Rounded glyph by ligature name. */
export const sym = (name: string, fill = false): string =>
  `<span class="ms${fill ? ' fill' : ''}" aria-hidden="true">${name}</span>`;

/** "map" isn't in the subset: a folded map, matching Material Symbols Rounded's outline weight. */
export const MAP_SVG =
  '<svg class="ic-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 4.6 4.3 6.4A1.6 1.6 0 0 0 3.3 7.9v10.6a1 1 0 0 0 1.4.9L9 17.7l6 2.1 4.7-1.8a1.6 1.6 0 0 0 1-1.5V5.9a1 1 0 0 0-1.4-.9L15 6.7zM9 4.6v13.1M15 6.7v13.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
