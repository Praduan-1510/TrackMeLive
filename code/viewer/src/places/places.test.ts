import { describe, expect, it, vi } from 'vitest';
import type { Precision } from '@tml/shared/schema/generated/ts/schema';
import { HERE, MOM } from '../test-fixtures';
import { CACHE_SIZE, cachedPlaces } from './cache';
import { coordinatesOnly } from './coordinates';
import { googlePlaces, mapsGeocoder, placeFromResults, PLACE_GAP_MS, type Geocoder, type GeocoderResult } from './google';
import type { Place, PlaceLookup } from './lookup';

const c = (long_name: string, ...types: string[]) => ({ long_name, types });
const STREET_RESULT: GeocoderResult = {
  types: ['street_address'],
  address_components: [c('1', 'street_number'), c('Harbor Way', 'route'), c('Market', 'neighborhood', 'political'), c('San Francisco', 'locality', 'political')],
};
const PARK_RESULT: GeocoderResult = { types: ['establishment', 'park', 'point_of_interest'], address_components: [c('Alder Park', 'establishment', 'park')] };

describe('placeFromResults', () => {
  it('names the street, or the park the point is in', () => {
    expect(placeFromResults([STREET_RESULT], 'precise')).toEqual({ kind: 'street', name: 'Harbor Way' });
    expect(placeFromResults([PARK_RESULT, STREET_RESULT], 'precise')).toEqual({ kind: 'park', name: 'Alder Park' });
  });
  it('names only the area while approximate, most specific first', () => {
    expect(placeFromResults([PARK_RESULT, STREET_RESULT], 'approximate')).toEqual({ kind: 'area', name: 'Market' });
    const town: GeocoderResult = { types: ['locality'], address_components: [c('Oakland', 'locality')] };
    expect(placeFromResults([town], 'approximate')).toEqual({ kind: 'area', name: 'Oakland' });
  });
  it('falls back to the area without a named street, and to nothing at all', () => {
    const unnamed: GeocoderResult = { types: ['route'], address_components: [c('Unnamed Road', 'route'), c('Dogpatch', 'neighborhood')] };
    expect(placeFromResults([unnamed], 'precise')).toEqual({ kind: 'area', name: 'Dogpatch' });
    expect(placeFromResults([], 'precise')).toBeNull();
    expect(placeFromResults([{ types: ['plus_code'], address_components: [c('QHJ7+X2', 'plus_code')] }], 'approximate')).toBeNull();
  });
});

describe('googlePlaces', () => {
  it('asks the Geocoder for the point, throttled', async () => {
    const geocode = vi.fn((_r: { location: { lat: number; lng: number } }) => Promise.resolve({ results: [STREET_RESULT] }));
    const lookup = googlePlaces(() => Promise.resolve({ geocode }));
    expect(lookup.minGapMs).toBe(PLACE_GAP_MS);
    await expect(lookup.describe(HERE, 'precise')).resolves.toEqual({ kind: 'street', name: 'Harbor Way' });
    expect(geocode).toHaveBeenCalledWith({ location: { lat: HERE.lat, lng: HERE.lng } });
  });
  it('rejects when there’s no name, or the Geocoder or its script fails', async () => {
    await expect(googlePlaces(() => Promise.resolve({ geocode: () => Promise.resolve({ results: [] }) })).describe(HERE, 'precise')).rejects.toThrow();
    await expect(googlePlaces(() => Promise.resolve({ geocode: () => Promise.reject(new Error('ZERO_RESULTS')) })).describe(HERE, 'precise')).rejects.toThrow();
    await expect(googlePlaces(() => Promise.reject(new Error('no script'))).describe(HERE, 'precise')).rejects.toThrow();
  });
});

/** A window with just enough DOM for the loader: scripts are recorded, and the test loads or fails them. */
function fakeWindow() {
  const scripts: { src: string; async: boolean; onerror: (() => void) | null; removed: boolean; remove(): void }[] = [];
  const win: Record<string, unknown> = {
    document: {
      createElement: () => {
        const s = { src: '', async: false, onerror: null, removed: false, remove: () => (s.removed = true) };
        return s;
      },
      head: { append: (s: (typeof scripts)[number]) => scripts.push(s) },
    },
  };
  const geocoder: Geocoder = { geocode: () => Promise.resolve({ results: [STREET_RESULT] }) };
  const load = (): void => {
    win.google = { maps: { importLibrary: () => Promise.resolve({ Geocoder: function G() { return geocoder; } }) } };
    const cb = new URL(scripts.at(-1)?.src ?? '').searchParams.get('callback') ?? '';
    (win[cb] as () => void)();
  };
  return { win: win as unknown as Window, raw: win, scripts, load, geocoder };
}

describe('mapsGeocoder', () => {
  it('loads the API once, on the first lookup, with the key and the geocoding library', async () => {
    const f = fakeWindow();
    const get = mapsGeocoder('test-key', f.win);
    expect(f.scripts).toHaveLength(0);
    const a = get();
    const b = get();
    expect(f.scripts).toHaveLength(1);
    const url = new URL(f.scripts[0]?.src ?? '');
    expect(url.origin + url.pathname).toBe('https://maps.googleapis.com/maps/api/js');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ key: 'test-key', libraries: 'geocoding', loading: 'async', v: 'weekly' });
    expect(f.scripts[0]?.async).toBe(true);
    f.load();
    await expect(a).resolves.toBe(f.geocoder);
    await expect(b).resolves.toBe(f.geocoder);
    // The callback is cleaned up, and later lookups reuse the loaded API.
    expect(Object.keys(f.raw).filter((k) => k.startsWith('__tmlMapsReady'))).toEqual([]);
    await expect(get()).resolves.toBe(f.geocoder);
    expect(f.scripts).toHaveLength(1);
  });

  it('forgets a script that failed to load, so the next lookup loads it again', async () => {
    const f = fakeWindow();
    const get = mapsGeocoder('k', f.win);
    const first = get();
    f.scripts[0]?.onerror?.();
    await expect(first).rejects.toThrow('didn’t load');
    expect(f.scripts[0]?.removed).toBe(true);
    const second = get();
    expect(f.scripts).toHaveLength(2);
    f.load();
    await expect(second).resolves.toBe(f.geocoder);
  });
});

describe('coordinatesOnly', () => {
  it('says where in coordinates, without a request', async () => {
    await expect(coordinatesOnly.describe(HERE, 'precise')).resolves.toEqual({ kind: 'coordinates', lat: HERE.lat, lng: HERE.lng });
    expect(coordinatesOnly.minGapMs).toBeUndefined();
  });
});

describe('cachedPlaces', () => {
  const counting = (answer: (n: number) => Promise<Place>): PlaceLookup & { calls: { at: string; precision: Precision }[] } => {
    const calls: { at: string; precision: Precision }[] = [];
    return {
      calls,
      minGapMs: 7,
      describe: (at, precision) => {
        calls.push({ at: `${String(at.lat)},${String(at.lng)}`, precision });
        return answer(calls.length);
      },
    };
  };

  it('asks once per spot (to about 11 m) and precision, and shares a request in flight', async () => {
    const inner = counting((n) => Promise.resolve({ kind: 'street', name: `Street ${String(n)}` }));
    const lookup = cachedPlaces(inner);
    expect(lookup.minGapMs).toBe(7);
    const [a, b] = await Promise.all([lookup.describe(HERE, 'precise'), lookup.describe(HERE, 'precise')]);
    expect(a).toEqual({ kind: 'street', name: 'Street 1' });
    expect(b).toBe(a);
    await expect(lookup.describe({ lat: HERE.lat + 0.00001, lng: HERE.lng }, 'precise')).resolves.toEqual(a);
    await lookup.describe(HERE, 'approximate');
    await lookup.describe(MOM, 'precise');
    expect(inner.calls).toHaveLength(3);
  });

  it('keeps no failures, and drops the least recently used spot when full', async () => {
    let fail = true;
    const inner = counting(() => (fail ? Promise.reject(new Error('no')) : Promise.resolve({ kind: 'street', name: 'X' })));
    const lookup = cachedPlaces(inner, 2);
    await expect(lookup.describe(HERE, 'precise')).rejects.toThrow();
    fail = false;
    await lookup.describe(HERE, 'precise');
    expect(inner.calls).toHaveLength(2);
    await lookup.describe(MOM, 'precise');
    await lookup.describe(HERE, 'precise'); // HERE is now the most recent
    await lookup.describe({ lat: 1, lng: 1 }, 'precise'); // MOM goes
    await lookup.describe(HERE, 'precise');
    expect(inner.calls).toHaveLength(4);
    await lookup.describe(MOM, 'precise');
    expect(inner.calls).toHaveLength(5);
    expect(CACHE_SIZE).toBeGreaterThan(100);
  });

  it('passes no gap on for a lookup that has none', () => {
    expect(cachedPlaces(coordinatesOnly).minGapMs).toBeUndefined();
  });
});
