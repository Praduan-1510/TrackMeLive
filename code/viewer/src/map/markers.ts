/**
 * The people on the map, as DOM: the sharer's mascot marker and the viewer's own "You" marker. Any
 * map places these elements (the SVG map in its marker layer; Google Maps as AdvancedMarkerElement
 * content), so the markers look and read the same whichever map draws them.
 *
 * Each marker is one focusable element read as one phrase; the halo, ripple, area circle and name
 * capsule are hidden from screen readers. Live animation runs only for a moment: on arrival and after
 * each ping (about 2.6 s), and not at all with Reduce Motion (src/styles/prefs.css).
 */

import type { MascotImage } from '../mascot';
import { replayClass } from '../ui/dom';
import { ICONS } from '../ui/icons';
import type { SharerMarkerSpec, ViewerMarkerSpec } from './map-view';

const PULSE_MS = 2600;
const ARRIVE_MS = 560;

function el(cls: string, html = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  return d;
}

function setPhrase(disc: HTMLElement, phrase: string): void {
  if (disc.getAttribute('aria-label') !== phrase) disc.setAttribute('aria-label', phrase);
}

export class SharerMarker {
  readonly root = el('mk sharer');
  private readonly disc = el('disc');
  private readonly img = document.createElement('img');
  private readonly name = document.createElement('span');
  private image: MascotImage | null = null;
  private pulseTimer = 0;
  private arriveTimer = 0;
  private shown = false;

  constructor() {
    this.root.hidden = true;
    this.disc.setAttribute('role', 'img');
    this.disc.tabIndex = 0;
    Object.assign(this.img, { alt: '', width: 42, height: 42, decoding: 'async' });
    // A render that can't load: the flat SVG, then a plain lamplight disc. Never a broken image.
    this.img.addEventListener('error', () => {
      if (this.image && this.img.getAttribute('src') !== this.image.fallback) this.img.src = this.image.fallback;
      else this.disc.classList.add('no-art');
    });
    this.disc.append(this.img);
    const capsule = el('name');
    capsule.setAttribute('aria-hidden', 'true');
    capsule.append(this.name);
    this.root.append(el('area'), el('halo'), el('ripple'), this.disc, capsule);
    for (const deco of this.root.querySelectorAll('.area, .halo, .ripple')) deco.setAttribute('aria-hidden', 'true');
  }

  update(spec: SharerMarkerSpec | null): void {
    if (!spec) {
      this.root.hidden = true;
      this.shown = false;
      return;
    }
    this.root.classList.toggle('seen', spec.seen);
    this.root.classList.toggle('approx', spec.approximate);
    this.name.textContent = spec.label;
    setPhrase(this.disc, spec.phrase);
    if (this.image?.src !== spec.img.src) {
      this.image = spec.img;
      this.disc.classList.remove('no-art');
      this.img.src = spec.img.src;
    }
    this.root.hidden = false;
    if (!this.shown) {
      this.shown = true;
      this.arrive();
    }
  }

  /** The first appearance: the disc springs in, then one pulse. */
  private arrive(): void {
    window.clearTimeout(this.arriveTimer);
    this.root.classList.add('arrive');
    this.arriveTimer = window.setTimeout(() => {
      this.root.classList.remove('arrive');
      this.pulse();
    }, ARRIVE_MS);
  }

  /** Halo, ripple and a small bob, twice, then the marker rests. A last-seen marker stays still. */
  pulse(): void {
    if (this.root.hidden || this.root.classList.contains('seen')) return;
    window.clearTimeout(this.pulseTimer);
    replayClass(this.root, 'pinged');
    this.pulseTimer = window.setTimeout(() => {
      this.root.classList.remove('pinged');
    }, PULSE_MS);
  }
}

export class ViewerMarker {
  readonly root = el('mk viewer');
  private readonly disc = el('disc', ICONS.person);

  constructor() {
    this.root.hidden = true;
    this.disc.setAttribute('role', 'img');
    this.disc.tabIndex = 0;
    const halo = el('halo');
    const capsule = el('name', '<span>You</span>');
    halo.setAttribute('aria-hidden', 'true');
    capsule.setAttribute('aria-hidden', 'true');
    this.root.append(halo, this.disc, capsule);
  }

  update(spec: ViewerMarkerSpec | null): void {
    this.root.hidden = spec === null;
    if (spec) setPhrase(this.disc, spec.phrase);
  }
}
