/**
 * Asks the PlaceLookup where the sharer is, in words, as they move: again once they've moved 25 m
 * (or their precision changed), one request at a time. A point counts as named only once a name came
 * back, so a failed lookup is asked again even while the sharer stands still, with capped backoff:
 * 5 s, 15 s, then every 60 s. Until a name arrives the page says where in coordinates, so it never
 * waits on a name forever.
 */

import type { Precision } from '@tml/shared/schema/generated/ts/schema';
import { distanceMeters, type LatLng } from '../geo/geo';
import type { Place, PlaceLookup } from '../places/lookup';

const MOVE_M = 25;
export const PLACE_BACKOFF_MS = [5_000, 15_000, 60_000] as const;

export class PlaceAsker {
  private readonly lookup: PlaceLookup;
  private readonly onPlace: (place: Place) => void;
  private readonly now: () => number;
  /** The last point a name came back for. */
  private named: { readonly at: LatLng; readonly precision: Precision } | null = null;
  private pending = false;
  private failures = 0;
  private retryAt = 0;

  constructor(lookup: PlaceLookup, onPlace: (place: Place) => void, now: () => number) {
    this.lookup = lookup;
    this.onPlace = onPlace;
    this.now = now;
  }

  /** Called whenever the sharer's newest point may have changed; asks only when it should. */
  update(at: LatLng, precision: Precision): void {
    if (this.pending || this.now() < this.retryAt) return;
    const n = this.named;
    if (n && n.precision === precision && distanceMeters(n.at, at) < MOVE_M) return;
    this.pending = true;
    this.lookup.describe(at, precision).then(
      (place) => {
        this.pending = false;
        this.failures = 0;
        this.retryAt = 0;
        this.named = { at, precision };
        this.onPlace(place);
      },
      () => {
        this.pending = false;
        this.retryAt = this.now() + (PLACE_BACKOFF_MS[Math.min(this.failures, PLACE_BACKOFF_MS.length - 1)] ?? 0);
        this.failures += 1;
        // Nothing named yet: say where in coordinates, rather than keep the page waiting.
        if (!this.named) this.onPlace({ kind: 'coordinates', lat: at.lat, lng: at.lng });
      },
    );
  }
}
