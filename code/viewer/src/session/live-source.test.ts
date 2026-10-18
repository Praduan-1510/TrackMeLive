import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendError, type Connectivity, type Redeemed, type ViewerBackend, type Watch } from './backend';
import { LISTEN_RETRY_MS, LiveSessionSource, PING_LIMIT, REDEEM_RETRY_MS } from './live-source';
import type { SessionEvent, SessionPing } from './source';
import { ENV, plain, session, T0 } from '../test-fixtures';
import { initialModel, reduce } from '../state/model';
import { toView } from '../state/view';
import type { Session } from './source';

const TOKEN = 'AbCdEfGhIjKlMnOpQr-_12';
const SID = 'sess-1';
const SHARER = { name: 'Alex', mascot_id: 'fox', mascot_color: 'original', mascot_accessory: null } as const;

/** A Firestore Timestamp, as the SDK hands it over. */
const ts = (d: Date) => ({ seconds: Math.floor(d.getTime() / 1000), nanoseconds: (d.getTime() % 1000) * 1e6, toDate: () => new Date(d), toMillis: () => d.getTime() });

/** A session document's data as Firestore holds it (Timestamps, and a field this page doesn't know yet). */
function sessionDoc(over: Partial<Session> = {}): Record<string, unknown> {
  const s = session(over);
  const doc: Record<string, unknown> = { future_field: 'ignored' };
  for (const [k, v] of Object.entries(s)) doc[k] = v instanceof Date ? ts(v) : v;
  return doc;
}
const pingDoc = (ageMs: number, lat = 37.79) => ({ lat, lng: -122.39, accuracy_m: 8, recorded_at: ts(new Date(T0 - ageMs)) });

class FakeBackend implements ViewerBackend {
  redeems = 0;
  answers: (Redeemed | BackendError | Error)[] = [];
  session: Watch<unknown>[] = [];
  pings: Watch<readonly unknown[]>[] = [];
  pingLimits: number[] = [];
  stopped = { session: 0, pings: 0 };
  writes: { ping: SessionPing; first: boolean }[] = [];
  cleared = 0;
  failWrites = false;

  redeem(token: string): Promise<Redeemed> {
    this.redeems += 1;
    if (token !== TOKEN) return Promise.reject(new BackendError('not-found', 'no'));
    const a = this.answers.shift() ?? { sessionId: SID, role: 'viewer' };
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
  }
  watchSession(sessionId: string, watch: Watch<unknown>): () => void {
    expect(sessionId).toBe(SID);
    this.session.push(watch);
    return () => {
      this.stopped.session += 1;
    };
  }
  watchPings(sessionId: string, limit: number, watch: Watch<readonly unknown[]>): () => void {
    expect(sessionId).toBe(SID);
    this.pingLimits.push(limit);
    this.pings.push(watch);
    return () => {
      this.stopped.pings += 1;
    };
  }
  writeViewerPing(_sid: string, ping: SessionPing, first: boolean): Promise<void> {
    if (this.failWrites) return Promise.reject(new BackendError('permission-denied', 'no'));
    this.writes.push({ ping, first });
    return Promise.resolve();
  }
  stopViewerSharing(): Promise<void> {
    this.cleared += 1;
    return Promise.resolve();
  }
  /** The newest listener of each kind. */
  get s(): Watch<unknown> {
    const w = this.session.at(-1);
    if (!w) throw new Error('no session listener');
    return w;
  }
  get p(): Watch<readonly unknown[]> {
    const w = this.pings.at(-1);
    if (!w) throw new Error('no pings listener');
    return w;
  }
}

class FakeConnectivity implements Connectivity {
  online = true;
  private listeners = new Set<(online: boolean) => void>();
  onChange(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  set(online: boolean): void {
    this.online = online;
    for (const l of this.listeners) l(online);
  }
  get listening(): number {
    return this.listeners.size;
  }
}

interface Setup {
  readonly backend: FakeBackend;
  readonly net: FakeConnectivity;
  readonly events: SessionEvent[];
  readonly source: LiveSessionSource;
  readonly stop: () => void;
  readonly loads: () => number;
}

function setup(token = TOKEN, prepare: (b: FakeBackend) => void = () => undefined, loadFailures = 0): Setup {
  const backend = new FakeBackend();
  prepare(backend);
  const net = new FakeConnectivity();
  const events: SessionEvent[] = [];
  let loads = 0;
  const source = new LiveSessionSource({
    token,
    backend: () => (++loads <= loadFailures ? Promise.reject(new Error('chunk failed to load')) : Promise.resolve(backend)),
    connectivity: net,
    now: () => Date.now(),
  });
  const stop = source.start((e) => events.push(e));
  return { backend, net, events, source, stop, loads: () => loads };
}

const types = (events: readonly SessionEvent[]): string[] => events.map((e) => e.type);
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('opening the link', () => {
  it('trades the token, then follows the session and its newest pings', async () => {
    const { backend, events } = setup();
    await settle();
    expect(events).toEqual([{ type: 'opened', role: 'viewer' }]);
    expect(backend.pingLimits).toEqual([PING_LIMIT]);
    backend.s.next(sessionDoc(), false);
    backend.p.next([pingDoc(2000), pingDoc(6000, 37.78)], false);
    expect(types(events)).toEqual(['opened', 'session', 'pings']);
    const s = events[1];
    expect(s?.type === 'session' && s.session).toEqual(session());
    const p = events[2];
    expect(p?.type === 'pings' && p.pings).toEqual([
      { lat: 37.79, lng: -122.39, accuracy_m: 8, recorded_at: new Date(T0 - 2000) },
      { lat: 37.78, lng: -122.39, accuracy_m: 8, recorded_at: new Date(T0 - 6000) },
    ]);
  });

  it('opens as a watcher when another browser opened it first', async () => {
    const { events } = setup(TOKEN, (b) => b.answers.push({ sessionId: SID, role: 'watcher' }));
    await settle();
    expect(events).toEqual([{ type: 'opened', role: 'watcher' }]);
  });

  it('calls a token that matches no session invalid', async () => {
    const { events } = setup('nope');
    await settle();
    expect(events).toEqual([{ type: 'invalid' }]);
    const bad = setup(TOKEN, (b) => b.answers.push(new BackendError('invalid-argument', 'bad')));
    await settle();
    expect(bad.events).toEqual([{ type: 'invalid' }]);
  });

  it('says a session that already ended is no longer shared, with the sharer from the refusal', async () => {
    const { events } = setup(TOKEN, (b) =>
      b.answers.push(new BackendError('failed-precondition', 'ended', { reason: 'session_ended', sharer: { ...SHARER, extra: 1 } })),
    );
    await settle();
    expect(events).toEqual([{ type: 'expired', sharer: SHARER }]);
  });

  it('can’t open a link with too many browsers, or a refusal it doesn’t understand', async () => {
    for (const err of [
      new BackendError('resource-exhausted', 'full', { reason: 'too_many_viewers' }),
      new BackendError('failed-precondition', 'odd', { reason: 'something_else' }),
      new BackendError('failed-precondition', 'odd', { reason: 'session_ended', sharer: { name: '' } }),
      new BackendError('permission-denied', 'no'),
      new BackendError('unauthenticated', 'no'),
    ]) {
      const { events, backend } = setup(TOKEN, (b) => b.answers.push(err));
      await settle();
      expect(events).toEqual([{ type: 'unavailable' }]);
      expect(backend.redeems).toBe(1);
    }
  });

  it('asks again while the backend can’t be reached, then says the link can’t be opened', async () => {
    const down = (b: FakeBackend) => {
      for (let i = 0; i <= REDEEM_RETRY_MS.length; i++) b.answers.push(new BackendError('unavailable', 'down'));
    };
    const { events, backend } = setup(TOKEN, down);
    await settle();
    expect(backend.redeems).toBe(1);
    for (const wait of REDEEM_RETRY_MS) {
      expect(events).toEqual([]);
      await vi.advanceTimersByTimeAsync(wait);
    }
    expect(backend.redeems).toBe(REDEEM_RETRY_MS.length + 1);
    expect(events).toEqual([{ type: 'unavailable' }]);
  });

  it('opens once the backend answers again, and when the SDK loads on a second try', async () => {
    const flaky = setup(TOKEN, (b) => b.answers.push(new BackendError('deadline-exceeded', 'slow'), new Error('network')));
    await settle();
    await vi.advanceTimersByTimeAsync(REDEEM_RETRY_MS[0] + REDEEM_RETRY_MS[1]);
    expect(flaky.events).toEqual([{ type: 'opened', role: 'viewer' }]);
    const chunk = setup(TOKEN, () => undefined, 1);
    await vi.advanceTimersByTimeAsync(REDEEM_RETRY_MS[0]);
    expect(chunk.loads()).toBe(2);
    expect(chunk.events).toEqual([{ type: 'opened', role: 'viewer' }]);
  });

  it('stops asking once the page stops listening', async () => {
    const { events, backend, stop } = setup(TOKEN, (b) => b.answers.push(new BackendError('unavailable', 'down')));
    await settle();
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(backend.redeems).toBe(1);
    expect(events).toEqual([]);
  });
});

describe('following the session', () => {
  async function opened(): Promise<Setup> {
    const s = setup();
    await settle();
    s.backend.s.next(sessionDoc(), false);
    s.backend.p.next([pingDoc(2000)], false);
    return s;
  }

  it('reports the sharer deleting their account, but never a document the cache only can’t find', async () => {
    const { backend, events } = await opened();
    backend.s.next(null, true);
    expect(types(events)).not.toContain('gone');
    backend.s.next(null, false);
    expect(events.at(-1)).toEqual({ type: 'gone' });
    expect(backend.stopped).toEqual({ session: 1, pings: 1 });
  });

  it('keeps the last good session when a snapshot doesn’t match the schema', async () => {
    const { backend, events } = await opened();
    const count = events.length;
    backend.s.next({ ...sessionDoc(), status: 'paused' }, false);
    backend.s.next('not a document', false);
    expect(events).toHaveLength(count);
    expect(console.warn).toHaveBeenCalled();
  });

  it('drops pings that don’t match the schema, and ignores an empty cache while offline', async () => {
    const { backend, events } = await opened();
    backend.p.next([pingDoc(1000), { lat: 200, lng: 0, accuracy_m: 1, recorded_at: ts(new Date(T0)) }, { lat: 1 }], false);
    const last = events.at(-1);
    expect(last?.type === 'pings' && last.pings).toHaveLength(1);
    const count = events.length;
    backend.p.next([], true);
    expect(events).toHaveLength(count);
    backend.p.next([], false);
    expect(events.at(-1)).toEqual({ type: 'pings', pings: [] });
  });

  it('stops reading pings once the session has ended, on the backend or on its clock', async () => {
    const { backend } = await opened();
    backend.s.next(sessionDoc({ status: 'stopped', ended_at: new Date(T0), end_reason: 'stopped' }), false);
    expect(backend.stopped.pings).toBe(1);
    const late = await opened();
    late.backend.s.next(sessionDoc({ expires_at: new Date(T0 - 1) }), false);
    expect(late.backend.stopped.pings).toBe(1);
  });

  it('listens to pings again after a failure, with backoff, while the session is live', async () => {
    const { backend } = await opened();
    backend.p.error(new BackendError('unavailable', 'blip'));
    expect(backend.pings).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(LISTEN_RETRY_MS[0]);
    expect(backend.pings).toHaveLength(2);
    // Refused a few times (the sign-in a moment behind), then left to the session to explain.
    for (let i = 0; i < LISTEN_RETRY_MS.length; i++) {
      backend.p.error(new BackendError('permission-denied', 'no'));
      await vi.advanceTimersByTimeAsync(15_000);
    }
    const count = backend.pings.length;
    backend.p.error(new BackendError('permission-denied', 'no'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(backend.pings).toHaveLength(count);
  });

  it('ends the session when its pings are refused at the end, before the document says so (never signal dropped)', async () => {
    const end = new Date(T0 + 20_000);
    const s = setup();
    await settle();
    s.backend.s.next(sessionDoc({ expires_at: end }), false);
    s.backend.p.next([pingDoc(2000)], false);
    // The server's clock passed the end; this one is 20 s behind it.
    s.backend.p.error(new BackendError('permission-denied', 'over'));
    expect(s.events.at(-1)).toEqual({ type: 'session', session: session({ expires_at: end, status: 'stopped', ended_at: end, end_reason: 'limit' }) });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.backend.pings).toHaveLength(1);
    // A snapshot still saying active is behind: it stays ended.
    s.backend.s.next(sessionDoc({ expires_at: end }), false);
    expect(s.events.at(-1)).toMatchObject({ type: 'session', session: { status: 'stopped', end_reason: 'limit' } });
    // The page says Sharing ended at the due time, with the last location, even long after.
    let m = initialModel(T0);
    for (const e of s.events) m = reduce(m, e);
    m = reduce(reduce(m, { type: 'place', place: { kind: 'street', name: 'Harbor Way' } }), { type: 'tick', now: T0 + 60_000 });
    const v = toView(m, ENV);
    expect(v.kind === 'page' && { heading: plain(v.heading), lost: v.facts.lost, ended: v.ended }).toEqual({ heading: 'Sharing ended at 9:41 pm', lost: false, ended: true });
  });

  it('ends at the timer the same way, and only within the allowed clock skew of the end', async () => {
    const timer = { stop_rule: 'minutes' as const, stop_minutes: 15 as const, stop_at: new Date(T0 + 50_000) };
    const s = setup();
    await settle();
    s.backend.s.next(sessionDoc(timer), false);
    s.backend.p.error(new BackendError('permission-denied', 'over'));
    expect(s.events.at(-1)).toMatchObject({ type: 'session', session: { status: 'stopped', ended_at: timer.stop_at, end_reason: 'timer' } });
    // Over a minute before the end, a refusal is the sign-in a moment behind: listen again.
    const early = setup();
    await settle();
    early.backend.s.next(sessionDoc({ expires_at: new Date(T0 + 61_000) }), false);
    early.backend.p.error(new BackendError('permission-denied', 'no'));
    expect(types(early.events)).toEqual(['opened', 'session']);
    await vi.advanceTimersByTimeAsync(LISTEN_RETRY_MS[0]);
    expect(early.backend.pings).toHaveLength(2);
    // An error that isn't a refusal never ends it.
    const blip = setup();
    await settle();
    blip.backend.s.next(sessionDoc({ expires_at: new Date(T0 + 1000) }), false);
    blip.backend.p.error(new BackendError('unavailable', 'blip'));
    expect(types(blip.events)).toEqual(['opened', 'session']);
  });

  it('doesn’t listen to pings again once the session is over', async () => {
    const { backend } = await opened();
    vi.setSystemTime(session().expires_at);
    backend.p.error(new BackendError('permission-denied', 'over'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(backend.pings).toHaveLength(1);
  });

  it('listens to the session again after a failure, and gives up only on a lasting refusal', async () => {
    const { backend, events } = await opened();
    backend.s.error(new BackendError('unavailable', 'blip'));
    await vi.advanceTimersByTimeAsync(LISTEN_RETRY_MS[0]);
    expect(backend.session).toHaveLength(2);
    backend.s.next(sessionDoc(), false);
    for (let i = 0; i < LISTEN_RETRY_MS.length; i++) {
      backend.s.error(new BackendError('permission-denied', 'no'));
      await vi.advanceTimersByTimeAsync(15_000);
    }
    expect(types(events)).not.toContain('gone');
    backend.s.error(new BackendError('permission-denied', 'no'));
    expect(events.at(-1)).toEqual({ type: 'gone' });
  });

  it('says when the page is offline: the browser’s own state, or snapshots only from the cache', async () => {
    const { backend, net, events } = await opened();
    net.set(false);
    expect(events.at(-1)).toEqual({ type: 'connection', online: false });
    net.set(true);
    expect(events.at(-1)).toEqual({ type: 'connection', online: true });
    backend.s.next(sessionDoc(), true);
    expect(events.at(-2)).toEqual({ type: 'connection', online: false });
    backend.s.next(sessionDoc(), false);
    expect(events.at(-2)).toEqual({ type: 'connection', online: true });
    // Only changes are reported.
    const count = events.filter((e) => e.type === 'connection').length;
    net.set(true);
    expect(events.filter((e) => e.type === 'connection')).toHaveLength(count);
  });

  it('starts offline when the browser is', async () => {
    const backend = new FakeBackend();
    const net = new FakeConnectivity();
    net.online = false;
    const events: SessionEvent[] = [];
    new LiveSessionSource({ token: TOKEN, backend: () => Promise.resolve(backend), connectivity: net }).start((e) => events.push(e));
    await settle();
    expect(events).toEqual([{ type: 'opened', role: 'viewer' }, { type: 'connection', online: false }]);
  });

  it('stops every listener, timer and event when the page stops listening', async () => {
    const { backend, net, events, stop } = await opened();
    backend.p.error(new BackendError('unavailable', 'blip'));
    stop();
    expect(net.listening).toBe(0);
    expect(backend.stopped).toEqual({ session: 1, pings: 0 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(backend.pings).toHaveLength(1);
    const count = events.length;
    backend.s.next(sessionDoc(), false);
    expect(events).toHaveLength(count);
  });
});

describe('share back', () => {
  const fix: SessionPing = { lat: 37.8, lng: -122.4, accuracy_m: 12, recorded_at: new Date(T0) };

  it('turns viewer_sharing on with the first ping, then writes pings alone', async () => {
    const { backend, source } = setup();
    await settle();
    backend.s.next(sessionDoc(), false);
    await source.shareBack(fix);
    backend.s.next(sessionDoc({ viewer_sharing: true }), false);
    await source.shareBack(fix);
    expect(backend.writes.map((w) => w.first)).toEqual([true, false]);
    await source.stopShareBack();
    expect(backend.cleared).toBe(1);
    // Off already: nothing to clear.
    backend.s.next(sessionDoc({ viewer_sharing: false }), false);
    await source.stopShareBack();
    expect(backend.cleared).toBe(1);
  });

  it('is refused to a watcher and before the link opened, and passes a refused write on', async () => {
    const watcher = setup(TOKEN, (b) => b.answers.push({ sessionId: SID, role: 'watcher' }));
    await expect(watcher.source.shareBack(fix)).rejects.toThrow();
    await settle();
    await expect(watcher.source.shareBack(fix)).rejects.toThrow();
    await expect(watcher.source.stopShareBack()).resolves.toBeUndefined();
    const viewer = setup();
    await settle();
    viewer.backend.failWrites = true;
    await expect(viewer.source.shareBack(fix)).rejects.toThrow(BackendError);
  });
});
