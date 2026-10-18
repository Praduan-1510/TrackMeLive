/**
 * Plain geography for the viewer page: how far apart two people are and which way, from latitude and
 * longitude alone. Nothing here knows about a map; the distance chip, the where line and the marker
 * phrases all read from these, whichever map draws the people.
 */

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/** Mean Earth radius (IUGG), in meters. */
export const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in meters (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `from` to `to`, in degrees clockwise from north, 0 to 360. */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const φ1 = rad(from.lat);
  const φ2 = rad(to.lat);
  const Δλ = rad(to.lng - from.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;
export type Compass = (typeof COMPASS)[number];

/** The nearest of the eight compass words for a bearing: "north-east". */
export function compass(bearing: number): Compass {
  const i = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
  return COMPASS[i] ?? 'north';
}
