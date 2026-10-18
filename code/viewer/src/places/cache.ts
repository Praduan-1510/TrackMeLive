/**
 * An in-memory cache in front of a PlaceLookup: the same spot (to about 11 m) at the same precision
 * is asked once, and two asks for it at once share one request. It lives only as long as the page;
 * nothing is ever written to storage (FSD §4: the street name is never stored). Failures aren't
 * kept, so a spot that failed is asked again.
 */

import type { Place, PlaceLookup } from './lookup';

/** Entries kept, most recently used last: about an hour of walking, at one per 25 m. */
export const CACHE_SIZE = 200;

export function cachedPlaces(inner: PlaceLookup, size = CACHE_SIZE): PlaceLookup {
  const done = new Map<string, Place>();
  const asking = new Map<string, Promise<Place>>();
  return {
    ...(inner.minGapMs === undefined ? {} : { minGapMs: inner.minGapMs }),
    describe(at, precision) {
      const key = `${precision}|${at.lat.toFixed(4)},${at.lng.toFixed(4)}`;
      const hit = done.get(key);
      if (hit) {
        done.delete(key);
        done.set(key, hit);
        return Promise.resolve(hit);
      }
      const pending = asking.get(key);
      if (pending) return pending;
      const ask = inner.describe(at, precision).then(
        (place) => {
          asking.delete(key);
          done.set(key, place);
          for (const old of done.keys()) {
            if (done.size <= size) break;
            done.delete(old);
          }
          return place;
        },
        (err: unknown) => {
          asking.delete(key);
          throw err;
        },
      );
      asking.set(key, ask);
      return ask;
    },
  };
}
