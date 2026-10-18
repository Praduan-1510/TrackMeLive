/**
 * Track Me Live web viewer, Sprint 0 shell.
 *
 * The page a viewer ("Mom") opens from a share link, in any browser, with no install: the sharer's
 * mascot on a live map, where they are in words, and the share-back card during the call. This shell
 * renders the loading skeleton and the live state from sample data (src/sample.ts, shaped like the
 * Firestore session doc and pings); no backend, no network requests.
 *
 * Screen reference: prototype/ (viewerParts() in prototype/js/app.js, styles in prototype/css/app.css).
 * Colors, spacing, radii and fonts come from the shared tokens: '@tml/shared' is a Vite alias for
 * code/shared (see vite.config.ts).
 *
 * Review states (query params):
 *   ?state=loading   stay on the skeleton
 *   ?state=live      go straight to the live state
 *   ?theme=light|dark  force a theme (default: follows the system)
 *
 *   npm run dev        http://localhost:5173
 *   npm run typecheck  tsc --noEmit
 *   npm run build      typecheck, then vite build to dist/
 */

import '@tml/shared/tokens/generated/css/tokens.css';
import './styles/fonts.css';
import './styles/base.css';
import './styles/map.css';
import './styles/page.css';
import './styles/prefs.css';

import { MAP_SVG, sym } from './icons';
import { MapView, project, type Pt, type SharerMarker } from './map';
import { createSample, type SampleData, type SharerSnapshot } from './sample';

// ---------- Review params ----------

const params = new URLSearchParams(location.search);
const stateParam = params.get('state');
const themeParam = params.get('theme');
if (themeParam === 'light' || themeParam === 'dark') document.documentElement.dataset.theme = themeParam;

const LOADING_MS = 1200;
/** On a phone, the map keeps at least this much open band; past it the column scrolls (.tall). */
const MIN_BAND = 160;

// ---------- Small helpers ----------

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Everything from the session (the sharer's name above all) is escaped before it meets innerHTML. */
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);
const docTitle = (t: string): string => `${t} · Track Me Live`;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const wide = matchMedia('(min-width: 45em)');

/** "9:58 pm", as the product writes times. */
function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s*(AM|PM)$/u, (_, ap: string) => ` ${ap.toLowerCase()}`);
}

/** "2 seconds ago": the unit's name, never its symbol, for screen readers. */
function agoSpoken(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} ${s === 1 ? 'second' : 'seconds'} ago`;
  const m = Math.round(s / 60);
  return `${m} ${m === 1 ? 'minute' : 'minutes'} ago`;
}

/** The session's mascot render, and the flat SVG to fall back to. */
function mascotImage(sharer: SharerSnapshot): { src: string; fallback: string } {
  const id = sharer.mascot_id;
  // TODO(mascots): stack the accessory layer (/mascots/accessories/<id>-<accessory>.png) when
  // mascot_accessory is set, and serve the 40pt/32pt WebP or AVIF exports instead of the PNG.
  const src = sharer.mascot_color === 'original' ? `/mascots/${id}.png` : `/mascots/colors/${id}-${sharer.mascot_color}.png`;
  return { src, fallback: `/mascots/${id}.svg` };
}

/** Open in Maps: Apple Maps on Apple devices, Google Maps elsewhere. Approximate shares pass the rounded point. */
function mapsHref(lat: number, lng: number, name: string): string {
  const ll = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  return /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
    ? `https://maps.apple.com/?ll=${ll}&q=${encodeURIComponent(name)}`
    : `https://www.google.com/maps/search/?api=1&query=${ll}`;
}

// ---------- What the page shows, from the session ----------

interface View {
  name: string;
  where: string;
  until: string;
  onCall: boolean;
  offerShareBack: boolean;
  mapsHref: string;
  mapLabel: string;
  here: Pt;
  trail: Pt[];
  marker: SharerMarker;
  img: { src: string; fallback: string };
}

function toView(data: SampleData, now: number): View {
  const s = data.session;
  const name = s.sharer.name.trim() || 'Someone';
  const [latest, ...earlier] = data.pings;
  const lat = latest?.lat ?? 0;
  const lng = latest?.lng ?? 0;
  const here = project(lat, lng);
  const approx = s.precision === 'approximate';
  const live = s.status === 'active';
  // The session ends at the earlier of its timer and the 1-hour limit.
  const endAt = new Date(Math.min((s.stop_at ?? s.expires_at).getTime(), s.expires_at.getTime()));
  // TODO(where): look up the nearest street (or, when approximate, only the area) in the browser with
  // the Maps API, and never store it.
  const where = `Near ${data.nearestStreet}`;
  const img = mascotImage(s.sharer);
  const ago = latest ? agoSpoken(now - latest.recorded_at.getTime()) : '';
  const phrase = [name, 'live', approx && 'approximate location', ago && `updated ${ago}`].filter(Boolean).join(', ');
  return {
    name,
    where,
    until: s.stop_rule === 'call' && s.call_active ? 'Visible until your call ends.' : `Visible until ${fmtTime(endAt)}.`,
    onCall: live && s.call_active,
    // Share back: only during the session's own call, only when the sharer allows it.
    offerShareBack: live && s.call_active && s.share_back_allowed && !s.viewer_sharing,
    mapsHref: mapsHref(lat, lng, name),
    mapLabel: approx ? 'Street map of the area' : `Street map around ${data.nearestStreet}`,
    here,
    // An approximate share never draws the exact trail. Oldest first.
    trail: approx ? [] : earlier.map((p) => project(p.lat, p.lng)).reverse(),
    marker: { at: here, name, phrase, img, approx },
    img,
  };
}

// ---------- Markup ----------

const loadingHeading = (name: string): string => `Loading ${name}’s location`;

/** While the page trades the link for a session: a skeleton, never a blank map (same as index.html). */
function loadingMain(name: string): string {
  return `<main class="vp" aria-busy="true">
  <div class="glassbar skel" aria-hidden="true"><span class="sk av"></span><span class="sk-lines"><span class="sk w60"></span><span class="sk w40"></span></span></div>
  <div class="vp-body"><div class="vp-gap"></div>
    <div class="sheet skel"><div class="grab" aria-hidden="true"></div><span class="sk w70 tall" aria-hidden="true"></span><span class="sk w90" aria-hidden="true"></span><span class="sk w50" aria-hidden="true"></span><h1 class="sr-only" tabindex="-1">${esc(loadingHeading(name))}</h1></div>
  </div>
</main>`;
}

function shareBackCard(name: string): string {
  return `<div class="shareback">
    <div class="row"><span class="ico" aria-hidden="true">${sym('near_me', true)}</span><div><div class="t1">Let ${esc(name)} see you too</div><div class="t2" id="sb-t2">Only during this call. Nothing to install.</div></div></div>
    <div class="sb-btns"><button class="btn plain small" type="button" data-act="dismiss-share-back">Not now</button><button class="btn viewer small grow" type="button" data-act="share-back" aria-describedby="sb-t2 sb-hint">Share my location</button></div>
  </div>
  <p class="fine" id="sb-hint">Your browser will ask for permission first.</p>`;
}

/** After Not now: one quiet button stays, so share back is still a tap away during the call. */
function shareBackQuiet(name: string): string {
  return `<button class="btn plain block" type="button" data-act="share-back" aria-describedby="sb-hint">${sym('near_me', true)}Share my location with ${esc(name)}</button>
  <p class="fine" id="sb-hint">Only during this call. Your browser will ask first.</p>`;
}

function liveMain(v: View): string {
  const name = esc(v.name);
  return `<main class="vp" aria-labelledby="vp-h1">
  <div class="glassbar">
    <div class="av sharer" aria-hidden="true"><img src="${esc(v.img.src)}" data-fallback="${esc(v.img.fallback)}" alt="" width="32" height="32" decoding="async"></div>
    <div class="txt">
      <span class="t1">${name}</span>
      <span class="t2"><span class="d" aria-hidden="true"></span><span aria-hidden="true">Live · updated just now</span><span class="sr-only">Live, updated now</span></span>
    </div>
    ${v.onCall ? '<span class="pill call"><span class="d" aria-hidden="true"></span>On your call</span>' : ''}
  </div>
  <div class="vp-body">
    <div class="vp-gap"></div>
    <div class="sheet">
      <div class="grab" aria-hidden="true"></div>
      <div class="head">
        <h1 id="vp-h1" tabindex="-1">${name} is sharing their location with you</h1>
        <p class="where"><span class="wi" aria-hidden="true">${sym('location_on', true)}</span><span class="wt">${esc(v.where)}</span></p>
        <p class="sub">${esc(v.until)}</p>
        <div class="where-btns">
          <button class="btn neutral small" type="button" data-act="show-sharer">${sym('my_location')}Show ${name}</button>
          <a class="btn neutral small" href="${esc(v.mapsHref)}" target="_blank" rel="noopener noreferrer">${MAP_SVG}Open in Maps</a>
        </div>
      </div>
      ${v.offerShareBack ? `<div class="sb-slot">${shareBackCard(v.name)}</div>` : ''}
    </div>
  </div>
</main>`;
}

const fromHtml = (html: string): HTMLElement => {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild as HTMLElement;
};

/** Avatar renders fall back like the marker: the flat SVG, then a plain lamplight disc. */
function wireFallbacks(root: ParentNode): void {
  for (const img of root.querySelectorAll<HTMLImageElement>('img[data-fallback]')) {
    img.addEventListener('error', () => {
      const fb = img.dataset.fallback;
      if (fb && img.getAttribute('src') !== fb) img.src = fb;
      else img.closest('.av')?.classList.add('no-art');
    });
  }
}

// ---------- Page ----------

const mapHost = document.getElementById('map') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const data = createSample();
const view = toView(data, Date.now());
const map = new MapView(mapHost, 'Street map');

const currentMain = (): HTMLElement | null => document.querySelector<HTMLElement>('main.vp');

/** One polite region, for changes only (never ticking times). */
function announce(text: string): void {
  statusEl.textContent = '';
  window.setTimeout(() => { statusEl.textContent = text; }, 60);
}

/** The browser's own bars follow the map's land color, from the tokens. */
function syncThemeColor(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const land = getComputedStyle(document.documentElement).getPropertyValue('--map-land').trim();
  if (meta && land) meta.content = land;
}

// Layout: keep the sharer in the open band (phones: between the bar and the sheet; wide screens:
// right of the column). On a phone with large text or zoom, the column scrolls and the band keeps
// MIN_BAND px, so the sheet never squeezes the map away.
function updateTall(vp: HTMLElement): void {
  const body = vp.querySelector<HTMLElement>('.vp-body');
  const sheet = vp.querySelector<HTMLElement>('.sheet');
  if (wide.matches || !body || !sheet) {
    vp.classList.remove('tall');
    return;
  }
  vp.classList.toggle('tall', sheet.scrollHeight + MIN_BAND > body.clientHeight);
}

function layout(animate: boolean): void {
  const vp = currentMain();
  if (!vp) return;
  updateTall(vp);
  const box = mapHost.getBoundingClientRect();
  let x0 = box.left, x1 = box.right, y0 = box.top, y1 = box.bottom;
  if (wide.matches) {
    x0 = Math.min(Math.max(x0, vp.getBoundingClientRect().right), x1 - 80);
  } else {
    const gap = vp.querySelector('.vp-gap')?.getBoundingClientRect();
    if (gap && gap.height > 0) { y0 = gap.top; y1 = gap.bottom; }
  }
  // The marker's visible bulk (halo above, name below) sits a little under its point.
  map.frame([(x0 + x1) / 2 - box.left, (y0 + y1) / 2 - box.top - 8], view.here, animate && !reduceMotion.matches);
}

let resizing = 0;
const observer = new ResizeObserver(() => layout(!resizing));
function observe(vp: HTMLElement): void {
  observer.disconnect();
  for (const el of vp.querySelectorAll('.vp-body, .sheet')) observer.observe(el);
}
window.addEventListener('resize', () => {
  window.clearTimeout(resizing);
  resizing = window.setTimeout(() => { resizing = 0; }, 200);
  layout(false);
});
wide.addEventListener('change', () => layout(false));

/** The sheet grows from the skeleton's size to its own, instead of jumping. */
function revealSheet(vp: HTMLElement, from: DOMRect | undefined): void {
  const sheet = vp.querySelector<HTMLElement>('.sheet');
  if (!sheet || !from || reduceMotion.matches || !sheet.animate) return;
  const to = sheet.getBoundingClientRect();
  const top = Math.max(0, Math.round(from.top - to.top));
  const bottom = Math.max(0, Math.round(to.bottom - from.bottom));
  if (!top && !bottom) return;
  const r = getComputedStyle(sheet).borderTopLeftRadius;
  sheet.animate(
    [{ clipPath: `inset(${top}px 0 ${bottom}px 0 round ${r})` }, { clipPath: `inset(0 0 0 0 round ${r})` }],
    { duration: 480, easing: 'cubic-bezier(.2, .9, .2, 1)' },
  );
}

function showLoading(): void {
  let vp = currentMain();
  if (vp?.getAttribute('aria-busy') === 'true') {
    // index.html paints the skeleton before this script runs; only the heading needs the name.
    const h1 = vp.querySelector('h1');
    if (h1) h1.textContent = loadingHeading(view.name);
  } else {
    const next = fromHtml(loadingMain(view.name));
    if (vp) vp.replaceWith(next); else document.body.prepend(next);
    vp = next;
  }
  document.title = docTitle('Loading');
  map.setSharer(null);
  observe(vp);
  layout(false);
}

/** Loading → live. Focus stays where it is; the change is announced once, politely. */
function showLive(fromLoading: boolean): void {
  const old = currentMain();
  const from = old?.querySelector('.sheet')?.getBoundingClientRect();
  const vp = fromHtml(liveMain(view));
  vp.classList.add('enter');
  if (old) old.replaceWith(vp); else document.body.prepend(vp);
  wireFallbacks(vp);
  document.title = docTitle(`${view.name} is sharing their location`);
  map.setMapLabel(view.mapLabel);
  map.setTrail(view.trail);
  map.setSharer(view.marker, true);
  observe(vp);
  layout(fromLoading);
  if (fromLoading) {
    revealSheet(vp, from);
    announce(`${view.name} is sharing their location with you. ${view.where}.`);
  }
  window.setTimeout(() => vp.classList.remove('enter'), 900);
}

// ---------- Actions ----------

function dismissShareBack(): void {
  const slot = document.querySelector<HTMLElement>('.sb-slot');
  if (!slot) return;
  slot.innerHTML = shareBackQuiet(view.name);
  // The card's buttons are gone: focus moves on purpose to the one that replaces them.
  slot.querySelector<HTMLButtonElement>('button')?.focus();
}

function requestShareBack(): void {
  // TODO(share-back): only now, on this tap, ask the browser for location (never on page load),
  // write viewerPings while the call lasts, and handle a refusal (FSD §4 Share back, §9).
  console.info('[viewer shell] Share my location: not wired up in Sprint 0.');
}

document.addEventListener('click', (e) => {
  const el = (e.target as Element | null)?.closest<HTMLElement>('[data-act]');
  switch (el?.dataset.act) {
    case 'show-sharer':
      // Show Alex: frame the sharer and pulse the marker once. Focus stays on the button.
      layout(true);
      map.ping();
      break;
    case 'dismiss-share-back':
      dismissShareBack();
      break;
    case 'share-back':
      requestShareBack();
      break;
    default:
      break;
  }
});

// ---------- Start ----------

syncThemeColor();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeColor);

if (stateParam === 'live') {
  showLive(false);
} else {
  showLoading();
  // TODO(session): trade the link token for a viewer sign-in, then listen to the session and its pings.
  if (stateParam !== 'loading') window.setTimeout(() => showLive(true), LOADING_MS);
}
void document.fonts.ready.then(() => layout(false));
