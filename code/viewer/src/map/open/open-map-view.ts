/**
 * A real session's map: OpenStreetMap streets (MapLibre GL JS on OpenFreeMap's tiles, src/map/open/
 * streets.ts) under the people, behind the same MapView interface as the SVG map, so the controller
 * never knows which it has.
 *
 * The people (markers, trail, connector line, glides, pulses, Reduce Motion) are the SVG map's, over
 * its plain backdrop (src/map/svg/), exactly as before; its camera drives the street map's, frame by
 * frame, in the same Web Mercator, so the markers sit on the right streets at every moment of a pan.
 *
 *   pending   the people show at once; the grid stays hidden for a moment, while the street map's
 *             chunk, MapLibre, the style and the first tiles arrive
 *   streets   the street map fades in under the people (at once with Reduce Motion), labelled as a
 *             street map, with its attribution in the open band's lower corner
 *   plain     the chunk, MapLibre (no WebGL 2, say), the style or the tiles failed, or the street map
 *             hadn't drawn STREETS_TIMEOUT_MS after the first position: the grid fades in and the page
 *             carries on as it always has. The street map isn't asked for again on this page.
 *
 * load() resolves as soon as the people can be drawn, and never rejects: the plain backdrop always
 * works, so the page never says the map didn't load. The street map follows the page's theme.
 */

import type { LatLng } from '../../geo/geo';
import type { Band, FrameOptions, MapScene, MapView } from '../map-view';
import { webCamera } from '../svg/projection';
import { SvgMapView } from '../svg/svg-map-view';
import { ATTRIBUTION, STREETS_TIMEOUT_MS, type MapStyles, type MapTheme } from './config';
import type { StreetPalette } from './style';
import type { Streets, StreetsOptions } from './streets';

export type StreetsState = 'pending' | 'streets' | 'plain';

export interface OpenMapDeps {
  readonly styles: MapStyles;
  /** The street map's code: its own chunk, fetched only now. */
  readonly streets: () => Promise<(o: StreetsOptions) => Promise<Streets>>;
  /** The page's theme now, and a way to hear when it changes. */
  readonly theme: () => MapTheme;
  readonly onThemeChange: (listener: () => void) => void;
  /** The map tokens now (they follow the theme). */
  readonly palette: () => StreetPalette;
  readonly textScale: () => number;
  readonly timeoutMs?: number;
}

export class OpenMapView implements MapView {
  private readonly host: HTMLElement;
  private readonly reduceMotion: MediaQueryList;
  private readonly deps: OpenMapDeps;
  private readonly svg: SvgMapView;
  private readonly layer = document.createElement('div');
  private readonly credit = document.createElement('p');
  private state: StreetsState = 'pending';
  private streets: Streets | null = null;
  private create: ((o: StreetsOptions) => Promise<Streets>) | null = null;
  private started = false;
  private creating = false;
  private camera: { center: LatLng; zoom: number } | null = null;
  private timer = 0;
  private label = 'Street map';

  constructor(host: HTMLElement, reduceMotion: MediaQueryList, deps: OpenMapDeps) {
    this.host = host;
    this.reduceMotion = reduceMotion;
    this.deps = deps;
    this.layer.className = 'm-streets';
    this.layer.setAttribute('aria-hidden', 'true');
    this.credit.className = 'm-credit';
    this.credit.hidden = true;
    this.credit.innerHTML = `<span class="sr-only">Map data: </span>${ATTRIBUTION.map((a) => `<a href="${a.href}" target="_blank" rel="noopener noreferrer">${a.text}</a>`).join('<span aria-hidden="true"> · </span>')}`;
    this.svg = new SvgMapView(host, reduceMotion, 'plain', {
      under: [this.layer],
      over: [this.credit],
      onPaint: (cam, proj) => {
        this.follow(webCamera(cam, { width: this.host.clientWidth, height: this.host.clientHeight }, proj));
      },
    });
    this.host.classList.add('streets-pending');
    deps.onThemeChange(() => {
      this.streets?.setTheme(deps.theme(), deps.palette(), deps.textScale());
    });
  }

  /** Which backdrop shows. */
  get streetsState(): StreetsState {
    return this.state;
  }

  async load(): Promise<void> {
    await this.svg.load();
    if (this.started) return;
    this.started = true;
    this.deps.streets().then(
      (create) => {
        this.create = create;
        this.maybeCreate();
      },
      (err: unknown) => {
        this.fallBack(err);
      },
    );
  }

  render(scene: MapScene): void {
    this.svg.render(scene);
    this.label = scene.label;
    if (this.state === 'streets' && this.layer.getAttribute('aria-label') !== scene.label) this.layer.setAttribute('aria-label', scene.label);
  }

  frame(people: readonly LatLng[], band: Band, options: FrameOptions): void {
    this.svg.frame(people, band, options);
    // The credit sits in the open band's lower right corner, clear of the bar, the sheet and the column.
    this.credit.style.setProperty('--credit-right', `${String(Math.max(0, Math.round(this.host.clientWidth - band.right)))}px`);
    this.credit.style.setProperty('--credit-bottom', `${String(Math.max(0, Math.round(this.host.clientHeight - band.bottom)))}px`);
  }

  pulse(): void {
    this.svg.pulse();
  }

  /** Where the street map's camera goes, every time the people's map draws. */
  private follow(camera: { center: LatLng; zoom: number }): void {
    this.camera = camera;
    if (this.streets) this.streets.show(camera.center, camera.zoom);
    else this.maybeCreate();
  }

  /** The street map is made once MapLibre is here and there's a first position to show. */
  private maybeCreate(): void {
    const { create, camera } = this;
    if (!create || !camera || this.creating || this.state !== 'pending') return;
    this.creating = true;
    this.timer = window.setTimeout(() => {
      this.fallBack(new Error(`The street map hadn’t drawn after ${String(this.deps.timeoutMs ?? STREETS_TIMEOUT_MS)} ms.`));
    }, this.deps.timeoutMs ?? STREETS_TIMEOUT_MS);
    create({
      container: this.layer,
      styles: this.deps.styles,
      theme: this.deps.theme(),
      palette: this.deps.palette(),
      textScale: this.deps.textScale(),
      reduceMotion: this.reduceMotion.matches,
      at: camera,
    }).then(
      (streets) => {
        if (this.state !== 'pending') {
          streets.remove();
          return;
        }
        this.streets = streets;
        if (this.camera) streets.show(this.camera.center, this.camera.zoom);
        streets.ready.then(
          () => {
            this.show();
          },
          (err: unknown) => {
            this.fallBack(err);
          },
        );
      },
      (err: unknown) => {
        this.fallBack(err);
      },
    );
  }

  private show(): void {
    if (this.state !== 'pending') return;
    window.clearTimeout(this.timer);
    this.state = 'streets';
    this.host.classList.replace('streets-pending', 'streets');
    this.layer.removeAttribute('aria-hidden');
    this.layer.setAttribute('role', 'img');
    this.layer.setAttribute('aria-label', this.label);
    this.credit.hidden = false;
  }

  private fallBack(err: unknown): void {
    if (this.state !== 'pending') return;
    window.clearTimeout(this.timer);
    this.state = 'plain';
    console.info('Track Me Live: showing the plain map, without streets.', err instanceof Error ? err.message : err);
    this.streets?.remove();
    this.streets = null;
    this.layer.remove();
    this.credit.remove();
    this.host.classList.remove('streets-pending');
  }
}
