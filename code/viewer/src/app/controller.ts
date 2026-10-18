/**
 * The viewer page's controller: events in (the session source, the browser's location answers, the
 * map, taps, time), the state machine's Model (src/state/model.ts) updated, the View derived
 * (src/state/view.ts), and the DOM, the map, the live regions and focus brought in line with it.
 *
 * Effects live here and only here: following the browser's location while share back is on, writing
 * share-back pings (one every few seconds), asking for the place name when the sharer has moved,
 * and stopping the session listener once the page can't change any more.
 */

import type { LocationProvider } from '../location/provider';
import type { MapScene, MapView } from '../map/map-view';
import type { PlaceLookup } from '../places/lookup';
import type { SessionSource } from '../session/source';
import { announce } from '../state/announce';
import { shareBackEffects, type Effect } from '../state/effects';
import { initialModel, reduce, sessionLive, type Model, type ViewerEvent } from '../state/model';
import { toView, type MessageView, type PageView, type View, type ViewEnv } from '../state/view';
import { setBinds } from '../ui/dom';
import { openLocationHelp, type BrowserFamily } from '../ui/help-dialog';
import { bar, binds, body, gap, head, loadingMain, messageMain, PAGE_MAIN, type Region } from '../ui/templates';
import type { Announcer } from './announcer';
import { moveFocus, rebuildKeepingFocus } from './focus';
import { openBand, updateTall } from './layout';
import { PlaceAsker } from './place-asker';

const ACTIONS = ['show-sharer', 'dismiss-share-back', 'share-back', 'stop-share-back', 'retry-map', 'location-help', 'reload'] as const;
export type Action = (typeof ACTIONS)[number];
const isAction = (s: string | undefined): s is Action => ACTIONS.some((a) => a === s);

export interface ViewerDeps {
  readonly source: SessionSource;
  readonly location: LocationProvider;
  readonly places: PlaceLookup;
  readonly map: MapView;
  /** The map's own element (#map): a region labelled Map, hidden when there's no map to show. */
  readonly mapHost: HTMLElement;
  readonly env: ViewEnv;
  readonly browser: BrowserFamily;
  readonly announcer: Announcer;
  readonly reduceMotion: MediaQueryList;
  /** From 45em: the floating column at the left. */
  readonly wide: MediaQueryList;
}

const EMPTY_SCENE: MapScene = { label: 'Street map', sharer: null, viewer: null, trail: [], distance: null, dimmed: false };
/** A destructive button that has just appeared ignores a tap carried over from a double tap. */
const GUARD_MS = 400;
const ENTER_MS = 900;

export class ViewerController {
  private readonly d: ViewerDeps;
  private model: Model;
  private view: View | null = null;
  private readonly queue: ViewerEvent[] = [];
  private dispatching = false;
  private stopSource: (() => void) | null = null;
  private ticker = 0;
  private stopWatch: (() => void) | null = null;
  private lastWriteAt = -Infinity;
  private readonly places: PlaceAsker;
  private focusNext: string | null = null;
  private frameKey = '';
  private framed = false;
  private guardFrom = 0;
  private resizing = 0;
  private readonly regionKeys = new WeakMap<HTMLElement, string>();
  private readonly observer = new ResizeObserver(() => {
    this.layout(this.resizing === 0, 'contain');
  });
  private readonly viewListeners = new Set<(view: View) => void>();

  constructor(deps: ViewerDeps) {
    this.d = deps;
    this.model = initialModel(Date.now());
    this.places = new PlaceAsker(
      deps.places,
      (place) => {
        this.dispatch({ type: 'place', place });
      },
      () => Date.now(),
    );
  }

  start(): void {
    this.stopSource = this.d.source.start((e) => {
      this.dispatch(e);
    });
    this.loadMap();
    this.ticker = window.setInterval(() => {
      this.dispatch({ type: 'tick', now: Date.now() });
    }, 1000);
    document.addEventListener('click', (e) => {
      this.onClick(e);
    });
    // Image errors don't bubble: catch the avatars' in the capture phase.
    document.addEventListener('error', (e) => {
      this.onImageError(e);
    }, true);
    window.addEventListener('resize', () => {
      window.clearTimeout(this.resizing);
      this.resizing = window.setTimeout(() => {
        this.resizing = 0;
      }, 200);
      this.layout(false, 'contain');
    });
    this.d.wide.addEventListener('change', () => {
      this.layout(false, 'center');
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      this.syncThemeColor();
    });
    void document.fonts.ready.then(() => {
      this.layout(false, 'contain');
    });
    this.render();
  }

  /** Calls `listener` with every View the page renders (the sample harness taps through scenarios with it). */
  onView(listener: (view: View) => void): () => void {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  }

  act(action: Action): void {
    switch (action) {
      case 'show-sharer':
        // Frame the sharer and pulse the marker once. Focus stays on the button.
        this.dispatch({ type: 'show-sharer' });
        this.layout(true, 'center');
        this.d.map.pulse();
        if (this.view?.kind === 'page') this.d.announcer.polite(`Map centered on ${this.view.name}.`);
        return;
      case 'dismiss-share-back':
        // Not now's card goes: focus moves to the one button that replaces it.
        this.focusNext = '[data-key="share"]';
        this.dispatch({ type: 'dismiss-share-back' });
        return;
      case 'share-back':
        // Only now, on this tap, is the browser asked for location. Focus stays on the button.
        this.dispatch({ type: 'request-share-back' });
        return;
      case 'stop-share-back':
        this.focusNext = '#vp-h1';
        this.dispatch({ type: 'stop-share-back' });
        return;
      case 'retry-map':
        this.focusNext = '#vp-h1';
        this.dispatch({ type: 'map', status: 'loading' });
        this.loadMap();
        return;
      case 'reload':
        // Opening the link again is the whole recovery: the page trades it for a session from the start.
        window.location.reload();
        return;
      case 'location-help': {
        const opener = document.activeElement;
        openLocationHelp(document, this.d.browser, () => {
          // The close event comes a moment after the dialog closes: by then the browser may have given
          // focus back, or the viewer moved on. Only step in when focus went nowhere.
          const now = document.activeElement;
          if (now !== null && now !== document.body) return;
          if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
          else this.focusHeading();
        });
        return;
      }
    }
  }

  // ---------- Events ----------

  /**
   * Runs each event to completion (state, effects, render) before the next. An effect that hears back
   * at once (a source that answers synchronously) queues its event instead of rendering in the middle.
   */
  private dispatch(e: ViewerEvent): void {
    this.queue.push(e);
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      for (let next = this.queue.shift(); next; next = this.queue.shift()) this.step(next);
    } finally {
      this.dispatching = false;
    }
  }

  private step(e: ViewerEvent): void {
    const prev = this.model;
    const timed = e.type === 'tick' ? prev : reduce(prev, { type: 'tick', now: Date.now() });
    this.model = reduce(timed, e);
    this.effects(prev, e);
    this.render();
  }

  private loadMap(): void {
    this.d.map.load().then(
      () => {
        this.dispatch({ type: 'map', status: 'ready' });
      },
      () => {
        this.dispatch({ type: 'map', status: 'failed' });
      },
    );
  }

  private effects(prev: Model, e: ViewerEvent): void {
    const m = this.model;
    for (const effect of shareBackEffects(prev, m, e, this.lastWriteAt)) this.carryOut(effect);

    // The browser answered: focus goes to what replaced the waiting button.
    if (prev.shareBack !== m.shareBack) {
      if (m.shareBack === 'sharing' && prev.shareBack === 'requesting') this.focusAfterAnswer('[data-key="stop"]');
      if (m.shareBack === 'denied' || m.shareBack === 'unavailable') this.focusAfterAnswer('[data-key="share"]');
    }

    const newest = m.pings[0];
    if (newest && m.session) this.places.update({ lat: newest.lat, lng: newest.lng }, m.session.precision);
  }

  private carryOut(effect: Effect): void {
    switch (effect.kind) {
      case 'watch-location':
        this.stopWatch?.();
        this.stopWatch = this.d.location.watch(
          (fix) => {
            this.dispatch({ type: 'location', fix });
          },
          (error) => {
            this.dispatch({ type: 'location-error', error });
          },
        );
        return;
      case 'stop-watching':
        this.stopWatch?.();
        this.stopWatch = null;
        return;
      case 'write-ping':
        this.lastWriteAt = this.model.now;
        this.d.source.shareBack(effect.fix).catch(() => {
          this.dispatch({ type: 'share-back-refused' });
        });
        return;
      case 'clear-sharing':
        // Best effort: once the session has ended there's nothing left to clear.
        this.d.source.stopShareBack().catch((err: unknown) => {
          const s = this.model.session;
          if (s && sessionLive(s, Date.now())) console.warn('Track Me Live: clearing share back failed', err);
        });
        return;
    }
  }

  /** Moves focus after the browser's answer only if the viewer is still where they tapped. */
  private focusAfterAnswer(selector: string): void {
    const a = document.activeElement;
    const waiting = a instanceof HTMLElement && (a.dataset.key === 'share' || a.dataset.key === 'stop');
    if (a === null || a === document.body || waiting) this.focusNext = selector;
  }

  private onClick(e: MouseEvent): void {
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-act]') : null;
    const action = el?.dataset.act;
    if (!el || !isAction(action) || el.getAttribute('aria-disabled') === 'true') return;
    if (el.hasAttribute('data-guard') && Date.now() - this.guardFrom < GUARD_MS) return;
    e.preventDefault();
    this.act(action);
  }

  /** Avatars fall back like the marker: the flat SVG, then a plain lamplight disc. */
  private onImageError(e: Event): void {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.fallback === undefined) return;
    const fallback = img.dataset.fallback;
    if (fallback && img.getAttribute('src') !== fallback) img.src = fallback;
    else img.closest('.av, .ring')?.classList.add('no-art');
  }

  // ---------- Rendering ----------

  private main(): HTMLElement | null {
    return document.querySelector<HTMLElement>('main');
  }

  private render(): void {
    const next = toView(this.model, this.d.env);
    const prev = this.view;
    this.view = next;
    const before = document.activeElement;

    switch (next.kind) {
      case 'loading':
        this.showLoading(next.heading);
        break;
      case 'invalid':
      case 'expired':
      case 'unavailable':
        this.showMessage(next, prev);
        break;
      case 'page':
        this.showPage(next, prev);
        break;
    }
    if (document.title !== next.title) document.title = next.title;
    const message = next.kind === 'invalid' || next.kind === 'expired' || next.kind === 'unavailable';
    document.body.classList.toggle('msg', message);
    if (prev?.kind !== next.kind) this.syncThemeColor();

    const mapShown = next.kind === 'loading' || (next.kind === 'page' && this.model.map !== 'failed');
    if (this.d.mapHost.hidden === mapShown) this.d.mapHost.hidden = !mapShown;
    if (!mapShown) this.framed = false;
    this.d.map.render(next.kind === 'page' ? next.scene : EMPTY_SCENE);
    this.reframe(next);

    const said = announce(prev, next);
    if (said.polite) this.d.announcer.polite(said.polite);
    if (said.alert) this.d.announcer.alert(said.alert);

    this.settleFocus(before);
    // Nothing changes on this page any more: stop listening, and stop the clock.
    if (message || (next.kind === 'page' && next.ended)) {
      this.stopSource?.();
      this.stopSource = null;
      window.clearInterval(this.ticker);
    }
    for (const listener of this.viewListeners) listener(next);
  }

  private replaceMain(html: string): HTMLElement {
    for (const old of document.querySelectorAll('body > main, body > footer')) old.remove();
    const tpl = document.createElement('template');
    tpl.innerHTML = html.trim();
    document.body.prepend(tpl.content);
    const main = this.main();
    if (!main) throw new Error('replaceMain: the markup has no <main>');
    return main;
  }

  private showLoading(heading: string): void {
    const main = this.main();
    if (main?.getAttribute('aria-busy') !== 'true') {
      this.replaceMain(loadingMain(heading));
      return;
    }
    // index.html paints the skeleton before this script runs; only the heading changes.
    const h1 = main.querySelector('h1');
    if (h1 && h1.textContent !== heading) h1.textContent = heading;
  }

  private showMessage(v: MessageView, prev: View | null): void {
    if (prev?.kind !== v.kind) this.replaceMain(messageMain(v));
  }

  private showPage(v: PageView, prev: View | null): void {
    let main = this.main();
    if (!main?.querySelector('[data-region]')) {
      const from = main?.querySelector('.sheet')?.getBoundingClientRect();
      main = this.replaceMain(PAGE_MAIN);
      main.classList.add('enter');
      const entering = main;
      window.setTimeout(() => {
        entering.classList.remove('enter');
      }, ENTER_MS);
      this.fill(main, v);
      this.observer.disconnect();
      for (const el of main.querySelectorAll('.vp-body, .sheet')) this.observer.observe(el);
      updateTall(main, this.d.wide.matches);
      if (prev?.kind === 'loading') this.reveal(main, from);
      return;
    }
    this.fill(main, v);
  }

  private fill(main: HTMLElement, v: PageView): void {
    const regions: readonly (readonly [string, Region])[] = [
      ['bar', bar(v)],
      ['gap', gap(v)],
      ['head', head(v)],
      ['body', body(v)],
    ];
    for (const [name, region] of regions) {
      const el = main.querySelector<HTMLElement>(`[data-region="${name}"]`);
      if (!el || this.regionKeys.get(el) === region.key) continue;
      rebuildKeepingFocus(el, region.html);
      this.regionKeys.set(el, region.key);
      if (el.querySelector('[data-guard]')) this.guardFrom = Date.now();
    }
    setBinds(main, binds(v));
  }

  /** Loading → live: the sheet grows from the skeleton's size to its own, instead of jumping. */
  private reveal(main: HTMLElement, from: DOMRect | undefined): void {
    const sheet = main.querySelector<HTMLElement>('.sheet');
    if (!sheet || !from || this.d.reduceMotion.matches) return;
    const to = sheet.getBoundingClientRect();
    const top = Math.max(0, Math.round(from.top - to.top));
    const bottom = Math.max(0, Math.round(to.bottom - from.bottom));
    if (!top && !bottom) return;
    const r = getComputedStyle(sheet).borderTopLeftRadius;
    sheet.animate(
      [{ clipPath: `inset(${String(top)}px 0 ${String(bottom)}px 0 round ${r})` }, { clipPath: `inset(0 0 0 0 round ${r})` }],
      { duration: 480, easing: 'cubic-bezier(.2, .9, .2, 1)' },
    );
  }

  /** Keeps the people in the open band: re-centers when who's framed changes, else only if they've left it. */
  private reframe(v: View): void {
    if (v.kind !== 'page') {
      this.layout(false, 'contain');
      return;
    }
    const key = `${String(v.frame.length)}|${this.model.frame}`;
    const changed = key !== this.frameKey;
    this.frameKey = key;
    this.layout(this.framed, !this.framed || changed ? 'center' : 'contain');
  }

  private layout(animate: boolean, mode: 'center' | 'contain'): void {
    const main = this.main();
    const wide = this.d.wide.matches;
    if (main?.classList.contains('vp')) updateTall(main, wide);
    else document.body.classList.remove('column');
    const v = this.view;
    if (v?.kind !== 'page' || this.d.mapHost.hidden) return;
    const band = openBand(main, this.d.mapHost, wide);
    this.d.map.frame(v.frame, band, { animate: animate && !this.d.reduceMotion.matches, mode });
    this.framed = true;
  }

  private settleFocus(before: Element | null): void {
    if (this.focusNext) {
      const target = document.querySelector<HTMLElement>(this.focusNext);
      this.focusNext = null;
      if (target) moveFocus(target);
    }
    // What had focus went away on its own (the call ended, sharing stopped): never drop to the page.
    const dropped = before instanceof HTMLElement && before !== document.body && !before.isConnected;
    if (dropped && (document.activeElement === null || document.activeElement === document.body)) this.focusHeading();
  }

  private focusHeading(): void {
    const h1 = document.querySelector<HTMLElement>('main h1');
    if (h1) moveFocus(h1);
  }

  /** The browser's own bars follow the page's ground: the map's land, or the plain ground behind a message. */
  private syncThemeColor(): void {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const token = document.body.classList.contains('msg') ? '--ground' : '--map-land';
    const color = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    if (meta && color) meta.content = color;
  }
}
