/**
 * The street map's one setting: where its style comes from. OpenFreeMap (https://openfreemap.org)
 * draws OpenStreetMap with OpenMapTiles vector tiles, free, with no key and no account (owner
 * decision Oct 19, code/OPEN-DECISIONS.md). It's donation-run with no uptime promise, so the page
 * never depends on it: without it, a real session keeps the plain backdrop (src/map/open/).
 *
 * OpenFreeMap serves liberty, bright, positron, dark and fiord (checked Oct 19; its /styles/ index
 * isn't listed, each style is). Positron and dark are its quiet light and dark styles, and the page
 * draws either in its own map tokens (src/map/open/style.ts), so they differ only in which labels
 * they keep at which zooms. A build can point elsewhere, a mirror say, with VITE_TML_MAP_STYLE_LIGHT
 * and VITE_TML_MAP_STYLE_DARK.
 */

export type MapTheme = 'light' | 'dark';

export interface MapStyles {
  readonly light: string;
  readonly dark: string;
}

export const OPENFREEMAP_STYLES: MapStyles = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

export function mapStyles(env: { readonly VITE_TML_MAP_STYLE_LIGHT?: string; readonly VITE_TML_MAP_STYLE_DARK?: string }): MapStyles {
  const pick = (value: string | undefined, fallback: string): string => (value && /^https:\/\//.test(value) ? value : fallback);
  return { light: pick(env.VITE_TML_MAP_STYLE_LIGHT, OPENFREEMAP_STYLES.light), dark: pick(env.VITE_TML_MAP_STYLE_DARK, OPENFREEMAP_STYLES.dark) };
}

/**
 * How long a real session waits for the street map before keeping the plain backdrop for good,
 * counted from the first position the map shows (the people are on the plain backdrop meanwhile).
 * Three times the FSD's 2-second map load target, for a slow phone network.
 */
export const STREETS_TIMEOUT_MS = 6000;

/** What OpenFreeMap asks to be credited, wherever its tiles show (openfreemap.org/quick_start). */
export const ATTRIBUTION: readonly { readonly text: string; readonly href: string }[] = [
  { text: 'OpenFreeMap', href: 'https://openfreemap.org' },
  { text: '© OpenMapTiles', href: 'https://www.openmaptiles.org/' },
  { text: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
];
