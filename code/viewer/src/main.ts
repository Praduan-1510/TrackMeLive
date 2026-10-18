/**
 * Track Me Live web viewer: the page a viewer ("Mom") opens from a share link, in any browser, with
 * no install. The sharer's mascot on a live map, where they are in words, and, during the call,
 * sharing back (FSD §4, §7, §9). Screen reference: prototype/ (the Mom page).
 *
 * The page is a state machine (src/state/) driven by four interfaces; the source behind each is
 * picked here, so the UI never knows which it has:
 *                    a share link /s/{token}                  the sample and review links
 *   SessionSource    LiveSessionSource (redeemLinkToken,       SampleSessionSource
 *                    then Firestore, live)
 *   LocationProvider the browser's API                        a scripted answer, or the browser's
 *   PlaceLookup      the Maps API's Geocoder with a Maps key,  the sample city's own names
 *                    else coordinates
 *   MapView          the SVG map on a plain backdrop, until    the SVG sample city
 *                    the Maps API draws one
 *
 * Which Firebase a share link talks to: src/session/firebase/config.ts (the emulators in any mode but
 * production). The Firebase SDK loads only on a share link.
 *
 * Review: ?state=<scenario> (src/sample/scenarios.ts), ?theme=light|dark, ?geo=… (src/sample/harness.ts).
 *   npm run dev · npm test · npm run test:e2e · npm run test:e2e:live · npm run lint · npm run build
 */

import '@tml/shared/tokens/generated/css/tokens.css';
import './styles/fonts.css';
import './styles/base.css';
import './styles/map.css';
import './styles/page.css';
import './styles/components.css';
import './styles/dialog.css';
import './styles/prefs.css';

import { Announcer } from './app/announcer';
import { ViewerController } from './app/controller';
import { unitsFor } from './format/distance';
import { clockStyleFor } from './format/time';
import { BrowserLocationProvider } from './location/provider';
import { SvgMapView } from './map/svg/svg-map-view';
import { cachedPlaces } from './places/cache';
import { coordinatesOnly } from './places/coordinates';
import { googlePlaces, mapsGeocoder } from './places/google';
import { sampleSetup, tapThrough } from './sample/harness';
import { samplePlaces } from './sample/sample-places';
import { browserConnectivity } from './session/backend';
import { answerOnly, chooseSource } from './session/choose-source';
import { firebaseTarget, type FirebaseTarget } from './session/firebase/config';
import { parseShareLink } from './session/link';
import { LiveSessionSource } from './session/live-source';
import type { SessionSource } from './session/source';
import { browserFamily } from './ui/help-dialog';

const url = new URL(window.location.href);
const theme = url.searchParams.get('theme');
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`index.html is missing #${id}`);
  return el;
}

/** The build's backend, or null (no project configured, or a value that can't be right: said in the console). */
function backendTarget(): FirebaseTarget | null {
  try {
    return firebaseTarget(import.meta.env.MODE, import.meta.env);
  } catch (err) {
    console.error(err);
    return null;
  }
}

const mapHost = byId('map');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const locale = navigator.language;
const link = parseShareLink(url.pathname);
const target = link.kind === 'token' ? backendTarget() : null;
// Sample data only in a development build or on a review link (?state=); never on a real share link.
const choice = chooseSource(link, url.searchParams.has('state'), import.meta.env.DEV, target !== null);
const sample = choice === 'sample' ? sampleSetup(url.searchParams, navigator, window.isSecureContext) : null;

function liveSource(): SessionSource {
  if (choice !== 'live' || link.kind !== 'token' || !target) return answerOnly({ type: choice === 'unavailable' ? 'unavailable' : 'invalid' });
  const t = target;
  return new LiveSessionSource({
    token: link.token,
    // The SDK's own chunk, fetched only now.
    backend: () => import('./session/firebase/backend').then((m) => m.connect(t)),
    connectivity: browserConnectivity(window),
  });
}

const mapsKey = import.meta.env.VITE_MAPS_API_KEY;
const source = sample ? sample.source : liveSource();
const location = sample ? sample.location : new BrowserLocationProvider(navigator, window.isSecureContext);
const map = new SvgMapView(mapHost, reduceMotion, sample ? 'sample-city' : 'plain');
const places = sample
  ? samplePlaces
  : cachedPlaces(typeof mapsKey === 'string' && mapsKey !== '' ? googlePlaces(mapsGeocoder(mapsKey, window)) : coordinatesOnly);

const controller = new ViewerController({
  source,
  location,
  places,
  map: sample ? sample.wrapMap(map) : map,
  mapHost,
  env: {
    units: unitsFor(locale),
    clock: clockStyleFor(locale),
    maps: /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) ? 'apple' : 'google',
    host: window.location.hostname,
    canGeolocate: location.supported,
  },
  browser: browserFamily(navigator.userAgent),
  announcer: new Announcer(byId('status'), byId('alert')),
  reduceMotion,
  wide: matchMedia('(min-width: 45em)'),
});
controller.start();
if (sample) tapThrough(controller, sample.taps);
