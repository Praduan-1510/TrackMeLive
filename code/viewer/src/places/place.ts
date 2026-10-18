/**
 * Where someone is, in words (FSD §4 "Where Alex is, in words"), as the page says it. The words come
 * from the sharer's phone, on the session (src/places/session-place.ts); the page never calls a
 * geocoder (owner decision Oct 19, code/OPEN-DECISIONS.md).
 */

export type Place =
  /** "At Ferry Building": a park, landmark or venue at the sharer's fix. */
  | { readonly kind: 'named'; readonly name: string }
  /** "Near Harbor Way" */
  | { readonly kind: 'street'; readonly name: string }
  /** "In the Market area": the only words while the sharer is approximate. */
  | { readonly kind: 'area'; readonly name: string }
  /** "Near 37.7943° N, 122.3947° W", or "Approximate location": no words to trust. */
  | { readonly kind: 'coordinates'; readonly lat: number; readonly lng: number };
