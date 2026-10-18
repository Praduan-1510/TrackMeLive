/**
 * The sample page's scenarios, one per viewer state, picked with `?state=` (default: offer). Each is
 * reached the way a real page gets there: the session as Firestore would hold it, what changes after
 * the page opens, what the viewer's browser answers, and the taps the viewer makes.
 */

import type { ViewerRole } from '@tml/shared/schema/generated/ts/schema';
import type { Session } from '../session/source';
import type { SampleAnswer } from './sample-location-provider';

/** Something that happens to the session after the page opened. */
export type Change =
  /** Alex taps Stop sharing. */
  | 'stop'
  /** The timer ends the session. */
  | 'timer'
  /** The call ends; Alex's timer keeps the session going. */
  | 'call-ends'
  /** Alex taps Ask to share. */
  | 'ask'
  /** The viewer's page loses its connection. */
  | 'offline'
  /** Alex deletes their account: the session document goes away. */
  | 'delete';

/** What the viewer does, in order, each as soon as the page offers it. */
export type Tap = 'dismiss' | 'share' | 'stop';

export interface Scenario {
  readonly link: 'open' | 'pending' | 'invalid' | 'expired' | 'unavailable';
  readonly role: ViewerRole;
  /** Fields that differ from an ordinary call share, given when the page opens. */
  readonly session: (now: number) => Partial<Session>;
  /** Alex keeps moving, a ping every ping_interval_s. */
  readonly walking: boolean;
  /** How old the newest ping is when the page opens. */
  readonly lastPingAgoMs: number;
  readonly geo: SampleAnswer;
  readonly map: 'ok' | 'fails-first';
  readonly taps: readonly Tap[];
  readonly then: readonly { readonly afterMs: number; readonly change: Change }[];
}

const MIN = 60_000;
/** When a scenario's change happens after the page opens: long enough to see (and act on) the state before it. */
export const CHANGE_AFTER_MS = 2500;

const BASE: Scenario = {
  link: 'open',
  role: 'viewer',
  session: () => ({}),
  walking: true,
  lastPingAgoMs: 2000,
  geo: 'allow',
  map: 'ok',
  taps: [],
  then: [],
};

const scenario = (s: Partial<Scenario>): Scenario => ({ ...BASE, ...s });

/** A share on a timer: the session outlives the call. */
const timer = (now: number): Partial<Session> => ({ stop_rule: 'minutes', stop_minutes: 30, stop_at: new Date(now - 6 * MIN + 30 * MIN) });

export const SCENARIOS = {
  loading: scenario({ link: 'pending' }),
  offer: BASE,
  'not-now': scenario({ taps: ['dismiss'] }),
  asked: scenario({ then: [{ afterMs: CHANGE_AFTER_MS, change: 'ask' }] }),
  denied: scenario({ geo: 'denied', taps: ['share'] }),
  unavailable: scenario({ geo: 'unavailable', taps: ['share'] }),
  'no-geo': scenario({ geo: 'unsupported' }),
  both: scenario({ taps: ['share'] }),
  'stopped-back': scenario({ taps: ['share', 'stop'] }),
  // GPS is lost but the app still checks in, so share back stays on offer.
  lost: scenario({ walking: false, lastPingAgoMs: 75_000 }),
  'lost-both': scenario({ walking: false, lastPingAgoMs: 75_000, taps: ['share'] }),
  'call-ended': scenario({ session: timer, taps: ['share'], then: [{ afterMs: CHANGE_AFTER_MS, change: 'call-ends' }] }),
  ended: scenario({ then: [{ afterMs: CHANGE_AFTER_MS, change: 'stop' }] }),
  'ended-timer': scenario({ session: timer, then: [{ afterMs: CHANGE_AFTER_MS, change: 'timer' }] }),
  expired: scenario({ link: 'expired' }),
  invalid: scenario({ link: 'invalid' }),
  // Too many browsers have the link (or the backend can't be reached).
  'cant-open': scenario({ link: 'unavailable' }),
  // Alex deletes their account while sharing.
  deleted: scenario({ then: [{ afterMs: CHANGE_AFTER_MS, change: 'delete' }] }),
  'map-failed': scenario({ map: 'fails-first' }),
  approximate: scenario({ session: () => ({ precision: 'approximate' }) }),
  // Four minutes before the 1-hour limit.
  warning: scenario({ session: (now) => ({ started_at: new Date(now - 56 * MIN), expires_at: new Date(now + 4 * MIN) }) }),
  reconnecting: scenario({ then: [{ afterMs: CHANGE_AFTER_MS, change: 'offline' }] }),
  // A forwarded link: a second browser watches, and never sees share back.
  watcher: scenario({ role: 'watcher' }),
} satisfies Record<string, Scenario>;

export type ScenarioName = keyof typeof SCENARIOS;

export const isScenarioName = (s: string | null): s is ScenarioName => s !== null && Object.hasOwn(SCENARIOS, s);
