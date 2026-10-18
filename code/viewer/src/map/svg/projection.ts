/**
 * Latitude and longitude to world pixels at 6 meters per pixel around an origin: equirectangular for
 * the sample city (its origin is on Harbor Way, where the sample sharer is), and Web Mercator for a
 * real session, so the people line up with the street map drawn under them.
 */

import { EARTH_RADIUS_M, type LatLng } from '../../geo/geo';
import type { Camera, Pt } from '../camera';

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

// ---------- Web Mercator: a real session's map ----------

/** A web map's tiles are 512 px: at zoom z the whole world is 512 × 2^z px across. */
const WEB_TILE_PX = 512;
/** Web Mercator stops short of the poles. */
const MAX_LAT = 85.051129;
const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Web Mercator with the whole world 1 × 1: (0, 0) north-west, (1, 1) south-east, as web maps use it. */
export function mercator(p: LatLng): Pt {
  const lat = rad(Math.max(-MAX_LAT, Math.min(MAX_LAT, p.lat)));
  return [(p.lng + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2];
}

export function fromMercator(m: Pt): LatLng {
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * m[1]))) * 180) / Math.PI;
  return { lat, lng: m[0] * 360 - 180 };
}

export interface MercatorProjection extends Projection {
  /** World px per Mercator unit. */
  readonly scale: number;
  /** The zoom at which this world lines up with a web map at zoom `webZoom`. */
  zoomFor(webZoom: number): number;
  /** The web map's zoom that matches this zoom. */
  webZoom(zoom: number): number;
}

/**
 * Web Mercator around `origin`, scaled to METERS_PER_PX there: the street map's own world, only
 * scaled and shifted, so markers drawn in it sit exactly on the streets under them at any distance
 * from the origin (src/map/open/). The plain backdrop uses it too, so the two always agree.
 */
export function mercatorAt(origin: LatLng): MercatorProjection {
  const [ox, oy] = mercator(origin);
  const scale = (2 * Math.PI * EARTH_RADIUS_M * Math.cos(rad(origin.lat))) / METERS_PER_PX;
  return {
    scale,
    project: (p) => {
      const [x, y] = mercator(p);
      return [(x - ox) * scale, (y - oy) * scale];
    },
    unproject: (p) => fromMercator([ox + p[0] / scale, oy + p[1] / scale]),
    zoomFor: (webZoom) => (WEB_TILE_PX * 2 ** webZoom) / scale,
    webZoom: (zoom) => Math.log2((zoom * scale) / WEB_TILE_PX),
  };
}

/** Where a web map's camera goes to show what this camera shows, in a viewport of this size. */
export function webCamera(cam: Camera, size: { readonly width: number; readonly height: number }, proj: MercatorProjection): { center: LatLng; zoom: number } {
  const center = proj.unproject([(size.width / 2 - cam.x) / cam.zoom, (size.height / 2 - cam.y) / cam.zoom]);
  return { center, zoom: proj.webZoom(cam.zoom) };
}
