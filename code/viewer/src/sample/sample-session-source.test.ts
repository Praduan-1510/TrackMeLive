import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '../session/source';
import { samplePlace } from './sample-places';
import { SAMPLE_LATENCY_MS, SampleSessionSource } from './sample-session-source';
import { CHANGE_AFTER_MS, SCENARIOS, isScenarioName, type Scenario } from './scenarios';
import { HERE, MOM, T0 } from '../test-fixtures';
import { unproject } from '../map/svg/projection';

function play(scenario: Scenario): { events: SessionEvent[]; source: SampleSessionSource; stop: () => void } {
  const events: SessionEvent[] = [];
  const source = new SampleSessionSource(scenario, T0);
  const stop = source.start((e) => events.push(e));
  return { events, source, stop };
}
const types = (events: readonly SessionEvent[]): string[] => events.map((e) => e.type);
const lastSession = (events: readonly SessionEvent[]) => events.filter((e) => e.type === 'session').at(-1);

describe('SampleSessionSource', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the session after the link trade, with the session and its pings', () => {
    const { events } = play(SCENARIOS.offer);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(SAMPLE_LATENCY_MS);
    expect(types(events)).toEqual(['opened', 'session', 'pings']);
    const pings = events[2];
    expect(pings?.type === 'pings' && pings.pings.length).toBe(30);
  });

  it('walks: a new ping every ping interval, newest first', () => {
    const { events } = play(SCENARIOS.offer);
    vi.advanceTimersByTime(SAMPLE_LATENCY_MS + 4000);
    const latest = events.filter((e) => e.type === 'pings').at(-1);
    if (latest?.type !== 'pings') throw new Error('no pings');
    expect(latest.pings[0]?.recorded_at.getTime()).toBe(T0 + SAMPLE_LATENCY_MS + 4000);
    expect(latest.pings).toHaveLength(31);
  });

  it('never opens a pending link, and answers invalid and expired links', () => {
    const pending = play(SCENARIOS.loading);
    vi.advanceTimersByTime(10_000);
    expect(pending.events).toEqual([]);
    const invalid = play(SCENARIOS.invalid);
    const expired = play(SCENARIOS.expired);
    vi.advanceTimersByTime(SAMPLE_LATENCY_MS);
    expect(types(invalid.events)).toEqual(['invalid']);
    expect(expired.events).toEqual([{ type: 'expired', sharer: { name: 'Alex', mascot_id: 'fox', mascot_color: 'original', mascot_accessory: null } }]);
  });

  it('says when a link can’t be opened, and when Alex deletes their account', () => {
    const busy = play(SCENARIOS['cant-open']);
    vi.advanceTimersByTime(SAMPLE_LATENCY_MS);
    expect(busy.events).toEqual([{ type: 'unavailable' }]);
    const deleted = play(SCENARIOS.deleted);
    vi.advanceTimersByTime(SAMPLE_LATENCY_MS + CHANGE_AFTER_MS);
    expect(deleted.events.at(-1)).toEqual({ type: 'gone' });
  });

  it('plays the scenario’s changes: Alex stops sharing', () => {
    const { events } = play(SCENARIOS.ended);
    vi.advanceTimersByTime(SAMPLE_LATENCY_MS + CHANGE_AFTER_MS);
    const s = lastSession(events);
    expect(s?.type === 'session' && s.session).toMatchObject({ status: 'stopped', end_reason: 'stopped', place: null });
  });

  it('writes the place with the session, as the phone would, for the newest ping', () => {
    const { events } = play(SCENARIOS.offer);
    vi.advanceTimersByTime(SAMPLE_LATENCY_MS);
    const s = lastSession(events);
    const pings = events.find((e) => e.type === 'pings');
    if (s?.type !== 'session' || pings?.type !== 'pings') throw new Error('not opened');
    expect(s.session.place).toEqual({ name: null, street: 'Harbor Way', area: 'Market', city: null, at: pings.pings[0]?.recorded_at });
    const approximate = play(SCENARIOS.approximate);
    vi.advanceTimersByTime(SAMPLE_LATENCY_MS);
    const a = lastSession(approximate.events);
    expect(a?.type === 'session' && a.session.place).toMatchObject({ name: null, street: null, area: 'Market' });
  });

  it('ends the call and share back with it', async () => {
    const { events, source } = play(SCENARIOS['call-ended']);
    vi.advanceTimersByTime(SAMPLE_LATENCY_MS);
    await source.shareBack();
    expect(lastSession(events)).toMatchObject({ session: { viewer_sharing: true } });
    vi.advanceTimersByTime(CHANGE_AFTER_MS);
    expect(lastSession(events)).toMatchObject({ session: { call_active: false, viewer_sharing: false, status: 'active' } });
    await expect(source.shareBack()).rejects.toThrow();
  });

  it('refuses share back to a watcher, and lets the viewer stop it', async () => {
    const watcher = play(SCENARIOS.watcher);
    vi.advanceTimersByTime(SAMPLE_LATENCY_MS);
    await expect(watcher.source.shareBack()).rejects.toThrow();
    const viewer = play(SCENARIOS.offer);
    vi.advanceTimersByTime(SAMPLE_LATENCY_MS);
    await viewer.source.shareBack();
    await viewer.source.stopShareBack();
    expect(lastSession(viewer.events)).toMatchObject({ session: { viewer_sharing: false } });
  });

  it('goes quiet when the page loses its connection', () => {
    const { events } = play(SCENARIOS.reconnecting);
    vi.advanceTimersByTime(SAMPLE_LATENCY_MS + CHANGE_AFTER_MS);
    expect(events.at(-1)).toEqual({ type: 'connection', online: false });
    const count = events.length;
    vi.advanceTimersByTime(20_000);
    expect(events).toHaveLength(count);
  });

  it('rounds every point while approximate', () => {
    const { events } = play(SCENARIOS.approximate);
    vi.advanceTimersByTime(SAMPLE_LATENCY_MS);
    const pings = events.find((e) => e.type === 'pings');
    expect(pings?.type === 'pings' && pings.pings[0]?.accuracy_m).toBe(500);
  });

  it('stops everything when the page stops listening', () => {
    const { events, stop } = play(SCENARIOS.ended);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(events).toEqual([]);
  });
});

describe('scenarios', () => {
  it('names every scenario the review links use', () => {
    expect(isScenarioName('both')).toBe(true);
    expect(isScenarioName('toString')).toBe(false);
    expect(isScenarioName(null)).toBe(false);
  });
});

describe('samplePlace', () => {
  const at = new Date(0);
  it('writes the street Alex walks on, and the park someone stands in as the named place', () => {
    expect(samplePlace(HERE, 'precise', at)).toEqual({ name: null, street: 'Harbor Way', area: 'Market', city: null, at });
    expect(samplePlace(unproject([-60, -180]), 'precise', at)).toMatchObject({ name: 'Alder Park' });
  });
  it('writes only the area while approximate', () => {
    expect(samplePlace(HERE, 'approximate', at)).toEqual({ name: null, street: null, area: 'Market', city: null, at });
    expect(samplePlace(MOM, 'approximate', at)).toMatchObject({ name: null, street: null, area: 'Market' });
  });
});
