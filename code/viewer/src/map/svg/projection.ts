/**
 * Latitude and longitude to world pixels at 6 meters per pixel, equirectangular around an origin,
 * which is exact enough over the tens of kilometers an hour of sharing covers. The sample city's
 * origin is on Harbor Way, where the sample sharer is.
 */

import type { LatLng } from '../../geo/geo';
import type { Pt } from '../camera';

export const METERS_PER_PX = 6;
const ORIGIN: LatLng = { lat: 37.79432, lng: -122.39468 };
const M_PER_DEG_LAT = 111_320;

export interface Projection {
  project(p: LatLng): Pt;
  unproject(p: Pt): LatLng;
}

/** The same projection around any point: a real session's map is drawn around its first position. */
export function projectionAt(origin: LatLng): Projection {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);
  return {
    project: (p) => [((p.lng - origin.lng) * mPerDegLng) / METERS_PER_PX, (-(p.lat - origin.lat) * M_PER_DEG_LAT) / METERS_PER_PX],
    unproject: (p) => ({ lat: origin.lat - (p[1] * METERS_PER_PX) / M_PER_DEG_LAT, lng: origin.lng + (p[0] * METERS_PER_PX) / mPerDegLng }),
  };
}

/** The sample city's projection, with (0, 0) on Harbor Way. */
export const SAMPLE_PROJECTION = projectionAt(ORIGIN);
export const project = (p: LatLng): Pt => SAMPLE_PROJECTION.project(p);
export const unproject = (p: Pt): LatLng => SAMPLE_PROJECTION.unproject(p);
