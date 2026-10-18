/** Fixtures for the unit tests: a session at a fixed time, pings, and models in each state. */

import type { LatLng } from './geo/geo';
import { unproject } from './map/svg/projection';
import { sampleSession } from './sample/sample-session-source';
import type { Session, SessionPing } from './session/source';
import { initialModel, type Model } from './state/model';
import type { ViewEnv } from './state/view';

/** 9:41 pm on Oct 17, 2026, local time. */
export const T0 = new Date(2026, 9, 17, 21, 41, 0).getTime();
export const HERE: LatLng = unproject([0, 0]);
/** About 1.2 km north-east of HERE. */
export const MOM: LatLng = unproject([140, -140]);

export const ENV: ViewEnv = { units: 'metric', clock: { hour12: true }, maps: 'google', host: 'trackme.live', canGeolocate: true };

export const session = (over: Partial<Session> = {}): Session => ({ ...sampleSession(T0), ...over });

export const ping = (ageMs: number, at: LatLng = HERE): SessionPing => ({ ...at, accuracy_m: 8, recorded_at: new Date(T0 - ageMs) });

/** An open page with a fresh ping and its place name: the live state. */
export function live(over: Partial<Model> = {}, sessionOver: Partial<Session> = {}): Model {
  return {
    ...initialModel(T0),
    link: { kind: 'open', role: 'viewer' },
    session: session(sessionOver),
    pings: [ping(2000), ping(6000, unproject([-3, 2])), ping(10_000, unproject([-30, 20]))],
    place: { kind: 'street', name: 'Harbor Way' },
    map: 'ready',
    ...over,
  };
}

/** The live state with the viewer sharing back from MOM. */
export const sharing = (over: Partial<Model> = {}, sessionOver: Partial<Session> = {}): Model =>
  live({ shareBack: 'sharing', viewerFix: { ...MOM, accuracy_m: 12, recorded_at: new Date(T0) }, sharingSince: new Date(T0 - 4 * 60_000), ...over }, sessionOver);

/** Text without the direction isolates around names. */
export const plain = (s: string): string => s.replace(/[\u2066-\u2069]/g, '');
