/**
 * Track Me Live web viewer: the page a viewer ("Mom") opens from a share link, in any browser, with
 * no install. The sharer's mascot on a live map, where they are in words, and, during the call,
 * sharing back (FSD §4, §7, §9). Screen reference: prototype/ (the Mom page).
 *
 * The page is a state machine (src/state/) driven by four interfaces, so Sprint 2 swaps sources
 * without touching the UI:
 *   SessionSource   the session and its pings      SampleSessionSource now; Firestore in Sprint 2
 *   LocationProvider the viewer's own location     the browser's API, or a scripted sample
 *   PlaceLookup     where someone is, in words     the sample city now; the Maps API in Sprint 2
 *   MapView         the map behind the page        the SVG sample city now; Google Maps in Sprint 2
 *
 * Review: ?state=<scenario> (src/sample/scenarios.ts), ?theme=light|dark, ?geo=… (src/sample/harness.ts).
 *   npm run dev · npm test · npm run test:e2e · npm run lint · npm run build
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
import { sampleSetup, tapThrough } from './sample/harness';
import { samplePlaces } from './sample/sample-places';
import { answerOnly, chooseSource } from './session/choose-source';
import { parseShareLink } from './session/link';
import { browserFamily } from './ui/help-dialog';

const url = new URL(window.location.href);
const theme = url.searchParams.get('theme');
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`index.html is missing #${id}`);
  return el;
}

const mapHost = byId('map');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const locale = navigator.language;
// Sample data only in a development build or on a review link (?state=); never on a real share link.
const choice = chooseSource(parseShareLink(url.pathname), url.searchParams.has('state'), import.meta.env.DEV);
const sample = choice === 'sample' ? sampleSetup(url.searchParams, navigator, window.isSecureContext) : null;
const source = sample ? sample.source : answerOnly({ type: choice === 'unavailable' ? 'unavailable' : 'invalid' });
const location = sample ? sample.location : new BrowserLocationProvider(navigator, window.isSecureContext);
const map = new SvgMapView(mapHost, reduceMotion);

const controller = new ViewerController({
  source,
  location,
  // TODO(sprint-2): the Maps API names places for real sessions; only the sample source has pings now.
  places: samplePlaces,
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
