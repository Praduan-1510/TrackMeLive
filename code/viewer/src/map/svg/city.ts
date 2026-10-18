/**
 * The sample city the SVG map draws: land, a street grid with building blocks, parks, the harbor,
 * Harbor Way and labels, all in the map tokens (CSS classes in src/styles/map.css). World units are
 * pixels at 6 meters each (projection.ts), with (0, 0) on Harbor Way. Built once as a string.
 *
 * Also the city's named places, which the sample place lookup (src/sample/sample-places.ts) reads to
 * say where someone is in words. The real page asks the Maps API instead.
 */

import type { Pt } from '../camera';

// ---------- Geometry helpers ----------

const n1 = (v: number): number => Math.round(v * 10) / 10;
const pt = (p: Pt): string => `${String(n1(p[0]))} ${String(n1(p[1]))}`;
const add = (a: Pt, b: Pt, k = 1): Pt => [a[0] + b[0] * k, a[1] + b[1] * k];
const unit = (v: Pt): Pt => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};
const at = <T>(xs: readonly T[], i: number): T => xs[Math.max(0, Math.min(xs.length - 1, i))] as T;

/** A smooth path through points (Catmull-Rom as cubic Béziers). */
function smooth(pts: readonly Pt[]): string {
  let d = `M${pt(at(pts, 0))}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = at(pts, i - 1);
    const p1 = at(pts, i);
    const p2 = at(pts, i + 1);
    const p3 = at(pts, i + 2);
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return d;
}

function roundRect(x0: number, y0: number, x1: number, y1: number, r: number): string {
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 2 * r || h <= 2 * r) return '';
  const s = (v: number): string => String(n1(v));
  return `M${s(x0 + r)} ${s(y0)}h${s(w - 2 * r)}a${s(r)} ${s(r)} 0 0 1 ${s(r)} ${s(r)}v${s(h - 2 * r)}a${s(r)} ${s(r)} 0 0 1 ${s(-r)} ${s(r)}h${s(-(w - 2 * r))}a${s(r)} ${s(r)} 0 0 1 ${s(-r)} ${s(-r)}v${s(-(h - 2 * r))}a${s(r)} ${s(r)} 0 0 1 ${s(r)} ${s(-r)}z`;
}

/** Deterministic randomness, so the city is the same on every load. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Harbor Way: the main road, running up and to the right through (0, 0) at t = 0.5 ----------

const P0: Pt = [-2400, 1300];
const P1: Pt = [-900, 900];
const P2: Pt = [900, -2500 / 3];
const P3: Pt = [2400, -1500];
const HARBOR_WAY_D = `M${pt(P0)}C${pt(P1)} ${pt(P2)} ${pt(P3)}`;

/** A point on Harbor Way, t from 0 (lower left) to 1 (upper right). */
export function harborWayAt(t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * P0[0] + b * P1[0] + c * P2[0] + d * P3[0], a * P0[1] + b * P1[1] + c * P2[1] + d * P3[1]];
}
function tangent(t: number): Pt {
  const u = 1 - t;
  const k = (i: 0 | 1): number => 3 * u * u * (P1[i] - P0[i]) + 6 * u * t * (P2[i] - P1[i]) + 3 * t * t * (P3[i] - P2[i]);
  return unit([k(0), k(1)]);
}
/** The normal on the harbor side (down and to the right). */
function seaward(t: number): Pt {
  const [x, y] = tangent(t);
  return [-y, x];
}
/** Arc length along Harbor Way, for label offsets. */
const ARC_STEPS = 1200;
const ARC = ((): Float64Array => {
  const s = new Float64Array(ARC_STEPS + 1);
  let prev = harborWayAt(0);
  for (let i = 1; i <= ARC_STEPS; i++) {
    const p = harborWayAt(i / ARC_STEPS);
    s[i] = (s[i - 1] ?? 0) + Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return s;
})();
const arcAt = (t: number): number => ARC[Math.round(t * ARC_STEPS)] ?? 0;
const S_ORIGIN = arcAt(0.5);

/** How far the shore is from Harbor Way: 165 px at (0, 0), wandering elsewhere. */
const shoreOffset = (t: number): number => 165 + 70 * Math.sin(6 * Math.PI * (t - 0.5)) + 22 * Math.sin(14 * Math.PI * (t - 0.5));
const shoreAt = (t: number): Pt => add(harborWayAt(t), seaward(t), shoreOffset(t));

// ---------- The street grid (drawn inside a group rotated by GRID_ANGLE) ----------

const GRID_ANGLE = -4;
const EXTENT = 3600;
const MARKET_X = -150;
const rand = rng(20261018);

const H: number[] = [];
for (let y = 72; y < EXTENT; y += 150 + rand() * 40) H.push(n1(y));
for (let y = -98; y > -EXTENT; y -= 150 + rand() * 40) H.push(n1(y));
H.sort((a, b) => a - b);
const V: number[] = [];
for (let x = 96; x < EXTENT; x += 124 + rand() * 36) V.push(n1(x));
for (let x = MARKET_X; x > -EXTENT; x -= 124 + rand() * 36) V.push(n1(x));
V.sort((a, b) => a - b);
const iM = V.indexOf(MARKET_X);
const jA = H.indexOf(-98);
const vx = (i: number): number => at(V, iM + i);
const hy = (j: number): number => at(H, jA + j);

/** From the grid's own (rotated) frame to world pixels. */
const ROT = (GRID_ANGLE * Math.PI) / 180;
const fromGrid = (p: Pt): Pt => [p[0] * Math.cos(ROT) - p[1] * Math.sin(ROT), p[0] * Math.sin(ROT) + p[1] * Math.cos(ROT)];

function gridRoads(): string {
  let d = '';
  for (const y of H) d += `M${String(-EXTENT)} ${String(y)}H${String(EXTENT)}`;
  for (const x of V) if (x !== MARKET_X) d += `M${String(x)} ${String(-EXTENT)}V${String(EXTENT)}`;
  return d;
}

function blocks(): string {
  let d = '';
  const r = 4;
  for (let i = 0; i < V.length - 1; i++) {
    for (let j = 0; j < H.length - 1; j++) {
      const x0 = at(V, i) + 11;
      const x1 = at(V, i + 1) - 11;
      const y0 = at(H, j) + 11;
      const y1 = at(H, j + 1) - 11;
      if (x1 < -2400 || x0 > 2400 || y1 < -1500 || y0 > 1500) continue;
      const k = rand();
      if (k < 0.1) continue; // an open lot or a plaza
      if (k < 0.5) {
        // Two buildings with an alley between them, across the longer side.
        const alongX = x1 - x0 > y1 - y0;
        const m = (alongX ? (x0 + x1) / 2 : (y0 + y1) / 2) + (rand() - 0.5) * 24;
        d += alongX
          ? roundRect(x0, y0, m - 4, y1, r) + roundRect(m + 4, y0, x1, y1, r)
          : roundRect(x0, y0, x1, m - 4, r) + roundRect(x0, m + 4, x1, y1, r);
      } else if (k > 0.86) {
        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2;
        d +=
          roundRect(x0, y0, mx - 4, my - 4, r) +
          roundRect(mx + 4, y0, x1, my - 4, r) +
          roundRect(x0, my + 4, mx - 4, y1, r) +
          roundRect(mx + 4, my + 4, x1, y1, r);
      } else {
        d += roundRect(x0, y0, x1, y1, r);
      }
    }
  }
  return d;
}

interface Cell {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}
/** Parks that fill whole blocks (the streets inside them stop at their edges). */
const cell = (i0: number, i1: number, j0: number, j1: number): Cell => ({ x0: vx(i0) + 10, x1: vx(i1) - 10, y0: hy(j0) + 10, y1: hy(j1) - 10 });
const ALDER = cell(0, 1, -2, 0);
const LANTERN = cell(-4, -3, -3, -2);
const MILL = cell(4, 6, -5, -4);

// ---------- The harbor ----------

function water(): string {
  const shore: Pt[] = [];
  for (let i = 0; i <= 96; i++) shore.push(shoreAt(i / 96));
  const s0 = at(shore, 0);
  const s1 = at(shore, shore.length - 1);
  const far = String(EXTENT * 2);
  return `${smooth(shore)}L${far} ${String(n1(s1[1]))}L${far} ${far}L${String(n1(s0[0]))} ${far}Z`;
}

/** Quay Gardens: a waterfront park between Harbor Way and the shore, tapering at both ends. */
const QUAY = { t0: 0.528, t1: 0.61, inner: 26, maxWidth: 120 };
const quayWidth = (t: number): number => {
  const u = (t - QUAY.t0) / (QUAY.t1 - QUAY.t0);
  return Math.max(0, Math.min(shoreOffset(t) - QUAY.inner - 16, QUAY.maxWidth)) * Math.sqrt(Math.max(0, Math.sin(Math.PI * u)));
};
function quayOutline(): { inner: Pt[]; outer: Pt[] } {
  const inner: Pt[] = [];
  const outer: Pt[] = [];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const t = QUAY.t0 + ((QUAY.t1 - QUAY.t0) * i) / steps;
    inner.push(add(harborWayAt(t), seaward(t), QUAY.inner));
    outer.push(add(harborWayAt(t), seaward(t), QUAY.inner + quayWidth(t)));
  }
  return { inner, outer };
}
function quayGardens(): string {
  const { inner, outer } = quayOutline();
  return `${smooth(inner)}L${pt(at(outer, outer.length - 1))}${smooth(outer.slice().reverse()).replace(/^M[^C]*/, '')}Z`;
}

function piers(): string {
  const r = rng(77);
  let d = '';
  for (let t = 0.07; t < 0.95; t += 0.03) {
    if (r() < 0.25) continue;
    const tt = t + (r() - 0.5) * 0.01;
    const s = shoreAt(tt);
    const nrm = seaward(tt);
    const tan = tangent(tt);
    const len = 44 + r() * 64;
    const half = 6 + r() * 5;
    const b = add(s, nrm, -8);
    const a1 = add(b, tan, -half);
    const a2 = add(b, tan, half);
    d += `M${pt(a1)}L${pt(a2)}L${pt(add(a2, nrm, len))}L${pt(add(a1, nrm, len))}Z`;
  }
  return d;
}

// ---------- Labels: caption-2 or larger at every zoom, sentence case ----------

const label = (text: string, x: number, y: number, cls: string, rotate = 0): string =>
  `<text class="m-label ${cls}" x="${String(n1(x))}" y="${String(n1(y))}" text-anchor="middle"${rotate ? ` transform="rotate(${String(n1(rotate))} ${String(n1(x))} ${String(n1(y))})"` : ''}>${text}</text>`;

function harborWayLabels(): string {
  return [118, -640, 900, -1500, 1720]
    .map((ds) => `<text class="m-label on-major"><textPath href="#harbor-way" startOffset="${String(n1(S_ORIGIN + ds))}" text-anchor="middle">Harbor Way</textPath></text>`)
    .join('');
}

const mid = (a: number, b: number): number => (a + b) / 2;

/** Labels in the grid's own (rotated) frame: streets and parks. */
function gridLabels(): string {
  return [
    label('Market St', MARKET_X, -36, 'on-major', -90),
    label('Market St', MARKET_X, mid(hy(-4), hy(-3)), 'on-major', -90),
    label('Alder Park', mid(ALDER.x0, ALDER.x1), ALDER.y1 - 18, 'on-park'),
    label('Lantern Square', mid(LANTERN.x0, LANTERN.x1), mid(LANTERN.y0, LANTERN.y1), 'on-park'),
    label('Mill Commons', mid(MILL.x0, MILL.x1), mid(MILL.y0, MILL.y1), 'on-park'),
    label('Cedar Ave', vx(-2) + 70, hy(-2), 'on-road'),
    label('Orchard St', vx(2) + 66, hy(-4), 'on-road'),
    label('Lantern St', vx(-6) + 64, hy(-1), 'on-road'),
    label('Mill Rd', vx(3), mid(hy(-3), hy(-2)), 'on-road', -90),
    label('Ferry Ln', vx(-3), mid(hy(1), hy(2)), 'on-road', -90),
  ].join('');
}

const sea = (t: number, extra: number): Pt => add(harborWayAt(t), seaward(t), shoreOffset(t) + extra);

function worldLabels(): string {
  const tq = (QUAY.t0 + QUAY.t1) / 2;
  const q = add(harborWayAt(tq), seaward(tq), QUAY.inner + quayWidth(tq) / 2);
  const ang = (Math.atan2(tangent(tq)[1], tangent(tq)[0]) * 180) / Math.PI;
  // Placed where the open map shows them, never right under a phone's sheet (they'd ghost through the glass).
  const [h1, h2, h3] = [sea(0.53, 70), sea(0.6, 170), sea(0.42, 210)];
  return [
    label('Quay Gardens', q[0], q[1], 'on-park', ang),
    label('Harbor', h1[0], h1[1], 'on-water'),
    label('Harbor', h2[0], h2[1], 'on-water'),
    label('Harbor', h3[0], h3[1], 'on-water'),
  ].join('');
}

/** The whole drawing. */
export function citySvg(): string {
  const big = String(EXTENT * 2);
  const parks = [ALDER, LANTERN, MILL].map((p) => roundRect(p.x0, p.y0, p.x1, p.y1, 20)).join('');
  const pond = { cx: (ALDER.x0 + ALDER.x1) / 2 - 30, cy: ALDER.y0 + 64 };
  const grid = `rotate(${String(GRID_ANGLE)})`;
  return `<rect class="m-land" x="-${big}" y="-${big}" width="${String(EXTENT * 4)}" height="${String(EXTENT * 4)}"></rect>
    <g transform="${grid}">
      <path class="m-block" d="${blocks()}"></path>
      <path class="m-road" d="${gridRoads()}"></path>
      <path class="m-park" d="${parks}"></path>
      <ellipse class="m-pond" cx="${String(n1(pond.cx))}" cy="${String(n1(pond.cy))}" rx="46" ry="26"></ellipse>
      <path class="m-casing" d="M${String(MARKET_X)} -${String(EXTENT)}V${String(EXTENT)}"></path>
      <path class="m-major" d="M${String(MARKET_X)} -${String(EXTENT)}V${String(EXTENT)}"></path>
    </g>
    <path class="m-water" d="${water()}"></path>
    <path class="m-park" d="${quayGardens()}"></path>
    <path class="m-pier" d="${piers()}"></path>
    <path class="m-casing" d="${HARBOR_WAY_D}"></path>
    <path class="m-major" id="harbor-way" d="${HARBOR_WAY_D}"></path>
    <g transform="${grid}">${gridLabels()}</g>
    ${harborWayLabels()}
    ${worldLabels()}`;
}

// ---------- Named places, in world pixels ----------

export interface CityStreet {
  readonly name: string;
  /** A polyline along the street. */
  readonly line: readonly Pt[];
}
export interface CityPark {
  readonly name: string;
  /** A closed polygon. */
  readonly outline: readonly Pt[];
}
export interface CityArea {
  readonly name: string;
  readonly center: Pt;
}

const gridLine = (a: Pt, b: Pt): Pt[] => [fromGrid(a), fromGrid(b)];
const gridRect = (c: Cell): Pt[] => [fromGrid([c.x0, c.y0]), fromGrid([c.x1, c.y0]), fromGrid([c.x1, c.y1]), fromGrid([c.x0, c.y1])];

export const CITY_STREETS: readonly CityStreet[] = [
  { name: 'Harbor Way', line: Array.from({ length: 81 }, (_, i) => harborWayAt(i / 80)) },
  { name: 'Market Street', line: gridLine([MARKET_X, -EXTENT], [MARKET_X, EXTENT]) },
  { name: 'Cedar Avenue', line: gridLine([-EXTENT, hy(-2)], [EXTENT, hy(-2)]) },
  { name: 'Orchard Street', line: gridLine([-EXTENT, hy(-4)], [EXTENT, hy(-4)]) },
  { name: 'Lantern Street', line: gridLine([-EXTENT, hy(-1)], [EXTENT, hy(-1)]) },
  { name: 'Mill Road', line: gridLine([vx(3), -EXTENT], [vx(3), EXTENT]) },
  { name: 'Ferry Lane', line: gridLine([vx(-3), -EXTENT], [vx(-3), EXTENT]) },
];

export const CITY_PARKS: readonly CityPark[] = [
  { name: 'Alder Park', outline: gridRect(ALDER) },
  { name: 'Lantern Square', outline: gridRect(LANTERN) },
  { name: 'Mill Commons', outline: gridRect(MILL) },
  { name: 'Quay Gardens', outline: [...quayOutline().inner, ...quayOutline().outer.reverse()] },
];

/** Parts of town, named for an approximate share (never a street). */
export const CITY_AREAS: readonly CityArea[] = [
  { name: 'Harbor', center: sea(0.55, 160) },
  { name: 'Market', center: fromGrid([MARKET_X, hy(-1)]) },
  { name: 'Lantern', center: fromGrid([mid(LANTERN.x0, LANTERN.x1), mid(LANTERN.y0, LANTERN.y1)]) },
  { name: 'Mill', center: fromGrid([mid(MILL.x0, MILL.x1), mid(MILL.y0, MILL.y1)]) },
];
