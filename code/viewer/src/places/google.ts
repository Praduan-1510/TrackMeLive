/**
 * Where someone is, in words, from the Maps JavaScript API's Geocoder, in the viewer's browser (FSD
 * §4 "Where Alex is, in words"; §5: nothing is geocoded on the backend). Only with a Maps key, which
 * the build gets from VITE_MAPS_API_KEY; the key never lives in the repo.
 *
 *   precise       the park the point is in, else the nearest named street, else the area
 *   approximate   only the area: the neighborhood, else the district, else the town
 *
 * The API script loads on the first lookup, never before; a load that fails is tried again on the
 * next one (the PlaceAsker's backoff spaces them). Lookups are throttled (PLACE_GAP_MS) and cached in
 * memory (src/places/cache.ts).
 */

import type { Precision } from '@tml/shared/schema/generated/ts/schema';
import type { LatLng } from '../geo/geo';
import type { Place, PlaceLookup } from './lookup';

/** One reverse-geocoding result, as far as this page reads it. */
export interface GeocoderResult {
  readonly types: readonly string[];
  readonly address_components: readonly { readonly long_name: string; readonly types: readonly string[] }[];
}

export interface Geocoder {
  geocode(request: { readonly location: LatLng }): Promise<{ readonly results: readonly GeocoderResult[] }>;
}

/** At most one lookup this often while the sharer moves (a walker covers about 14 m in that time). */
export const PLACE_GAP_MS = 10_000;

/** Most specific first. */
const AREA_TYPES = ['neighborhood', 'sublocality_level_1', 'sublocality', 'locality', 'postal_town', 'administrative_area_level_2'] as const;
/** What the API calls a road it has no name for. */
const UNNAMED = new Set(['Unnamed Road']);

function component(results: readonly GeocoderResult[], type: string): string | null {
  for (const r of results) {
    for (const c of r.address_components) {
      const name = c.long_name.trim();
      if (c.types.includes(type) && name && !UNNAMED.has(name)) return name;
    }
  }
  return null;
}

function area(results: readonly GeocoderResult[]): Place | null {
  for (const type of AREA_TYPES) {
    const name = component(results, type);
    if (name) return { kind: 'area', name };
  }
  return null;
}

/** The place to name for these results (most specific first, as the API orders them), or null. */
export function placeFromResults(results: readonly GeocoderResult[], precision: Precision): Place | null {
  if (precision === 'approximate') return area(results);
  const first = results[0];
  const park = first?.types.includes('park') ? first.address_components[0]?.long_name.trim() : undefined;
  if (park) return { kind: 'park', name: park };
  const street = component(results, 'route');
  return street ? { kind: 'street', name: street } : area(results);
}

export function googlePlaces(geocoder: () => Promise<Geocoder>): PlaceLookup {
  return {
    minGapMs: PLACE_GAP_MS,
    async describe(at, precision) {
      const g = await geocoder();
      const { results } = await g.geocode({ location: { lat: at.lat, lng: at.lng } });
      const place = placeFromResults(results, precision);
      if (!place) throw new Error('The Geocoder had no name for this spot.');
      return place;
    },
  };
}

// ---------- Loading the Maps JavaScript API ----------

interface MapsNamespace {
  importLibrary(name: 'geocoding'): Promise<{ Geocoder: new () => Geocoder }>;
}
type MapsWindow = Window & { google?: { maps?: MapsNamespace } } & Record<string, unknown>;

const MAPS_SRC = 'https://maps.googleapis.com/maps/api/js';

/**
 * A Geocoder from the Maps JavaScript API, loading its script on the first call. Calls share one
 * load; one that fails (offline, a blocked script, a bad key) is forgotten, so the next call loads
 * again.
 */
export function mapsGeocoder(key: string, win: Window): () => Promise<Geocoder> {
  const w = win as MapsWindow;
  let loading: Promise<Geocoder> | null = null;
  const load = async (): Promise<Geocoder> => {
    if (!w.google?.maps) {
      await new Promise<void>((resolve, reject) => {
        const callback = `__tmlMapsReady${String(Date.now())}`;
        const script = win.document.createElement('script');
        const params = new URLSearchParams({ key, v: 'weekly', loading: 'async', libraries: 'geocoding', callback });
        w[callback] = () => {
          Reflect.deleteProperty(w, callback);
          resolve();
        };
        script.src = `${MAPS_SRC}?${params.toString()}`;
        script.async = true;
        script.onerror = () => {
          Reflect.deleteProperty(w, callback);
          script.remove();
          reject(new Error('The Maps JavaScript API didn’t load.'));
        };
        win.document.head.append(script);
      });
    }
    const maps = w.google?.maps;
    if (!maps) throw new Error('The Maps JavaScript API loaded without google.maps.');
    const { Geocoder } = await maps.importLibrary('geocoding');
    return new Geocoder();
  };
  return () => {
    loading ??= load().catch((err: unknown) => {
      loading = null;
      throw err;
    });
    return loading;
  };
}
