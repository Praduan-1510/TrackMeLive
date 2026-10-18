/**
 * The sample city's place lookup: the park someone is in, or the nearest named street, or (while the
 * sharer is approximate) the nearest part of town. Reads the city's own geometry, so the words always
 * match the drawing. The real page asks the Maps API in the browser (Sprint 2).
 */

import type { Precision } from '@tml/shared/schema/generated/ts/schema';
import type { LatLng } from '../geo/geo';
import type { Pt } from '../map/camera';
import { CITY_AREAS, CITY_PARKS, CITY_STREETS } from '../map/svg/city';
import { project } from '../map/svg/projection';
import type { Place, PlaceLookup } from '../places/lookup';

function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function lineDistance(p: Pt, line: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    if (a && b) best = Math.min(best, segmentDistance(p, a, b));
  }
  return best;
}

/** Even-odd ray casting. */
function inside(p: Pt, outline: readonly Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const b = outline[j];
    if (a && b && a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

function nearest<T>(items: readonly T[], distance: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestD = Infinity;
  for (const item of items) {
    const d = distance(item);
    if (d < bestD) {
      best = item;
      bestD = d;
    }
  }
  return best;
}

export function describeSamplePlace(at: LatLng, precision: Precision): Place {
  const p = project(at);
  if (precision === 'approximate') {
    const area = nearest(CITY_AREAS, (a) => Math.hypot(p[0] - a.center[0], p[1] - a.center[1]));
    return { kind: 'area', name: area?.name ?? 'Harbor' };
  }
  const park = CITY_PARKS.find((k) => inside(p, k.outline));
  if (park) return { kind: 'park', name: park.name };
  const street = nearest(CITY_STREETS, (s) => lineDistance(p, s.line));
  return { kind: 'street', name: street?.name ?? 'Harbor Way' };
}

export const samplePlaces: PlaceLookup = {
  describe: (at, precision) => Promise.resolve(describeSamplePlace(at, precision)),
};
