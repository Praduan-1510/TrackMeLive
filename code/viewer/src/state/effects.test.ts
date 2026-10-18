import { describe, expect, it } from 'vitest';
import { live, MOM, session, sharing, T0 } from '../test-fixtures';
import { shareBackEffects, WRITE_EVERY_MS, type Effect } from './effects';
import { reduce, type Model, type ViewerEvent } from './model';

const fix = { ...MOM, accuracy_m: 12, recorded_at: new Date(T0) };

/** The effects of one event, as the controller sees them. */
function after(prev: Model, e: ViewerEvent, lastWriteAt = -Infinity): { next: Model; effects: Effect['kind'][] } {
  const next = reduce(prev, e);
  return { next, effects: shareBackEffects(prev, next, e, lastWriteAt).map((x) => x.kind) };
}

describe('share back effects', () => {
  it('follows the browser’s location from the tap, and writes the first fix at once', () => {
    const asked = after(live(), { type: 'request-share-back' });
    expect(asked.effects).toEqual(['watch-location']);
    expect(after(asked.next, { type: 'location', fix }).effects).toEqual(['write-ping']);
  });

  it('writes a ping about every 4 seconds, not on every fix', () => {
    const on = sharing();
    expect(after(on, { type: 'location', fix }, T0 - 1000).effects).toEqual([]);
    expect(after(on, { type: 'location', fix }, T0 - WRITE_EVERY_MS).effects).toEqual(['write-ping']);
  });

  it('clears viewer_sharing when the viewer taps Stop', () => {
    expect(after(sharing(), { type: 'stop-share-back' }).effects).toEqual(['stop-watching', 'clear-sharing']);
  });

  it('clears viewer_sharing when the browser refuses location mid-share', () => {
    const r = after(sharing(), { type: 'location-error', error: 'denied' });
    expect(r.next.shareBack).toBe('denied');
    expect(r.effects).toEqual(['stop-watching', 'clear-sharing']);
  });

  it('clears viewer_sharing when a write is refused', () => {
    const r = after(sharing(), { type: 'share-back-refused' });
    expect(r.next.shareBack).toBe('unavailable');
    expect(r.effects).toEqual(['stop-watching', 'clear-sharing']);
  });

  it('clears viewer_sharing when the call or the session ends, or the sharer goes quiet', () => {
    expect(after(sharing(), { type: 'session', session: session({ call_active: false, call_ended_at: new Date(T0) }) }).effects).toEqual([
      'stop-watching',
      'clear-sharing',
    ]);
    expect(after(sharing(), { type: 'session', session: session({ status: 'stopped' }) }).effects).toEqual(['stop-watching', 'clear-sharing']);
    expect(after(sharing(), { type: 'tick', now: T0 + 3 * 60_000 }).effects).toEqual(['stop-watching', 'clear-sharing']);
  });

  it('has nothing to clear when the browser says no before anything was shared', () => {
    const asked = reduce(live(), { type: 'request-share-back' });
    expect(after(asked, { type: 'location-error', error: 'denied' }).effects).toEqual(['stop-watching']);
  });

  it('keeps sharing (and changes nothing) through a timeout between fixes', () => {
    expect(after(sharing(), { type: 'location-error', error: 'unavailable' }).effects).toEqual([]);
  });
});
