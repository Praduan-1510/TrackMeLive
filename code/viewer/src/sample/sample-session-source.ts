/**
 * A SessionSource that plays a scenario instead of reading Firestore: the same events, in the same
 * order and shapes (the shared schema's ShareSession and Ping, Timestamps as Date). Alex walks up
 * Harbor Way, a ping every ping_interval_s, writing `place` as their phone would whenever the words
 * change (and clearing it at the end); the scenario's changes happen on schedule; share back follows
 * the Firestore rules' conditions. No network requests.
 */

import { APPROXIMATE_ROUNDING_METERS, type SharerSnapshot } from '@tml/shared/schema/generated/ts/schema';
import type { LatLng } from '../geo/geo';
import { harborWayAt } from '../map/svg/city';
import { METERS_PER_PX, project, unproject } from '../map/svg/projection';
import type { Session, SessionEvent, SessionPing, SessionSource } from '../session/source';
import { samplePlace } from './sample-places';
import type { Change, Scenario } from './scenarios';

/** The link trade and the first snapshots take about this long. */
export const SAMPLE_LATENCY_MS = 500;
/** How many pings the page's listener keeps (newest first). */
const PING_LIMIT = 40;
/** Harbor Way's t per ping: about 3 px, 18 m. */
const STEP_T = 0.00055;
/** Where the newest ping is when the page opens: (0, 0) on the map. */
const T_NOW = 0.5;
const MIN = 60_000;

const SAMPLE_SHARER: SharerSnapshot = { name: 'Alex', mascot_id: 'fox', mascot_color: 'original', mascot_accessory: null };

/** Mom: about 1.2 km north-east of Alex. */
export const SAMPLE_VIEWER_AT: LatLng = unproject([140, -140]);

/** Approximate shares round each point to about 500 m on the phone, before it's written (FSD §4). */
function rounded(p: LatLng): LatLng {
  const cell = APPROXIMATE_ROUNDING_METERS / METERS_PER_PX;
  const [x, y] = project(p);
  return unproject([Math.round(x / cell) * cell, Math.round(y / cell) * cell]);
}

export function sampleSession(now: number): Session {
  const startedAt = now - 6 * MIN;
  return {
    status: 'active',
    started_at: new Date(startedAt),
    expires_at: new Date(startedAt + 60 * MIN),
    stop_rule: 'call',
    stop_minutes: null,
    stop_at: null,
    ended_at: null,
    end_reason: null,
    call_id: 'sample-call',
    call_active: true,
    call_ended_at: null,
    share_back_allowed: true,
    last_ping_at: new Date(now - 2000),
    ping_interval_s: 4,
    precision: 'precise',
    precision_next: null,
    sharer: SAMPLE_SHARER,
    first_viewed_at: new Date(now),
    viewer_sharing: false,
    share_back_requested_at: null,
    cleaned_at: null,
    place: null,
  };
}

const sameWords = (a: Session['place'], b: Session['place']): boolean =>
  a?.name === b?.name && a?.street === b?.street && a?.area === b?.area && a?.city === b?.city;

export class SampleSessionSource implements SessionSource {
  private readonly scenario: Scenario;
  private session: Session;
  private pings: SessionPing[] = [];
  private step = 0;
  private online = true;
  private emit: (e: SessionEvent) => void = () => undefined;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private walker: ReturnType<typeof setInterval> | undefined;

  constructor(scenario: Scenario, now: number = Date.now()) {
    this.scenario = scenario;
    this.session = { ...sampleSession(now), ...scenario.session(now) };
    const newest = now - scenario.lastPingAgoMs;
    // Two minutes of history before the newest ping, newest first.
    for (let i = 0; i < 30; i++) this.pings.push(this.pingAt(T_NOW - i * STEP_T, new Date(newest - i * this.session.ping_interval_s * 1000)));
    const first = this.pings[0];
    if (first) this.session = { ...this.session, place: this.placeAt(first) };
  }

  start(onEvent: (event: SessionEvent) => void): () => void {
    this.emit = onEvent;
    if (this.scenario.link !== 'pending') this.after(SAMPLE_LATENCY_MS, () => { this.open(); });
    return () => {
      for (const t of this.timers) clearTimeout(t);
      this.timers.clear();
      clearInterval(this.walker);
      this.emit = () => undefined;
    };
  }

  shareBack(): Promise<void> {
    const s = this.session;
    const open = this.scenario.role === 'viewer' && s.status === 'active' && s.share_back_allowed && s.call_active && s.call_ended_at === null;
    if (!open) return Promise.reject(new Error('Share back is closed for this session.'));
    if (!s.viewer_sharing) this.update({ viewer_sharing: true });
    return Promise.resolve();
  }

  stopShareBack(): Promise<void> {
    if (this.session.viewer_sharing) this.update({ viewer_sharing: false });
    return Promise.resolve();
  }

  private open(): void {
    switch (this.scenario.link) {
      case 'invalid':
        this.emit({ type: 'invalid' });
        return;
      case 'expired':
        this.emit({ type: 'expired', sharer: this.session.sharer });
        return;
      case 'unavailable':
        this.emit({ type: 'unavailable' });
        return;
      case 'pending':
      case 'open':
        break;
    }
    this.emit({ type: 'opened', role: this.scenario.role });
    this.emit({ type: 'session', session: this.session });
    this.emit({ type: 'pings', pings: this.pings });
    if (this.scenario.walking) this.walker = setInterval(() => { this.walk(); }, this.session.ping_interval_s * 1000);
    for (const { afterMs, change } of this.scenario.then) this.after(afterMs, () => { this.apply(change); });
  }

  private pingAt(t: number, recordedAt: Date): SessionPing {
    const p = unproject(harborWayAt(t));
    const approx = this.session.precision === 'approximate';
    return { ...(approx ? rounded(p) : p), accuracy_m: approx ? APPROXIMATE_ROUNDING_METERS : 8, recorded_at: recordedAt };
  }

  /** The phone's lookup for this fix. */
  private placeAt(ping: SessionPing): Session['place'] {
    return samplePlace(ping, this.session.precision, ping.recorded_at);
  }

  private walk(): void {
    if (!this.online || this.session.status !== 'active') return;
    this.step += 1;
    const now = new Date();
    const ping = this.pingAt(T_NOW + this.step * STEP_T, now);
    this.pings = [ping, ...this.pings].slice(0, PING_LIMIT);
    this.emit({ type: 'pings', pings: this.pings });
    // The phone writes the place only when the words change, in the same batch as the ping.
    const place = this.placeAt(ping);
    this.update({ last_ping_at: now, ...(sameWords(place, this.session.place) ? {} : { place }) });
  }

  private apply(change: Change): void {
    const now = new Date();
    switch (change) {
      case 'stop':
      case 'timer':
        clearInterval(this.walker);
        // Every end clears the place (x-decisions Q-PLACE).
        this.update({ status: 'stopped', ended_at: now, end_reason: change === 'stop' ? 'stopped' : 'timer', viewer_sharing: false, place: null });
        return;
      case 'call-ends':
        // A function clears viewer_sharing when call_active turns false (FSD §6).
        this.update({ call_active: false, call_ended_at: now, viewer_sharing: false });
        return;
      case 'ask':
        this.update({ share_back_requested_at: now });
        return;
      case 'offline':
        this.online = false;
        this.emit({ type: 'connection', online: false });
        return;
      case 'delete':
        clearInterval(this.walker);
        this.emit({ type: 'gone' });
        return;
    }
  }

  private update(fields: Partial<Session>): void {
    this.session = { ...this.session, ...fields };
    this.emit({ type: 'session', session: this.session });
  }

  private after(ms: number, run: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      run();
    }, ms);
    this.timers.add(t);
  }
}
