/**
 * The SVG map, a stand-in for the Google Maps JS map behind the same MapView interface, with the
 * people over one of two backdrops:
 *   'sample-city'  the stylized sample city, for the sample and review links;
 *   'plain'        a real session's map until the Maps API draws one: the land with a faint 300 m
 *                  grid, so movement reads, and no streets at all, so it never shows streets that
 *                  aren't there. It's drawn around the session's first position, and hidden from
 *                  screen readers (the where line says where; each marker reads as one phrase).
 *
 * Layers, bottom to top: the city (one <svg role="img">, only its inner group moves), an overlay SVG
 * for the trail and the connector line, and an HTML layer for the markers and the distance chip.
 * One requestAnimationFrame loop moves the camera and the markers together, so they never drift
 * apart: markers keep their size at every zoom (as on a real map), and labels stay caption-2 sized.
 * With Reduce Motion the camera and markers jump, and a moved marker cross-fades into place.
 */

import { APPROXIMATE_CIRCLE_DIAMETER_METERS } from '@tml/shared/schema/generated/ts/schema';
import type { LatLng } from '../../geo/geo';
import { easeOut, frameCamera, keepsInBand, lerpCamera, lerpPt, sameCamera, toScreen, type Camera, type Pt } from '../camera';
import { replayClass } from '../../ui/dom';
import type { Band, FrameOptions, MapScene, MapView } from '../map-view';
import { SharerMarker, ViewerMarker } from '../markers';
import { trailDots, type TrailDot } from '../trail';
import { citySvg } from './city';
import { METERS_PER_PX, projectionAt, SAMPLE_PROJECTION, type Projection } from './projection';

const PAN_MS = 600;
const GLIDE_MS = 600;
/** Room around a person for the marker, halo and name capsule. */
const PAD = 56;
const AREA_D = APPROXIMATE_CIRCLE_DIAMETER_METERS / METERS_PER_PX;
const LIMITS = { minZoom: 0.3, maxZoom: 1, lift: 8 };
const TRAIL = { gap: 14, clear: 34, max: 8 };
const SVG_NS = 'http://www.w3.org/2000/svg';

interface Anim<T> {
  readonly from: T;
  readonly to: T;
  readonly start: number;
  readonly ms: number;
}

const fx = (v: number): string => v.toFixed(1);

class Mover {
  pos: Pt | null = null;
  private anim: Anim<Pt> | null = null;

  /** Returns true when the point moved. */
  goTo(to: Pt, glide: boolean, now: number): boolean {
    const target = this.anim?.to ?? this.pos;
    if (target && Math.hypot(to[0] - target[0], to[1] - target[1]) < 0.5) return false;
    this.anim = glide && this.pos ? { from: this.pos, to, start: now, ms: GLIDE_MS } : null;
    if (!this.anim) this.pos = to;
    return target !== null;
  }

  clear(): void {
    this.pos = null;
    this.anim = null;
  }

  /** Advances; true while still moving. */
  step(now: number): boolean {
    if (!this.anim) return false;
    const t = Math.min(1, (now - this.anim.start) / this.anim.ms);
    this.pos = lerpPt(this.anim.from, this.anim.to, easeOut(t));
    if (t >= 1) this.anim = null;
    return this.anim !== null;
  }
}

export type MapBackdrop = 'sample-city' | 'plain';

/** The plain backdrop's grid: a line every 50 world px (300 m), over a square far larger than an hour of travel. */
const GRID = 50;
const GRID_REACH = 60_000;

export class SvgMapView implements MapView {
  private readonly host: HTMLElement;
  private readonly reduceMotion: MediaQueryList;
  private readonly backdrop: MapBackdrop;
  /** The plain map's projection is set by the first position it draws. */
  private proj: Projection | null;
  private readonly sharer = new SharerMarker();
  private readonly viewer = new ViewerMarker();
  private readonly sharerAt = new Mover();
  private readonly viewerAt = new Mover();
  private readonly chip = document.createElement('div');
  private base: SVGSVGElement | null = null;
  private world: SVGGElement | null = null;
  private trailLayer: SVGGElement | null = null;
  private line: SVGLineElement | null = null;
  private marks: HTMLElement | null = null;
  private scene: MapScene | null = null;
  private cam: Camera = { x: 0, y: 0, zoom: 1 };
  private camAnim: Anim<Camera> | null = null;
  private trail: Pt[] = [];
  private dots: TrailDot[] = [];
  private raf = 0;

  constructor(host: HTMLElement, reduceMotion: MediaQueryList, backdrop: MapBackdrop = 'sample-city') {
    this.host = host;
    this.reduceMotion = reduceMotion;
    this.backdrop = backdrop;
    this.proj = backdrop === 'sample-city' ? SAMPLE_PROJECTION : null;
    this.chip.className = 'chip';
    this.chip.setAttribute('aria-hidden', 'true');
    this.chip.hidden = true;
  }

  load(): Promise<void> {
    if (!this.base) this.draw();
    return Promise.resolve();
  }

  private project(p: LatLng): Pt {
    this.proj ??= projectionAt(p);
    return this.proj.project(p);
  }

  private draw(): void {
    const r = String(GRID_REACH);
    const base =
      this.backdrop === 'sample-city'
        ? `<svg class="mapsvg" xmlns="${SVG_NS}" role="img" aria-label="Street map"><g class="world">${citySvg()}</g></svg>`
        : `<svg class="mapsvg plain" xmlns="${SVG_NS}" aria-hidden="true" focusable="false"><defs><pattern id="m-grid" width="${String(GRID)}" height="${String(GRID)}" patternUnits="userSpaceOnUse"><path class="m-grid" d="M${String(GRID)} 0H0V${String(GRID)}"></path></pattern></defs><g class="world"><rect fill="url(#m-grid)" x="-${r}" y="-${r}" width="${String(2 * GRID_REACH)}" height="${String(2 * GRID_REACH)}"></rect></g></svg>`;
    this.host.innerHTML = `${base}
      <svg class="overlay" xmlns="${SVG_NS}" aria-hidden="true" focusable="false"><line class="m-line" hidden></line><g class="m-trail"></g></svg>
      <div class="marks"></div>`;
    this.base = this.host.querySelector('svg.mapsvg');
    this.world = this.host.querySelector('.world');
    this.trailLayer = this.host.querySelector('.m-trail');
    this.line = this.host.querySelector('.m-line');
    this.marks = this.host.querySelector('.marks');
    this.marks?.style.setProperty('--area-d', `${fx(AREA_D)}px`);
    this.marks?.append(this.sharer.root, this.viewer.root, this.chip);
    // Before anyone is framed, the city's middle sits in the middle of the window.
    this.cam = { x: this.host.clientWidth / 2, y: this.host.clientHeight / 2, zoom: 1 };
    this.paint();
    if (this.scene) this.render(this.scene);
  }

  private get still(): boolean {
    return this.reduceMotion.matches;
  }

  render(scene: MapScene): void {
    this.scene = scene;
    if (!this.base) return;
    if (this.backdrop === 'sample-city' && this.base.getAttribute('aria-label') !== scene.label) this.base.setAttribute('aria-label', scene.label);
    this.host.classList.toggle('dim', scene.dimmed);
    const now = performance.now();

    this.sharer.update(scene.sharer);
    if (scene.sharer) {
      const moved = this.sharerAt.goTo(this.project(scene.sharer.at), !this.still, now);
      if (moved) this.arrived(this.sharer.root, !scene.sharer.seen);
    } else this.sharerAt.clear();

    this.viewer.update(scene.viewer);
    if (scene.viewer) {
      if (this.viewerAt.goTo(this.project(scene.viewer.at), !this.still, now)) this.arrived(this.viewer.root, false);
    } else this.viewerAt.clear();

    this.chip.textContent = scene.distance ?? '';
    this.chip.hidden = scene.distance === null || !scene.viewer;
    this.trail = scene.trail.map((p) => this.project(p));
    this.layDots();
    this.schedule();
  }

  /** A marker reached a new spot: pulse if live; with Reduce Motion, cross-fade into place. */
  private arrived(root: HTMLElement, live: boolean): void {
    if (this.still) replayClass(root, 'xfade');
    if (live) this.sharer.pulse();
  }

  frame(people: readonly LatLng[], band: Band, options: FrameOptions): void {
    if (people.length === 0) return;
    const pts = people.map((p) => this.project(p));
    const pad = this.scene?.sharer?.approximate ? Math.max(PAD, AREA_D / 2 + 8) : PAD;
    const current = this.camAnim?.to ?? this.cam;
    if (options.mode === 'contain' && keepsInBand(current, pts, band, Math.max(24, pad - 16))) return;
    const target = frameCamera(pts, band, { pad, ...LIMITS });
    if (sameCamera(current, target)) return;
    if (options.animate && !this.still) {
      this.camAnim = { from: this.cam, to: target, start: performance.now(), ms: PAN_MS };
    } else {
      this.cam = target;
      this.camAnim = null;
    }
    this.layDots();
    this.schedule();
  }

  pulse(): void {
    this.sharer.pulse();
  }

  /** Thins the trail for the zoom it's heading to, so dots never touch. */
  private layDots(): void {
    const layer = this.trailLayer;
    const marker = this.sharerAt.pos;
    if (!layer) return;
    const zoom = (this.camAnim?.to ?? this.cam).zoom;
    const spacing = { gap: TRAIL.gap / zoom, clear: TRAIL.clear / zoom, max: TRAIL.max };
    this.dots = marker ? trailDots(this.trail, marker, spacing) : [];
    while (layer.childElementCount > this.dots.length) layer.lastElementChild?.remove();
    while (layer.childElementCount < this.dots.length) layer.append(document.createElementNS(SVG_NS, 'circle'));
    this.dots.forEach((d, i) => layer.children[i]?.setAttribute('r', d.r.toFixed(2)));
  }

  private schedule(): void {
    if (!this.raf) this.raf = requestAnimationFrame((t) => { this.step(t); });
  }

  private step(now: number): void {
    this.raf = 0;
    let moving = false;
    if (this.camAnim) {
      const t = Math.min(1, (now - this.camAnim.start) / this.camAnim.ms);
      this.cam = lerpCamera(this.camAnim.from, this.camAnim.to, easeOut(t));
      if (t >= 1) this.camAnim = null;
      moving = this.camAnim !== null;
    }
    moving = this.sharerAt.step(now) || moving;
    moving = this.viewerAt.step(now) || moving;
    this.paint();
    this.host.toggleAttribute('data-moving', moving);
    if (moving) this.schedule();
  }

  /** Writes the current camera and positions to the DOM. */
  private paint(): void {
    const { world, line, marks, trailLayer } = this;
    if (!world || !line || !marks || !trailLayer) return;
    const c = this.cam;
    world.style.transform = `translate(${fx(c.x)}px, ${fx(c.y)}px) scale(${c.zoom.toFixed(4)})`;
    // Labels counter-scale, so they stay caption-2 sized when the map zooms out.
    world.style.setProperty('--k', (1 / c.zoom).toFixed(4));
    marks.style.setProperty('--z', c.zoom.toFixed(4));
    const place = (root: HTMLElement, p: Pt | null): Pt | null => {
      if (!p) return null;
      const s = toScreen(c, p);
      root.style.transform = `translate(${fx(s[0])}px, ${fx(s[1])}px)`;
      return s;
    };
    const a = place(this.sharer.root, this.sharerAt.pos);
    const b = place(this.viewer.root, this.viewerAt.pos);
    const both = a !== null && b !== null && !this.viewer.root.hidden;
    line.toggleAttribute('hidden', !both);
    if (both) {
      line.setAttribute('x1', fx(a[0]));
      line.setAttribute('y1', fx(a[1]));
      line.setAttribute('x2', fx(b[0]));
      line.setAttribute('y2', fx(b[1]));
      this.chip.style.transform = `translate(${fx((a[0] + b[0]) / 2)}px, ${fx((a[1] + b[1]) / 2)}px) translate(-50%, -50%)`;
    }
    this.dots.forEach((d, i) => {
      const s = toScreen(c, d.at);
      const dot = trailLayer.children[i];
      dot?.setAttribute('cx', fx(s[0]));
      dot?.setAttribute('cy', fx(s[1]));
    });
  }
}
