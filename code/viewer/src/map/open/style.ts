/**
 * OpenFreeMap's style, drawn in the page's own map tokens (design-system/README.md, The map): the
 * map is only `map-land`, `map-road`, `map-road-major`, `map-park`, `map-water` and `map-label`, so
 * the people's colors are the only saturated things on it, and the tokens' contrast holds as
 * promised: markers, the trail and the connector line 3:1 on every map color, labels 4.5:1.
 *
 * Layers are sorted by what they draw (the OpenMapTiles schema's source layers, which every
 * OpenFreeMap style shares), not by their ids, so either served style, or a new version of one,
 * takes the same colors:
 *   fills    water → water; parks, woods and grass → park; buildings → road at 30% (the sample
 *            city's blocks); everything else (land use, piers, ice) → land
 *   lines    waterways → water; road casings → land (it keeps blocks off the streets, as in the
 *            sample city); motorways, trunks and primaries → road-major; other roads, paths,
 *            rails and runways → road; boundaries → label at 35%
 *   labels   label text with a land halo, never under 11 px and scaled with the page's text size
 *   icons    road shields and one-way arrows go (they're saturated, and they'd need the sprite);
 *            a label that also has an icon keeps its text. With no icons left, the sprite goes.
 * Raster, hillshade, extrusion and heatmap layers go, and so does every source left unused.
 */

export interface StreetPalette {
  readonly land: string;
  readonly road: string;
  readonly roadMajor: string;
  readonly park: string;
  readonly water: string;
  readonly label: string;
}

/** A style document, as far as this file reads it (MapLibre's style specification). */
export interface StyleJson {
  readonly sources: Readonly<Record<string, { readonly type: string } & Readonly<Record<string, unknown>>>>;
  readonly layers: readonly LayerJson[];
  readonly [key: string]: unknown;
}

export interface LayerJson {
  readonly id: string;
  readonly type: string;
  readonly source?: string;
  readonly 'source-layer'?: string;
  readonly filter?: unknown;
  readonly layout?: Readonly<Record<string, unknown>>;
  readonly paint?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

/** Labels are never smaller than this, in px (design-system/README.md: caption-2, 11 pt). */
export const MIN_LABEL_PX = 11;
const BUILDING_OPACITY = 0.3;
const BOUNDARY_OPACITY = 0.35;
const LABEL_HALO_PX = 1.5;

const DROPPED_TYPES = new Set(['raster', 'hillshade', 'fill-extrusion', 'heatmap', 'color-relief']);
/** Source layers whose labels keep their text when their icon goes. */
const LABELS_WITH_ICONS = new Set(['place', 'aerodrome_label', 'water_name', 'poi', 'mountain_peak']);
const MAJOR_ROAD = /motorway|trunk|primary|major/;
const PARKLIKE = /park|wood|grass|forest|scrub|meadow|garden|pitch/;

/** Every string in a filter expression: the classes and ids a layer picks, to sort it by. */
function words(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(words);
  return [];
}

const has = (layer: LayerJson, re: RegExp): boolean => re.test(layer.id) || words(layer.filter).some((w) => re.test(w));

function fillColor(layer: LayerJson, p: StreetPalette): { color: string; opacity?: number } {
  const from = layer['source-layer'];
  if (from === 'water') return { color: p.water };
  if (from === 'building') return { color: p.road, opacity: BUILDING_OPACITY };
  if (from === 'park' || ((from === 'landcover' || from === 'landuse') && has(layer, PARKLIKE))) return { color: p.park };
  if (from === 'aeroway') return { color: p.road };
  return { color: p.land };
}

function lineColor(layer: LayerJson, p: StreetPalette): { color: string; opacity?: number } {
  const from = layer['source-layer'];
  if (from === 'waterway' || from === 'water') return { color: p.water };
  if (from === 'boundary') return { color: p.label, opacity: BOUNDARY_OPACITY };
  if (from === 'park' || from === 'landcover' || from === 'landuse') return { color: has(layer, PARKLIKE) ? p.park : p.land };
  // Road casings, and the gaps between a rail's dashes, are drawn in the land.
  if (/casing|dashline/.test(layer.id)) return { color: p.land };
  if (from === 'transportation' && has(layer, MAJOR_ROAD)) return { color: p.roadMajor };
  return { color: p.road };
}

/** max(11, size) × scale, through numbers, zoom curves (interpolate, step) and legacy stops. */
export function labelSize(size: unknown, scale: number): unknown {
  const fit = (v: unknown): unknown => (typeof v === 'number' ? Math.round(Math.max(MIN_LABEL_PX, v) * scale * 100) / 100 : v);
  if (size === undefined) return fit(16); // MapLibre's default text-size
  if (typeof size === 'number') return fit(size);
  if (Array.isArray(size)) {
    const [op] = size as unknown[];
    // ["interpolate", type, input, z0, v0, z1, v1, …]: outputs at 4, 6, …
    if (op === 'interpolate' || op === 'interpolate-hcl' || op === 'interpolate-lab') return size.map((v: unknown, i) => (i >= 4 && i % 2 === 0 ? fit(v) : v));
    // ["step", input, v0, z1, v1, …]: outputs at 2, 4, …
    if (op === 'step') return size.map((v: unknown, i) => (i >= 2 && i % 2 === 0 ? fit(v) : v));
    return size;
  }
  if (typeof size === 'object' && size !== null && Array.isArray((size as { stops?: unknown }).stops)) {
    const f = size as { stops: unknown[] };
    return { ...f, stops: f.stops.map((s) => (Array.isArray(s) ? [s[0], fit(s[1])] : s)) };
  }
  return size;
}

const ICON_KEYS = /^icon-/;
const PATTERN_KEYS = new Set(['fill-pattern', 'line-pattern', 'background-pattern']);

function withoutKeys(o: Readonly<Record<string, unknown>> | undefined, drop: (key: string) => boolean): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !drop(k)));
}

/** One layer in the palette, or null when it goes. */
function themeLayer(layer: LayerJson, p: StreetPalette, textScale: number): LayerJson | null {
  if (DROPPED_TYPES.has(layer.type)) return null;
  const paint = withoutKeys(layer.paint, (k) => PATTERN_KEYS.has(k) || k.endsWith('-transition'));
  switch (layer.type) {
    case 'background':
      return { ...layer, paint: { ...paint, 'background-color': p.land } };
    case 'fill': {
      const { color, opacity } = fillColor(layer, p);
      delete paint['fill-outline-color'];
      return { ...layer, paint: { ...paint, 'fill-color': color, 'fill-antialias': true, ...(opacity === undefined ? {} : { 'fill-opacity': opacity }) } };
    }
    case 'line': {
      const { color, opacity } = lineColor(layer, p);
      return { ...layer, paint: { ...paint, 'line-color': color, ...(opacity === undefined ? {} : { 'line-opacity': opacity }) } };
    }
    case 'symbol': {
      const layout = layer.layout ?? {};
      const hasIcon = 'icon-image' in layout;
      const hasText = 'text-field' in layout;
      if (!hasText || (hasIcon && !LABELS_WITH_ICONS.has(layer['source-layer'] ?? ''))) return null;
      const textLayout = withoutKeys(layout, (k) => ICON_KEYS.test(k));
      const textPaint = withoutKeys(paint, (k) => ICON_KEYS.test(k));
      return {
        ...layer,
        layout: { ...textLayout, 'text-size': labelSize(layout['text-size'], textScale) },
        paint: { ...textPaint, 'text-color': p.label, 'text-halo-color': p.land, 'text-halo-width': LABEL_HALO_PX, 'text-halo-blur': 0 },
      };
    }
    default:
      return { ...layer, paint };
  }
}

/** The served style, in the page's map tokens (see the module comment). Never changes `style`. */
export function themeStyle(style: StyleJson, palette: StreetPalette, textScale = 1): StyleJson {
  const layers = style.layers.map((l) => themeLayer(l, palette, textScale)).filter((l): l is LayerJson => l !== null);
  const used = new Set(layers.map((l) => l.source).filter((s): s is string => typeof s === 'string'));
  const sources = Object.fromEntries(Object.entries(style.sources).filter(([id]) => used.has(id)));
  const rest = Object.fromEntries(Object.entries(style).filter(([k]) => k !== 'sprite' && k !== 'layers' && k !== 'sources'));
  return { ...rest, sources, layers };
}
