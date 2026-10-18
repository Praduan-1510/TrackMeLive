/**
 * The sample city's projection: latitude and longitude to world pixels at 6 meters per pixel, with
 * (0, 0) on Harbor Way where the sample sharer is. Equirectangular around that point, which is exact
 * enough over the few kilometers the drawing covers.
 */

import type { LatLng } from '../../geo/geo';
import type { Pt } from '../camera';

export const METERS_PER_PX = 6;
const ORIGIN: LatLng = { lat: 37.79432, lng: -122.39468 };
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

export function project(p: LatLng): Pt {
  return [((p.lng - ORIGIN.lng) * M_PER_DEG_LNG) / METERS_PER_PX, (-(p.lat - ORIGIN.lat) * M_PER_DEG_LAT) / METERS_PER_PX];
}

export function unproject(p: Pt): LatLng {
  return { lat: ORIGIN.lat - (p[1] * METERS_PER_PX) / M_PER_DEG_LAT, lng: ORIGIN.lng + (p[0] * METERS_PER_PX) / M_PER_DEG_LNG };
}
