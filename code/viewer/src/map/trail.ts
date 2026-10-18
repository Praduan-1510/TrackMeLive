/**
 * The sharer's trail: round dots at recent pings, every one at full strength, age shown by size
 * (about 8px across for the newest down to about 4px for the oldest), and dots never touch each
 * other or the marker (design-system/README.md, The map).
 */

import type { Pt } from './camera';

export interface TrailDot {
  readonly at: Pt;
  readonly r: number;
}

export interface TrailSpacing {
  /** Least distance between two dots' centers, in the same units as the points. */
  readonly gap: number;
  /** Least distance from the marker's point to the newest dot. */
  readonly clear: number;
  readonly max: number;
}

/** From earlier positions (oldest first), the dots to draw (oldest first), newest kept first. */
export function trailDots(earlier: readonly Pt[], marker: Pt, spacing: TrailSpacing): TrailDot[] {
  const kept: Pt[] = [];
  let last = marker;
  let need = spacing.clear;
  for (let i = earlier.length - 1; i >= 0 && kept.length < spacing.max; i--) {
    const p = earlier[i];
    if (p && Math.hypot(p[0] - last[0], p[1] - last[1]) >= need) {
      kept.push(p);
      last = p;
      need = spacing.gap;
    }
  }
  const n = kept.length;
  // kept is newest first; draw oldest first so the newest sits on top.
  return kept.reverse().map((at, i) => ({ at, r: 2 + (2 * (i + 1)) / n }));
}
