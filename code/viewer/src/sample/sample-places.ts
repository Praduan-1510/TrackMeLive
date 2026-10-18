/**
 * The sample city's stand-in for the sharer's phone looking its fix up (x-decisions Q-PLACE): the
 * session's `place`, with the park someone is in as the named place, the nearest named street, and
 * the nearest part of town as the area; while approximate, the area only. Reads the city's own
 * geometry, so the words always match the drawing. A real share gets them from the sharer's phone.
 */

import type { Place, Precision } from '@tml/shared/schema/generated/ts/schema';
import type { LatLng } from '../geo/geo';
import type { Pt } from '../map/camera';
import { CITY_AREAS, CITY_PARKS, CITY_STREETS } from '../map/svg/city';
import { project } from '../map/svg/projection';

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

/** What the sharer's phone would write for a fix at `at`, recorded at `recordedAt`. */
export function samplePlace(at: LatLng, precision: Precision, recordedAt: Date): Place<Date> {
  const p = project(at);
  const area = nearest(CITY_AREAS, (a) => Math.hypot(p[0] - a.center[0], p[1] - a.center[1]))?.name ?? 'Harbor';
  if (precision === 'approximate') return { name: null, street: null, area, city: null, at: recordedAt };
  const park = CITY_PARKS.find((k) => inside(p, k.outline));
  const street = nearest(CITY_STREETS, (s) => lineDistance(p, s.line))?.name ?? 'Harbor Way';
  return { name: park?.name ?? null, street, area, city: null, at: recordedAt };
}
