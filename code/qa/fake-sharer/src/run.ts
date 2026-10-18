/**
 * Shares a route in real time: a ping every `interval_s` (FSD §7: 3-5 s above 20% battery), at the
 * route position `speed` times further along than the clock, until the route ends, a ping limit is
 * reached, Stop is due, or the session ends (whoever ends it: Stop, the stop job at the timer or the
 * 1-hour limit). Every step is reported as an event, so a test can wait on exactly what happened.
 */

import { CHECK_IN_INTERVAL_SECONDS } from '../../../shared/schema/generated/ts/schema.ts';
import { positionAt, type Route } from '../../routes/route.ts';
import { WriteRefused, dueAt, type FakeSharer, type Session, type SessionState } from './sharer.ts';

export type AtEnd =
  /** Stop sharing (stopSession), as Alex would on arriving. */
  | 'stop'
  /** Keep pinging the last point until the session ends. */
  | 'hold'
  /** Write nothing more (the app was closed); wait for the session to end. */
  | 'quiet'
  /** Start the route over. */
  | 'loop';

export interface RunOptions {
  readonly route: Route;
  readonly speed?: number;
  readonly interval_s?: number;
  /** A fixed accuracy for every fix; null uses the route's. */
  readonly accuracy?: number | null;
  readonly from_s?: number;
  /** Write this many pings, then go quiet. */
  readonly pings?: number;
  /** After the pings: write nothing (app closed or offline), or keep checking in without a fix (GPS lost). */
  readonly after_pings?: 'quiet' | 'check-in';
  /** Tap Stop this many seconds after the first ping. */
  readonly stop_after_s?: number;
  readonly at_end?: AtEnd;
  /** After the session is due to end and nothing has marked it stopped, give up waiting after this long. */
  readonly end_grace_s?: number;
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: SharerEvent) => void;
}

export type SharerEvent =
  | { readonly event: 'ping'; readonly n: number; readonly id: string; readonly lat: number; readonly lng: number; readonly accuracy_m: number; readonly recorded_at: number; readonly route_t_s: number }
  | { readonly event: 'check-in'; readonly at: number }
  | { readonly event: 'quiet'; readonly after_pings: number; readonly mode: 'quiet' | 'check-in' }
  | { readonly event: 'route-end'; readonly at_end: AtEnd }
  | { readonly event: 'refused'; readonly over: boolean; readonly message: string }
  | { readonly event: 'stopping'; readonly why: string }
  | { readonly event: 'stopped'; readonly end_reason: string; readonly ended_at: number }
  | { readonly event: 'ended'; readonly end_reason: string | null; readonly ended_at: number | null }
  | { readonly event: 'waiting'; readonly for: string };

export interface RunResult {
  readonly pings: number;
  /** How the run finished. */
  readonly outcome: 'ended' | 'aborted' | 'not-marked';
  readonly end_reason: string | null;
}

/** Resolves at `when` (epoch ms), or as soon as `signal` aborts or `wake` is called. */
function waitUntil(when: number, signal: AbortSignal | undefined, wakers: Set<() => void>): Promise<void> {
  return new Promise((done) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      wakers.delete(finish);
      done();
    };
    const timer = setTimeout(finish, Math.max(0, when - Date.now()));
    signal?.addEventListener('abort', finish, { once: true });
    wakers.add(finish);
  });
}

export async function runRoute(sharer: FakeSharer, session: Session, o: RunOptions): Promise<RunResult> {
  const speed = o.speed ?? 1;
  const interval = o.interval_s ?? 4;
  const from = o.from_s ?? 0;
  const atEnd = o.at_end ?? 'stop';
  const emit = o.onEvent ?? (() => undefined);
  const graceMs = (o.end_grace_s ?? 90) * 1000;
  const wakers = new Set<() => void>();
  const wake = (): void => {
    for (const w of [...wakers]) w();
  };

  let state: SessionState | null = null;
  let listenError: string | null = null;
  const unwatch = sharer.watch(
    session.id,
    (s) => {
      const wasActive = state === null || state.status === 'active';
      state = s;
      if (wasActive && s.status === 'stopped') {
        emit({ event: 'ended', end_reason: s.end_reason, ended_at: s.ended_at?.getTime() ?? null });
        wake();
      }
    },
    (message) => {
      listenError = message;
      wake();
    },
  );
  const ended = (): boolean => (state as SessionState | null)?.status === 'stopped';
  const finish = (outcome: RunResult['outcome']): RunResult => {
    unwatch();
    const s = state as SessionState | null;
    return { pings, outcome, end_reason: s?.end_reason ?? null };
  };

  let pings = 0;
  let quiet = false;
  let refusedOver = false;
  let lastCheckIn = 0;
  const startedAt = Date.now();
  let routeOffset = 0;
  try {
    for (let tick = 0; ; tick++) {
      if (o.signal?.aborted) return finish('aborted');
      if (listenError) throw new Error(`listening to the session failed: ${String(listenError)}`);
      if (ended()) return finish('ended');
      const now = Date.now();

      if (o.stop_after_s !== undefined && now - startedAt >= o.stop_after_s * 1000) {
        emit({ event: 'stopping', why: `--stop-after ${String(o.stop_after_s)} s` });
        const r = await sharer.stop(session);
        emit({ event: 'stopped', end_reason: r.end_reason, ended_at: r.ended_at });
        return await waitForEnd();
      }

      if (!quiet && !refusedOver) {
        let routeT = from + (tick * interval * speed - routeOffset);
        if (routeT > o.route.duration_s) {
          if (atEnd === 'loop') {
            routeOffset += o.route.duration_s - from;
            routeT = from + (tick * interval * speed - routeOffset);
          } else if (atEnd === 'hold') {
            routeT = o.route.duration_s;
          } else {
            emit({ event: 'route-end', at_end: atEnd });
            if (atEnd === 'stop') {
              emit({ event: 'stopping', why: 'the route ended' });
              const r = await sharer.stop(session);
              emit({ event: 'stopped', end_reason: r.end_reason, ended_at: r.ended_at });
              return await waitForEnd();
            }
            quiet = true;
            emit({ event: 'quiet', after_pings: pings, mode: 'quiet' });
          }
        }
        if (!quiet) {
          const p = positionAt(o.route, Math.min(routeT, o.route.duration_s));
          try {
            const w = await sharer.ping(session, { lat: p.lat, lng: p.lng, accuracy_m: o.accuracy ?? p.accuracy_m }, { interval_s: interval });
            pings += 1;
            lastCheckIn = Date.now();
            emit({ event: 'ping', n: pings, id: w.id, lat: w.lat, lng: w.lng, accuracy_m: w.accuracy_m, recorded_at: w.recorded_at.getTime(), route_t_s: p.t_s });
          } catch (e) {
            if (!(e instanceof WriteRefused)) throw e;
            emit({ event: 'refused', over: e.over, message: e.message });
            if (!e.over) throw e;
            // The rules ended it at its due time; the stop job marks it stopped.
            refusedOver = true;
            emit({ event: 'waiting', for: 'the stop job to mark the session stopped' });
          }
          if (o.pings !== undefined && pings >= o.pings && !quiet) {
            quiet = true;
            emit({ event: 'quiet', after_pings: pings, mode: o.after_pings ?? 'quiet' });
          }
        }
      } else if (quiet && o.after_pings === 'check-in' && !refusedOver && now - lastCheckIn >= CHECK_IN_INTERVAL_SECONDS * 1000) {
        try {
          await sharer.checkIn(session);
          lastCheckIn = Date.now();
          emit({ event: 'check-in', at: lastCheckIn });
        } catch (e) {
          if (!(e instanceof WriteRefused) || !e.over) throw e;
          refusedOver = true;
        }
      }

      // Past the due end with nothing marking it stopped: say so instead of waiting forever.
      const s = state as SessionState | null;
      if (s && !ended() && Date.now() > dueAt(s).getTime() + graceMs) return finish('not-marked');
      await waitUntil(startedAt + (tick + 1) * interval * 1000, o.signal, wakers);
    }
  } catch (e) {
    unwatch();
    throw e;
  }

  async function waitForEnd(): Promise<RunResult> {
    const deadline = Date.now() + graceMs;
    while (!ended() && !o.signal?.aborted && Date.now() < deadline) await waitUntil(deadline, o.signal, wakers);
    return finish(ended() ? 'ended' : o.signal?.aborted ? 'aborted' : 'not-marked');
  }
}
