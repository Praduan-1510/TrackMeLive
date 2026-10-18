/**
 * The map behind the viewer page: a stylized city drawn in the map tokens (land, a street grid with
 * building blocks, parks, the harbor, Harbor Way and labels), the sharer's marker and trail.
 *
 * Sprint 0 stand-in: the real page draws the Maps API map and keeps this marker, trail and framing.
 * World units are CSS px at 6 meters per px, with (0, 0) at ORIGIN. The drawing is built once as a
 * string; the SVG stays viewport-sized and only a group inside it moves, so panning never creates a
 * huge compositing layer.
 */

export type Pt = [x: number, y: number];

export const METERS_PER_PX = 6;
const ORIGIN = { lat: 37.79432, lng: -122.39468 };
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** Latitude/longitude to world px on the sample map. */
export function project(lat: number, lng: number): Pt {
  return [
    ((lng - ORIGIN.lng) * M_PER_DEG_LNG) / METERS_PER_PX,
    (-(lat - ORIGIN.lat) * M_PER_DEG_LAT) / METERS_PER_PX,
  ];
}

// ---------- Geometry helpers ----------

const n1 = (v: number): number => Math.round(v * 10) / 10;
const pt = (p: Pt): string => `${n1(p[0])} ${n1(p[1])}`;
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
    const p0 = at(pts, i - 1), p1 = at(pts, i), p2 = at(pts, i + 1), p3 = at(pts, i + 2);
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return d;
}

function roundRect(x0: number, y0: number, x1: number, y1: number, r: number): string {
  const w = x1 - x0, h = y1 - y0;
  if (w <= 2 * r || h <= 2 * r) return '';
  return `M${n1(x0 + r)} ${n1(y0)}h${n1(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}v${n1(h - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${r}h${n1(-(w - 2 * r))}a${r} ${r} 0 0 1 ${-r} ${-r}v${n1(-(h - 2 * r))}a${r} ${r} 0 0 1 ${r} ${-r}z`;
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

// ---------- Harbor Way: the main road, running up and to the right through the sample point ----------

const P0: Pt = [-2400, 1300], P1: Pt = [-900, 900], P2: Pt = [900, -2500 / 3], P3: Pt = [2400, -1500];
const HARBOR_WAY_D = `M${pt(P0)}C${pt(P1)} ${pt(P2)} ${pt(P3)}`;

function bez(t: number): Pt {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
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
const ARC = (() => {
  const s = new Float64Array(ARC_STEPS + 1);
  let prev = bez(0);
  for (let i = 1; i <= ARC_STEPS; i++) {
    const p = bez(i / ARC_STEPS);
    s[i] = (s[i - 1] ?? 0) + Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return s;
})();
const arcAt = (t: number): number => ARC[Math.round(t * ARC_STEPS)] ?? 0;
/** The sample point sits at t = 0.5. */
const S_ORIGIN = arcAt(0.5);

/** How far the shore is from Harbor Way, in px: 165 at the sample point, wandering elsewhere. */
const shoreOffset = (t: number): number =>
  165 + 70 * Math.sin(6 * Math.PI * (t - 0.5)) + 22 * Math.sin(14 * Math.PI * (t - 0.5));
const shoreAt = (t: number): Pt => add(bez(t), seaward(t), shoreOffset(t));

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
const iM = V.indexOf(MARKET_X); // Market St
const jA = H.indexOf(-98); // the street just above the sample point
const vx = (i: number): number => at(V, iM + i);
const hy = (j: number): number => at(H, jA + j);

function gridRoads(): string {
  let d = '';
  for (const y of H) d += `M${-EXTENT} ${y}H${EXTENT}`;
  for (const x of V) if (x !== MARKET_X) d += `M${x} ${-EXTENT}V${EXTENT}`;
  return d;
}

function blocks(): string {
  let d = '';
  const r = 4;
  for (let i = 0; i < V.length - 1; i++) {
    for (let j = 0; j < H.length - 1; j++) {
      const x0 = at(V, i) + 11, x1 = at(V, i + 1) - 11, y0 = at(H, j) + 11, y1 = at(H, j + 1) - 11;
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
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        d += roundRect(x0, y0, mx - 4, my - 4, r) + roundRect(mx + 4, y0, x1, my - 4, r)
          + roundRect(x0, my + 4, mx - 4, y1, r) + roundRect(mx + 4, my + 4, x1, y1, r);
      } else {
        d += roundRect(x0, y0, x1, y1, r);
      }
    }
  }
  return d;
}

/** Parks that fill whole blocks (the streets inside them stop at their edges). */
const cell = (i0: number, i1: number, j0: number, j1: number) => ({ x0: vx(i0) + 10, x1: vx(i1) - 10, y0: hy(j0) + 10, y1: hy(j1) - 10 });
const ALDER = cell(0, 1, -2, 0);
const LANTERN = cell(-4, -3, -3, -2);
const MILL = cell(4, 6, -5, -4);
const gridParks = [ALDER, LANTERN, MILL];

// ---------- The harbor ----------

function water(): string {
  const shore: Pt[] = [];
  for (let i = 0; i <= 96; i++) shore.push(shoreAt(i / 96));
  const s0 = at(shore, 0), s1 = at(shore, shore.length - 1);
  return `${smooth(shore)}L${EXTENT * 2} ${n1(s1[1])}L${EXTENT * 2} ${EXTENT * 2}L${n1(s0[0])} ${EXTENT * 2}Z`;
}

/** Quay Gardens: a waterfront park between Harbor Way and the shore, tapering at both ends. */
const QUAY = { t0: 0.528, t1: 0.61, inner: 26, maxWidth: 120 };
const quayWidth = (t: number): number => {
  const u = (t - QUAY.t0) / (QUAY.t1 - QUAY.t0);
  return Math.max(0, Math.min(shoreOffset(t) - QUAY.inner - 16, QUAY.maxWidth)) * Math.sqrt(Math.max(0, Math.sin(Math.PI * u)));
};
function quayGardens(): string {
  const inner: Pt[] = [], outer: Pt[] = [];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const t = QUAY.t0 + ((QUAY.t1 - QUAY.t0) * i) / steps;
    inner.push(add(bez(t), seaward(t), QUAY.inner));
    outer.push(add(bez(t), seaward(t), QUAY.inner + quayWidth(t)));
  }
  return `${smooth(inner)}L${pt(at(outer, outer.length - 1))}${smooth(outer.slice().reverse()).replace(/^M[^C]*/, '')}Z`;
}

function piers(): string {
  const r = rng(77);
  let d = '';
  for (let t = 0.07; t < 0.95; t += 0.03) {
    if (r() < 0.25) continue;
    const tt = t + (r() - 0.5) * 0.01;
    const s = shoreAt(tt), nrm = seaward(tt), tan = tangent(tt);
    const len = 44 + r() * 64, half = 6 + r() * 5;
    const b = add(s, nrm, -8);
    const a1 = add(b, tan, -half), a2 = add(b, tan, half);
    d += `M${pt(a1)}L${pt(a2)}L${pt(add(a2, nrm, len))}L${pt(add(a1, nrm, len))}Z`;
  }
  return d;
}

// ---------- Labels: caption-2 or larger, sentence case ----------

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const label = (text: string, x: number, y: number, cls: string, rotate = 0): string =>
  `<text class="m-label ${cls}" x="${n1(x)}" y="${n1(y)}" dy="3.8" text-anchor="middle"${rotate ? ` transform="rotate(${n1(rotate)} ${n1(x)} ${n1(y)})"` : ''}>${esc(text)}</text>`;

function harborWayLabels(): string {
  return [118, -640, 900, -1500, 1720]
    .map((ds) => `<text class="m-label on-major" dy="3.8"><textPath href="#harbor-way" startOffset="${n1(S_ORIGIN + ds)}" text-anchor="middle">Harbor Way</textPath></text>`)
    .join('');
}

/** Labels in the grid's own (rotated) frame: streets and parks. */
function gridLabels(): string {
  const mid = (a: number, b: number): number => (a + b) / 2;
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

function worldLabels(): string {
  const tq = (QUAY.t0 + QUAY.t1) / 2;
  const q = add(bez(tq), seaward(tq), QUAY.inner + quayWidth(tq) / 2);
  const ang = (Math.atan2(tangent(tq)[1], tangent(tq)[0]) * 180) / Math.PI;
  const sea = (t: number, extra: number): Pt => add(bez(t), seaward(t), shoreOffset(t) + extra);
  // Placed where the open map shows them, never right under a phone's sheet (they'd ghost through the glass).
  const [h1, h2, h3] = [sea(0.53, 70), sea(0.6, 170), sea(0.42, 210)];
  return [
    label('Quay Gardens', q[0], q[1], 'on-park', ang),
    label('Harbor', h1[0], h1[1], 'on-water'),
    label('Harbor', h2[0], h2[1], 'on-water'),
    label('Harbor', h3[0], h3[1], 'on-water'),
  ].join('');
}

/** The whole drawing, built once. */
const WORLD_SVG = (() => {
  const big = EXTENT * 2;
  const parks = gridParks.map((p) => roundRect(p.x0, p.y0, p.x1, p.y1, 20)).join('');
  const pond = { cx: (ALDER.x0 + ALDER.x1) / 2 - 30, cy: ALDER.y0 + 64 };
  return `
    <rect class="m-land" x="${-big}" y="${-big}" width="${big * 2}" height="${big * 2}"></rect>
    <g transform="rotate(${GRID_ANGLE})">
      <path class="m-block" d="${blocks()}"></path>
      <path class="m-road" d="${gridRoads()}"></path>
      <path class="m-park" d="${parks}"></path>
      <ellipse class="m-pond" cx="${n1(pond.cx)}" cy="${n1(pond.cy)}" rx="46" ry="26"></ellipse>
      <path class="m-casing" d="M${MARKET_X} ${-EXTENT}V${EXTENT}"></path>
      <path class="m-major" d="M${MARKET_X} ${-EXTENT}V${EXTENT}"></path>
    </g>
    <path class="m-water" d="${water()}"></path>
    <path class="m-park" d="${quayGardens()}"></path>
    <path class="m-pier" d="${piers()}"></path>
    <path class="m-casing" d="${HARBOR_WAY_D}"></path>
    <path class="m-major" id="harbor-way" d="${HARBOR_WAY_D}"></path>
    <g transform="rotate(${GRID_ANGLE})">${gridLabels()}</g>
    ${harborWayLabels()}
    ${worldLabels()}
    <g class="m-trail"></g>`;
})();

// ---------- The view ----------

export interface SharerMarker {
  /** Where the sharer is, in world px. */
  at: Pt;
  /** The name capsule under the marker. */
  name: string;
  /** What a screen reader says for the marker: "Alex, live, updated 2 seconds ago". */
  phrase: string;
  img: { src: string; fallback: string };
  approx: boolean;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const PING_MS = 2600;

export class MapView {
  private readonly host: HTMLElement;
  private readonly base: SVGSVGElement;
  private readonly world: SVGGElement;
  private readonly trail: SVGGElement;
  private readonly pan: HTMLElement;
  private readonly marker: HTMLElement;
  private readonly disc: HTMLElement;
  private readonly img: HTMLImageElement;
  private readonly nameEl: HTMLElement;
  private fallback = '';
  private pingTimer = 0;
  private arriveTimer = 0;

  constructor(host: HTMLElement, mapLabel: string) {
    this.host = host;
    // The map is one image with a short label; each marker is one phrase. Trail, halo and the name
    // capsule are hidden from screen readers.
    host.innerHTML = `
      <svg class="mapsvg" xmlns="${SVG_NS}" role="img" aria-label="${esc(mapLabel)}"><g class="world">${WORLD_SVG}</g></svg>
      <div class="map-pan">
        <div class="mk sharer" hidden>
          <div class="area" aria-hidden="true"></div>
          <div class="halo" aria-hidden="true"></div>
          <div class="ripple" aria-hidden="true"></div>
          <div class="disc" role="img"><img alt="" width="42" height="42" decoding="async"></div>
          <div class="name" aria-hidden="true"><span></span></div>
        </div>
      </div>`;
    this.base = host.querySelector('svg') as SVGSVGElement;
    this.world = host.querySelector('.world') as SVGGElement;
    this.trail = host.querySelector('.m-trail') as SVGGElement;
    this.pan = host.querySelector('.map-pan') as HTMLElement;
    this.marker = host.querySelector('.mk') as HTMLElement;
    this.disc = this.marker.querySelector('.disc') as HTMLElement;
    this.img = this.disc.querySelector('img') as HTMLImageElement;
    this.nameEl = this.marker.querySelector('.name span') as HTMLElement;
    // A render that can't load: the flat SVG, then a plain lamplight disc.
    this.img.addEventListener('error', () => {
      if (this.fallback && this.img.getAttribute('src') !== this.fallback) this.img.src = this.fallback;
      else this.disc.classList.add('no-art');
    });
  }

  setMapLabel(text: string): void {
    if (this.base.getAttribute('aria-label') !== text) this.base.setAttribute('aria-label', text);
  }

  /** Shows (or hides, with null) the sharer's marker. `arrive` plays the entrance, then one ping. */
  setSharer(m: SharerMarker | null, arrive = false): void {
    if (!m) {
      this.marker.hidden = true;
      return;
    }
    this.marker.style.left = `${n1(m.at[0])}px`;
    this.marker.style.top = `${n1(m.at[1])}px`;
    this.marker.classList.toggle('approx', m.approx);
    this.nameEl.textContent = m.name;
    this.disc.setAttribute('aria-label', m.phrase);
    if (this.img.getAttribute('src') !== m.img.src) {
      this.fallback = m.img.fallback;
      this.disc.classList.remove('no-art');
      this.img.src = m.img.src;
    }
    const wasHidden = this.marker.hidden;
    this.marker.hidden = false;
    if (arrive && wasHidden) {
      clearTimeout(this.arriveTimer);
      this.marker.classList.add('arrive');
      this.arriveTimer = window.setTimeout(() => {
        this.marker.classList.remove('arrive');
        this.ping();
      }, 560);
    }
  }

  /** Earlier positions, oldest first. Every dot is full strength; age shows by size (4px to 8px). */
  setTrail(points: readonly Pt[]): void {
    const count = points.length;
    this.trail.innerHTML = points
      .map((p, i) => `<circle cx="${n1(p[0])}" cy="${n1(p[1])}" r="${n1(2 + (2 * (i + 1)) / Math.max(count, 1))}"></circle>`)
      .join('');
  }

  /** Pans so the world point lands on the screen point (px in the map's own box). */
  frame(screen: Pt, worldPt: Pt, animate: boolean): void {
    const t = `translate(${Math.round(screen[0] - worldPt[0])}px, ${Math.round(screen[1] - worldPt[1])}px)`;
    if (this.world.style.transform === t) return;
    if (!animate) this.host.classList.add('instant');
    this.world.style.transform = t;
    this.pan.style.transform = t;
    if (!animate) {
      void this.host.offsetWidth;
      requestAnimationFrame(() => this.host.classList.remove('instant'));
    }
  }

  /** A short pulse: halo, ripple and a small bob, twice, then the marker rests. */
  ping(): void {
    if (this.marker.hidden) return;
    clearTimeout(this.pingTimer);
    this.marker.classList.remove('pinged');
    void this.marker.offsetWidth;
    this.marker.classList.add('pinged');
    this.pingTimer = window.setTimeout(() => this.marker.classList.remove('pinged'), PING_MS);
  }
}
