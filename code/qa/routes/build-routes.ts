/**
 * Builds the simulated routes (one <id>.json each, next to this file) from the specs below: real
 * San Francisco streets around the Ferry Building, where the viewer's sample city is centered
 * (code/viewer/src/map/svg/projection.ts). Each route is a list of waypoints and stops with a
 * cruising speed per leg; this turns that into a fix every second with realistic acceleration,
 * braking, waits at lights and GPS noise. The noise comes from a seeded generator, so a build always
 * writes the same files.
 *
 *   node code/qa/routes/build-routes.ts           write the route files
 *   node code/qa/routes/build-routes.ts --check   fail if a file isn't what the specs produce
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTE_FORMAT, ROUTES_DIR, bearingDegrees, distanceMeters, isMain, validateRoute, type Route, type RouteMode, type RoutePoint } from './route.ts';

type LatLng = readonly [lat: number, lng: number];

export type Step =
  /** Drive or walk through these waypoints, cruising at `cruise` m/s. */
  | { readonly go: readonly LatLng[]; readonly cruise: number }
  /** Stand still for this many seconds (a red light, a crossing, a look at the bay). */
  | { readonly stop: number };

export interface RouteSpec {
  readonly id: string;
  readonly title: string;
  readonly mode: RouteMode;
  readonly summary: string;
  readonly seed: number;
  /** m/s². */
  readonly accel: number;
  readonly brake: number;
  /** GPS error: standard deviation in meters, and how strongly one second's error carries into the next. */
  readonly noise_m: number;
  readonly accuracy: { readonly base: number; readonly spread: number };
  readonly start: LatLng;
  readonly steps: readonly Step[];
}

export const SPECS: readonly RouteSpec[] = [
  {
    id: 'walk-ferry-building',
    title: 'Walk: Embarcadero Plaza past the Ferry Building to Pier 7',
    mode: 'walk',
    summary: 'About 700 m on foot in 9 minutes: across The Embarcadero at Market (a wait for the light), then north along the waterfront promenade, with a short stop at Pier 3.',
    seed: 1,
    accel: 0.6,
    brake: 0.8,
    noise_m: 2.5,
    accuracy: { base: 5, spread: 4 },
    start: [37.79475, -122.3959],
    steps: [
      { go: [[37.795, -122.3947]], cruise: 1.35 },
      { stop: 25 },
      { go: [[37.79525, -122.394], [37.7961, -122.3943], [37.79735, -122.3952], [37.79815, -122.3959]], cruise: 1.4 },
      { stop: 12 },
      { go: [[37.7987, -122.3965], [37.79925, -122.3972]], cruise: 1.3 },
    ],
  },
  {
    id: 'drive-embarcadero-south',
    title: 'Drive: Ferry Building down The Embarcadero to Oracle Park',
    mode: 'drive',
    summary: 'About 2 km by car in under 5 minutes: south on The Embarcadero under the Bay Bridge, then King Street to 3rd, with three red lights.',
    seed: 2,
    accel: 1.8,
    brake: 2.2,
    noise_m: 2,
    accuracy: { base: 4, spread: 4 },
    start: [37.7947, -122.3933],
    steps: [
      { go: [[37.7931, -122.3919]], cruise: 10 },
      { stop: 30 },
      { go: [[37.7917, -122.3908], [37.7903, -122.38975], [37.7888, -122.3888]], cruise: 12 },
      { stop: 20 },
      { go: [[37.787, -122.388], [37.7845, -122.3877], [37.7816, -122.3883]], cruise: 13.5 },
      { go: [[37.7799, -122.3899]], cruise: 8 },
      { stop: 25 },
      { go: [[37.7783, -122.3917]], cruise: 9 },
    ],
  },
  {
    id: 'stopgo-market-street',
    title: 'Stop and go: Market Street from The Embarcadero to Powell',
    mode: 'stop-and-go',
    summary: 'About 1.5 km in rush-hour traffic in 9 minutes: short bursts between lights, crawls behind buses, and seven stops of 15 to 45 seconds between tall buildings, where the accuracy gets worse.',
    seed: 3,
    accel: 1.4,
    brake: 2,
    noise_m: 5,
    accuracy: { base: 9, spread: 14 },
    start: [37.79425, -122.39535],
    steps: [
      { go: [[37.79355, -122.3962], [37.7929, -122.397]], cruise: 6 },
      { stop: 35 },
      { go: [[37.79225, -122.39785]], cruise: 2.5 },
      { go: [[37.791, -122.3994]], cruise: 7 },
      { stop: 20 },
      { go: [[37.79025, -122.40035]], cruise: 5 },
      { stop: 40 },
      { go: [[37.7889, -122.40205]], cruise: 3 },
      { stop: 15 },
      { go: [[37.788, -122.4032]], cruise: 6 },
      { stop: 30 },
      { go: [[37.7873, -122.404]], cruise: 4 },
      { stop: 25 },
      { go: [[37.78575, -122.406]], cruise: 8 },
      { stop: 45 },
      { go: [[37.7848, -122.4076]], cruise: 5 },
    ],
  },
];

/** mulberry32: small, fast, and the same everywhere. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): () => number {
  return () => {
    const u = Math.max(rand(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
}

const M_PER_DEG_LAT = 111_320;
const round = (v: number, digits: number): number => Number(v.toFixed(digits));
const toPt = (p: LatLng): { lat: number; lng: number } => ({ lat: p[0], lng: p[1] });

/** A polyline with distance lookups. */
class Path {
  private readonly pts: readonly LatLng[];
  private readonly cum: number[] = [0];
  constructor(pts: readonly LatLng[]) {
    this.pts = pts;
    for (let i = 1; i < pts.length; i++) {
      this.cum.push((this.cum[i - 1] as number) + distanceMeters(toPt(pts[i - 1] as LatLng), toPt(pts[i] as LatLng)));
    }
  }
  get length(): number {
    return this.cum[this.cum.length - 1] as number;
  }
  /** The point `s` meters along, and the course of the segment it's on. */
  at(s: number): { p: LatLng; course: number } {
    let i = 1;
    while (i < this.cum.length - 1 && (this.cum[i] as number) < s) i++;
    const a = this.pts[i - 1] as LatLng;
    const b = this.pts[i] as LatLng;
    const len = (this.cum[i] as number) - (this.cum[i - 1] as number) || 1;
    const k = Math.min(1, Math.max(0, (s - (this.cum[i - 1] as number)) / len));
    return { p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], course: bearingDegrees(toPt(a), toPt(b)) };
  }
}

export function buildRoute(spec: RouteSpec): Route {
  const rand = rng(spec.seed);
  const normal = gaussian(rand);
  // GPS error wanders rather than jumping: each second keeps most of the last one (AR(1)).
  const carry = 0.85;
  const kick = spec.noise_m * Math.sqrt(1 - carry * carry);
  let errN = 0;
  let errE = 0;
  let accWander = 0;

  const points: RoutePoint[] = [];
  let here: LatLng = spec.start;
  let speed = 0;
  let course = 0;
  let traveled = 0;
  let t = 0;

  const emit = (p: LatLng): void => {
    errN = carry * errN + kick * normal();
    errE = carry * errE + kick * normal();
    accWander = Math.max(-1, Math.min(1, 0.8 * accWander + 0.35 * (rand() * 2 - 1)));
    const mPerDegLng = M_PER_DEG_LAT * Math.cos((p[0] * Math.PI) / 180);
    // Standing still between buildings, a fix gets worse; moving, it settles.
    const still = speed < 0.3 ? 1.25 : 1;
    points.push({
      t_s: t,
      lat: round(p[0] + errN / M_PER_DEG_LAT, 6),
      lng: round(p[1] + errE / mPerDegLng, 6),
      accuracy_m: Math.max(3, Math.round((spec.accuracy.base + spec.accuracy.spread * (accWander + 1) / 2) * still)),
      speed_mps: round(speed, 1),
      course_deg: Math.round(course) % 360,
    });
  };

  // The course at the start points at the first waypoint.
  const firstGo = spec.steps.find((s): s is Extract<Step, { go: unknown }> => 'go' in s);
  if (firstGo?.go[0]) course = bearingDegrees(toPt(spec.start), toPt(firstGo.go[0]));
  emit(here);

  spec.steps.forEach((step, i) => {
    if ('stop' in step) {
      speed = 0;
      for (let k = 0; k < step.stop; k++) {
        t += 1;
        emit(here);
      }
      return;
    }
    const next = spec.steps[i + 1];
    const endSpeed = next && 'go' in next ? Math.min(step.cruise, next.cruise) : 0;
    const path = new Path([here, ...step.go]);
    let s = 0;
    while (s < path.length - 1e-6) {
      const left = path.length - s;
      // Speed up toward cruise, but never so fast that braking can't reach endSpeed in time.
      const canStop = Math.sqrt(endSpeed * endSpeed + 2 * spec.brake * left);
      speed = Math.min(step.cruise, speed + spec.accel, canStop);
      // Creep the last meters rather than stall short of the line.
      if (speed < 0.4) speed = Math.min(0.4, left);
      const ds = Math.min(speed, left);
      s += ds;
      traveled += ds;
      t += 1;
      const at = path.at(s);
      course = at.course;
      here = at.p;
      emit(here);
    }
    speed = endSpeed;
  });

  const last = points[points.length - 1] as RoutePoint;
  if (last.speed_mps !== 0) points[points.length - 1] = { ...last, speed_mps: 0 };
  return validateRoute(
    {
      format: ROUTE_FORMAT,
      id: spec.id,
      title: spec.title,
      mode: spec.mode,
      summary: spec.summary,
      duration_s: last.t_s,
      distance_m: Math.round(traveled),
      points,
    },
    spec.id,
  );
}

/** Pretty JSON with one fix per line, so diffs stay readable. */
export function serializeRoute(r: Route): string {
  const head = { ...r, points: undefined };
  const lines = Object.entries(head)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  const pts = r.points.map((p, i) => `    ${JSON.stringify(p)}${i < r.points.length - 1 ? ',' : ''}`);
  return `{\n${lines.join('\n')}\n  "points": [\n${pts.join('\n')}\n  ]\n}\n`;
}

function main(): void {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const spec of SPECS) {
    const route = buildRoute(spec);
    const file = join(ROUTES_DIR, `${spec.id}.json`);
    const text = serializeRoute(route);
    if (check) {
      let current = '';
      try {
        current = readFileSync(file, 'utf8');
      } catch {
        // Missing counts as stale.
      }
      if (current !== text) {
        stale += 1;
        console.error(`stale: ${file} (run node code/qa/routes/build-routes.ts)`);
      }
      continue;
    }
    writeFileSync(file, text);
    console.log(`${spec.id}: ${String(route.points.length)} fixes, ${String(route.duration_s)} s, ${String(route.distance_m)} m`);
  }
  if (check) {
    if (stale > 0) process.exit(1);
    console.log(`ok: ${String(SPECS.length)} routes are current`);
  }
}

if (isMain(import.meta.url)) main();
