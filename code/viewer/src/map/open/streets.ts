/**
 * The street map itself: MapLibre GL JS drawing OpenFreeMap's vector tiles in the page's map tokens.
 * Its own chunk, fetched only for a real session (src/map/open/open-map-view.ts), and MapLibre's own
 * three files (the map, its worker and the code they share) load from this origin, as published,
 * next to each other (vite.config.ts), so the worker and the page share one copy of the shared code.
 *
 * It only draws: no gestures, no keyboard, no focus, no controls, hidden from screen readers. The
 * SVG map over it holds the people and drives its camera (show). It's ready once the style and at
 * least one tile have drawn; it fails when the style, the tile source or every tile it asked for
 * fails. MapLibre asks again for tiles that failed when the browser comes back online.
 */

import type * as MapLibre from 'maplibre-gl';
import type { LatLng } from '../../geo/geo';
import type { MapStyles, MapTheme } from './config';
import { themeStyle, type StreetPalette, type StyleJson } from './style';

export interface StreetsOptions {
  readonly container: HTMLElement;
  readonly styles: MapStyles;
  readonly theme: MapTheme;
  readonly palette: StreetPalette;
  /** The page's text size over the default (1 = 16 px), so labels grow with it. */
  readonly textScale: number;
  readonly reduceMotion: boolean;
  readonly at: { readonly center: LatLng; readonly zoom: number };
}

export interface Streets {
  /** Resolves once the first tiles have drawn; rejects when the style, the source or every tile failed. */
  readonly ready: Promise<void>;
  /** Moves the camera now, drawing in this frame, so the people over it never drift. */
  show(center: LatLng, zoom: number): void;
  setTheme(theme: MapTheme, palette: StreetPalette, textScale: number): void;
  remove(): void;
}

type MapLibreModule = typeof MapLibre;
type MapStyle = NonNullable<ConstructorParameters<MapLibreModule['Map']>[0]['style']>;

let runtime: Promise<MapLibreModule> | null = null;

/** MapLibre, from this origin. The shared code is asked for at once, alongside the map's own file. */
function maplibre(): Promise<MapLibreModule> {
  runtime ??= (() => {
    const preload = document.createElement('link');
    preload.rel = 'modulepreload';
    preload.href = `${__MAPLIBRE_BASE__}maplibre-gl-shared.mjs`;
    document.head.append(preload);
    return import(/* @vite-ignore */ `${__MAPLIBRE_BASE__}maplibre-gl.mjs`) as Promise<MapLibreModule>;
  })().catch((err: unknown) => {
    runtime = null;
    throw err;
  });
  return runtime;
}

async function fetchStyle(url: string): Promise<StyleJson> {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`The map style answered ${String(res.status)}.`);
  const style = (await res.json()) as unknown;
  if (typeof style !== 'object' || style === null || !Array.isArray((style as StyleJson).layers)) throw new Error('The map style is not a style.');
  return style as StyleJson;
}

const vectorSources = (style: StyleJson): Set<string> =>
  new Set(Object.entries(style.sources).filter(([, s]) => s.type === 'vector').map(([id]) => id));

export async function createStreets(o: StreetsOptions): Promise<Streets> {
  const [ml, served] = await Promise.all([maplibre(), fetchStyle(o.styles[o.theme])]);
  const styles = new Map<MapTheme, StyleJson>([[o.theme, served]]);
  const vectors = vectorSources(served);
  const map = new ml.Map({
    container: o.container,
    style: themeStyle(served, o.palette, o.textScale) as unknown as MapStyle,
    center: [o.at.center.lng, o.at.center.lat],
    zoom: o.at.zoom,
    interactive: false,
    attributionControl: false,
    renderWorldCopies: false,
    fadeDuration: o.reduceMotion ? 0 : 300,
  });
  // A plain picture: nothing in it takes focus or is read out (the where line says where).
  map.getCanvas().tabIndex = -1;
  map.getCanvas().setAttribute('aria-hidden', 'true');

  const ready = new Promise<void>((resolve, reject) => {
    let drawn = false;
    let failed = 0;
    map.on('sourcedata', (e) => {
      if (e.tile && vectors.has(e.sourceId)) drawn = true;
    });
    map.on('error', (e: { error?: Error; sourceId?: string; tile?: unknown }) => {
      if (e.tile !== undefined) failed += 1;
      // The tile source itself (its TileJSON) failed: no tile will ever come.
      else if (e.sourceId !== undefined && vectors.has(e.sourceId) && !drawn) reject(e.error ?? new Error('The map’s tiles didn’t load.'));
    });
    map.on('idle', () => {
      if (drawn) resolve();
      else if (failed > 0) reject(new Error('None of the map’s tiles loaded.'));
    });
  });

  let theme = o.theme;
  let at = { lng: o.at.center.lng, lat: o.at.center.lat, zoom: o.at.zoom };
  return {
    ready,
    show(center, zoom) {
      if (Math.abs(center.lng - at.lng) < 1e-9 && Math.abs(center.lat - at.lat) < 1e-9 && Math.abs(zoom - at.zoom) < 1e-6) return;
      at = { lng: center.lng, lat: center.lat, zoom };
      map.jumpTo({ center: [center.lng, center.lat], zoom });
      map.redraw();
    },
    setTheme(next, palette, textScale) {
      theme = next;
      const apply = (style: StyleJson): void => {
        if (theme === next) map.setStyle(themeStyle(style, palette, textScale) as unknown as MapStyle);
      };
      const known = styles.get(next);
      if (known) apply(known);
      else
        void fetchStyle(o.styles[next]).then((style) => {
          styles.set(next, style);
          apply(style);
        }, (err: unknown) => {
          // Keep the other theme's streets rather than none.
          console.warn('Track Me Live: the map style for the new theme didn’t load', err);
        });
    },
    remove() {
      map.remove();
    },
  };
}
