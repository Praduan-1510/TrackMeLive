/**
 * Where someone is, in words: the nearest street, the park they're in, or (while the sharer is
 * approximate) only the area. A real share link asks the Maps API's Geocoder in the viewer's browser
 * (src/places/google.ts), through an in-memory cache (src/places/cache.ts), and never stores the
 * answer; without a Maps key it says where in coordinates (src/places/coordinates.ts). The sample
 * city answers from its own map (src/sample/sample-places.ts).
 */

import type { Precision } from '@tml/shared/schema/generated/ts/schema';
import type { LatLng } from '../geo/geo';

export type Place =
  /** "Near Harbor Way" */
  | { readonly kind: 'street'; readonly name: string }
  /** "In Alder Park" */
  | { readonly kind: 'park'; readonly name: string }
  /** "In the Market area": the only answer while the sharer is approximate. */
  | { readonly kind: 'area'; readonly name: string }
  /** "Near 37.7943° N, 122.3947° W": what the page says while no name has come back. */
  | { readonly kind: 'coordinates'; readonly lat: number; readonly lng: number };

export interface PlaceLookup {
  /** A lookup that can't name a street names the area; one that can't answer at all rejects. */
  describe(at: LatLng, precision: Precision): Promise<Place>;
  /** A lookup that costs a request asks at most once per this many ms while the sharer moves. */
  readonly minGapMs?: number;
}
