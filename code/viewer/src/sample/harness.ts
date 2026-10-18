/**
 * The sample page's wiring, from the URL:
 *
 *   ?state=<scenario>   which state to reach (src/sample/scenarios.ts; default offer)
 *   ?geo=allow|denied|unavailable|unsupported   what the "browser" answers when asked for location
 *   ?geo=browser        ask the real browser instead
 *
 * Review links and the end-to-end tests use these; Sprint 2's share links (/s/{token}) won't.
 */

import type { Action, ViewerController } from '../app/controller';
import { BrowserLocationProvider, type LocationProvider } from '../location/provider';
import type { MapView } from '../map/map-view';
import type { SessionSource } from '../session/source';
import { failingFirstLoad } from './flaky-map-view';
import { SampleLocationProvider, type SampleAnswer } from './sample-location-provider';
import { SAMPLE_VIEWER_AT, SampleSessionSource } from './sample-session-source';
import { isScenarioName, SCENARIOS, type Tap } from './scenarios';

export interface SampleSetup {
  readonly source: SessionSource;
  readonly location: LocationProvider;
  readonly wrapMap: (map: MapView) => MapView;
  readonly taps: readonly Tap[];
}

const ANSWERS: readonly SampleAnswer[] = ['allow', 'denied', 'unavailable', 'unsupported'];
const isAnswer = (s: string | null): s is SampleAnswer => ANSWERS.some((a) => a === s);

export function sampleSetup(params: URLSearchParams, nav: Navigator, secure: boolean): SampleSetup {
  const name = params.get('state');
  const scenario = SCENARIOS[isScenarioName(name) ? name : 'offer'];
  const geo = params.get('geo');
  const location =
    geo === 'browser' ? new BrowserLocationProvider(nav, secure) : new SampleLocationProvider(isAnswer(geo) ? geo : scenario.geo, SAMPLE_VIEWER_AT);
  return {
    source: new SampleSessionSource(scenario),
    location,
    wrapMap: scenario.map === 'fails-first' ? failingFirstLoad : (map) => map,
    taps: scenario.taps,
  };
}

const TAP_ACTION: Record<Tap, Action> = { dismiss: 'dismiss-share-back', share: 'share-back', stop: 'stop-share-back' };

/** Makes the scenario's taps, each as soon as the page offers it. */
export function tapThrough(controller: ViewerController, taps: readonly Tap[]): void {
  let next = 0;
  const stop = controller.onView((view) => {
    const tap = taps[next];
    if (tap === undefined) {
      stop();
      return;
    }
    if (view.kind !== 'page') return;
    const offered = tap === 'stop' ? view.people !== null : view.card?.kind === 'offer' || view.card?.kind === 'quiet';
    if (!offered) return;
    next += 1;
    // After this render finishes, as a tap would.
    queueMicrotask(() => {
      controller.act(TAP_ACTION[tap]);
    });
  });
}
