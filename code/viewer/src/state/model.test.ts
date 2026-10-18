import { describe, expect, it } from 'vitest';
import { live, MOM, ping, session, sharing, T0 } from '../test-fixtures';
import { initialModel, reduce, shareBackOpen, type Model, type ViewerEvent } from './model';

const run = (m: Model, ...events: ViewerEvent[]): Model => events.reduce(reduce, m);
const fix = { ...MOM, accuracy_m: 12, recorded_at: new Date(T0) };

describe('the link', () => {
  it('opens, or turns out invalid or expired, only from pending', () => {
    const pending = initialModel(T0);
    expect(run(pending, { type: 'opened', role: 'viewer' }).link).toEqual({ kind: 'open', role: 'viewer' });
    expect(run(pending, { type: 'invalid' }).link).toEqual({ kind: 'invalid' });
    const sharer = session().sharer;
    expect(run(pending, { type: 'expired', sharer }).link).toEqual({ kind: 'expired', sharer });
    // Once open, a late answer changes nothing.
    expect(run(pending, { type: 'opened', role: 'watcher' }, { type: 'invalid' }).link.kind).toBe('open');
  });

  it('can’t be opened right now (too many browsers, or no backend)', () => {
    expect(run(initialModel(T0), { type: 'unavailable' }).link).toEqual({ kind: 'unavailable' });
    expect(run(live(), { type: 'unavailable' }).link.kind).toBe('open');
  });

  it('treats a deleted session as one that ended now, keeping what the page has', () => {
    const gone = run(live({ now: T0 + 5000 }), { type: 'gone' });
    expect(gone.session).toMatchObject({ status: 'stopped', ended_at: new Date(T0 + 5000), end_reason: null, sharer: { name: 'Alex' } });
    expect(gone.pings).toHaveLength(3);
    // Already stopped by Stop: it keeps its own end and reason.
    const stopped = session({ status: 'stopped', ended_at: new Date(T0 - 1000), end_reason: 'stopped' });
    expect(run(live({}, stopped), { type: 'gone' }).session).toEqual(stopped);
    // Deleted before the page read it: nothing to show, as a later open would find.
    expect(run(initialModel(T0), { type: 'opened', role: 'viewer' }, { type: 'gone' }).link).toEqual({ kind: 'invalid' });
  });

  it('keeps the last pings once the session has stopped', () => {
    const ended = run(live(), { type: 'session', session: session({ status: 'stopped', ended_at: new Date(T0) }) });
    expect(run(ended, { type: 'pings', pings: [] }).pings).toHaveLength(3);
    expect(run(live(), { type: 'pings', pings: [ping(0)] }).pings).toHaveLength(1);
  });
});

describe('shareBackOpen', () => {
  it('is open for the first browser during the session’s own call', () => {
    expect(shareBackOpen(live())).toBe(true);
  });
  it('is closed to a watcher (a forwarded link)', () => {
    expect(shareBackOpen(live({ link: { kind: 'open', role: 'watcher' } }))).toBe(false);
  });
  it('is closed when the sharer doesn’t allow it, or without the call', () => {
    expect(shareBackOpen(live({}, { share_back_allowed: false }))).toBe(false);
    expect(shareBackOpen(live({}, { call_active: false }))).toBe(false);
    expect(shareBackOpen(live({}, { call_ended_at: new Date(T0) }))).toBe(false);
  });
  it('is closed once the session ends, or passes its timer or limit', () => {
    expect(shareBackOpen(live({}, { status: 'stopped' }))).toBe(false);
    expect(shareBackOpen(live({}, { stop_at: new Date(T0 - 1) }))).toBe(false);
    expect(shareBackOpen(live({}, { expires_at: new Date(T0) }))).toBe(false);
  });
  it('is closed when the sharer’s app hasn’t checked in for 2 minutes', () => {
    expect(shareBackOpen(live({}, { last_ping_at: new Date(T0 - 119_000) }))).toBe(true);
    expect(shareBackOpen(live({}, { last_ping_at: new Date(T0 - 120_000) }))).toBe(false);
  });
});

describe('share back', () => {
  it('goes offer → asked the browser → sharing → stopped', () => {
    const asked = run(live(), { type: 'request-share-back' });
    expect(asked.shareBack).toBe('requesting');
    const on = run(asked, { type: 'location', fix });
    expect(on).toMatchObject({ shareBack: 'sharing', viewerFix: fix, sharingSince: new Date(T0) });
    const off = run(on, { type: 'stop-share-back' });
    expect(off).toMatchObject({ shareBack: 'stopped', viewerFix: null, sharingSince: null });
  });

  it('can be put off with Not now, and asked for again later', () => {
    const later = run(live(), { type: 'dismiss-share-back' });
    expect(later.shareBack).toBe('dismissed');
    expect(run(later, { type: 'request-share-back' }).shareBack).toBe('requesting');
    // Not now only applies to the offer.
    expect(run(sharing(), { type: 'dismiss-share-back' }).shareBack).toBe('sharing');
  });

  it('remembers a refusal or a missing position, and can try again', () => {
    const denied = run(live(), { type: 'request-share-back' }, { type: 'location-error', error: 'denied' });
    expect(denied.shareBack).toBe('denied');
    expect(run(denied, { type: 'request-share-back' }).shareBack).toBe('requesting');
    const none = run(live(), { type: 'request-share-back' }, { type: 'location-error', error: 'unavailable' });
    expect(none.shareBack).toBe('unavailable');
  });

  it('keeps sharing through a timeout between fixes, but stops on a refusal', () => {
    expect(run(sharing(), { type: 'location-error', error: 'unavailable' }).shareBack).toBe('sharing');
    expect(run(sharing(), { type: 'location-error', error: 'denied' }).shareBack).toBe('denied');
  });

  it('stops when a write is refused', () => {
    expect(run(sharing(), { type: 'share-back-refused' })).toMatchObject({ shareBack: 'unavailable', viewerFix: null });
  });

  it('never outlives the call, the session, or the sharer’s check-ins', () => {
    const callEnds = run(sharing(), { type: 'session', session: session({ call_active: false, call_ended_at: new Date(T0) }) });
    expect(callEnds).toMatchObject({ shareBack: 'idle', viewerFix: null, sharingSince: null });
    const ends = run(sharing(), { type: 'session', session: session({ status: 'stopped' }) });
    expect(ends.shareBack).toBe('idle');
    const quiet = run(sharing(), { type: 'tick', now: T0 + 3 * 60_000 });
    expect(quiet.shareBack).toBe('idle');
  });

  it('is never asked for when it isn’t open', () => {
    expect(run(live({ link: { kind: 'open', role: 'watcher' } }), { type: 'request-share-back' }).shareBack).toBe('idle');
  });

  it('ignores a fix that arrives after it stopped', () => {
    const off = run(sharing(), { type: 'stop-share-back' });
    expect(run(off, { type: 'location', fix }).shareBack).toBe('stopped');
  });
});

describe('framing and the rest', () => {
  it('frames only the sharer after Show Alex, and everyone again when sharing starts', () => {
    const shown = run(live(), { type: 'show-sharer' });
    expect(shown.frame).toBe('sharer');
    expect(run(shown, { type: 'request-share-back' }, { type: 'location', fix }).frame).toBe('people');
  });
  it('records the map, the connection, the place and the time', () => {
    const m = run(
      live(),
      { type: 'map', status: 'failed' },
      { type: 'connection', online: false },
      { type: 'place', place: { kind: 'park', name: 'Alder Park' } },
      { type: 'tick', now: T0 + 5000 },
    );
    expect(m).toMatchObject({ map: 'failed', online: false, place: { kind: 'park', name: 'Alder Park' }, now: T0 + 5000 });
  });
});
