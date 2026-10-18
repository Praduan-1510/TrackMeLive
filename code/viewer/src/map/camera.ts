/**
 * Framing math for a map drawn in world pixels: where the camera goes so the people sit inside the
 * open band the page leaves (between the bar and the sheet on a phone, beside the column on a wide
 * screen), zooming out only when two people don't fit. Pure, so it's tested without a browser.
 */

import type { Band } from './map-view';

export type Pt = readonly [x: number, y: number];

/** screen = world × zoom + (x, y), in viewport CSS pixels. */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface FrameLimits {
  /** Room kept around each person for their marker, halo and name capsule. */
  readonly pad: number;
  readonly minZoom: number;
  readonly maxZoom: number;
  /** A marker's visible bulk (halo above, name below) sits a little under its point. */
  readonly lift: number;
}

export const toScreen = (c: Camera, p: Pt): Pt => [p[0] * c.zoom + c.x, p[1] * c.zoom + c.y];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function frameCamera(points: readonly Pt[], band: Band, limits: FrameLimits): Camera {
  if (points.length === 0) return { x: 0, y: 0, zoom: limits.maxZoom };
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const roomW = Math.max(1, band.right - band.left - 2 * limits.pad);
  const roomH = Math.max(1, band.bottom - band.top - 2 * limits.pad);
  const fit = Math.min(x1 > x0 ? roomW / (x1 - x0) : Infinity, y1 > y0 ? roomH / (y1 - y0) : Infinity);
  const zoom = clamp(fit, limits.minZoom, limits.maxZoom);
  const cx = (band.left + band.right) / 2;
  const cy = (band.top + band.bottom) / 2 - limits.lift;
  return { x: cx - ((x0 + x1) / 2) * zoom, y: cy - ((y0 + y1) / 2) * zoom, zoom };
}

/** Whether every point sits at least `inset` px inside the band under this camera. */
export function keepsInBand(c: Camera, points: readonly Pt[], band: Band, inset: number): boolean {
  return points.every((p) => {
    const [x, y] = toScreen(c, p);
    return x >= band.left + inset && x <= band.right - inset && y >= band.top + inset && y <= band.bottom - inset;
  });
}

export const sameCamera = (a: Camera, b: Camera): boolean =>
  Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.zoom - b.zoom) < 0.001;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerpPt = (a: Pt, b: Pt, t: number): Pt => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
export const lerpCamera = (a: Camera, b: Camera, t: number): Camera => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), zoom: lerp(a.zoom, b.zoom, t) });

/** Ease-out, close to the page's cubic-bezier(.3, .7, .3, 1) pan curve. */
export const easeOut = (t: number): number => 1 - (1 - t) ** 3;
