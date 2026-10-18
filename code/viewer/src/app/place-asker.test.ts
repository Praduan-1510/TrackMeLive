import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Precision } from '@tml/shared/schema/generated/ts/schema';
import { unproject } from '../map/svg/projection';
import type { Place, PlaceLookup } from '../places/lookup';
import { HERE, T0 } from '../test-fixtures';
import { PLACE_BACKOFF_MS, PlaceAsker } from './place-asker';

const STREET: Place = { kind: 'street', name: 'Harbor Way' };

/** A lookup whose answers the test decides, one per call: a Place, or 'fail'. */
function scripted(...answers: (Place | 'fail')[]): PlaceLookup & { calls: number } {
  const lookup = {
    calls: 0,
    describe: (_at: unknown, _precision: Precision): Promise<Place> => {
      const answer = answers[Math.min(lookup.calls, answers.length - 1)] ?? 'fail';
      lookup.calls += 1;
      return answer === 'fail' ? Promise.reject(new Error('no answer')) : Promise.resolve(answer);
    },
  };
  return lookup;
}

describe('PlaceAsker', () => {
  let places: Place[];
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
    places = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const asker = (lookup: PlaceLookup): PlaceAsker => new PlaceAsker(lookup, (p) => places.push(p), () => Date.now());

  it('asks once per point, and again only after the sharer moves 25 m or changes precision', async () => {
    const lookup = scripted(STREET);
    const a = asker(lookup);
    a.update(HERE, 'precise');
    await vi.advanceTimersByTimeAsync(0);
    a.update(HERE, 'precise');
    a.update(unproject([3, 0]), 'precise'); // 18 m
    await vi.advanceTimersByTimeAsync(0);
    expect(lookup.calls).toBe(1);
    a.update(unproject([5, 0]), 'precise'); // 30 m
    await vi.advanceTimersByTimeAsync(0);
    a.update(unproject([5, 0]), 'approximate');
    await vi.advanceTimersByTimeAsync(0);
    expect(lookup.calls).toBe(3);
    expect(places).toEqual([STREET, STREET, STREET]);
  });

  it('asks one at a time', async () => {
    const lookup = scripted(STREET);
    const a = asker(lookup);
    a.update(HERE, 'precise');
    a.update(unproject([100, 0]), 'precise');
    expect(lookup.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
  });

  it('handles a rejection: says where in coordinates, then retries the same spot with capped backoff', async () => {
    const lookup = scripted('fail', 'fail', 'fail', 'fail', STREET);
    const a = asker(lookup);
    a.update(HERE, 'precise');
    await vi.advanceTimersByTimeAsync(0);
    expect(places).toEqual([{ kind: 'coordinates', lat: HERE.lat, lng: HERE.lng }]);

    // The sharer stands still: the same point is asked again, after 5 s, 15 s, then 60 s.
    const retriesAt: number[] = [];
    for (let s = 1; s <= 200 && lookup.calls < 5; s++) {
      await vi.advanceTimersByTimeAsync(1000);
      const before = lookup.calls;
      a.update(HERE, 'precise');
      if (lookup.calls > before) retriesAt.push(Date.now() - T0);
      await vi.advanceTimersByTimeAsync(0);
    }
    const gaps = retriesAt.map((t, i) => t - (retriesAt[i - 1] ?? 0));
    expect(gaps).toEqual([PLACE_BACKOFF_MS[0], PLACE_BACKOFF_MS[1], PLACE_BACKOFF_MS[2], PLACE_BACKOFF_MS[2]]);
    // The name replaces the coordinates once it comes, and asking stops.
    expect(places.at(-1)).toEqual(STREET);
    const calls = lookup.calls;
    await vi.advanceTimersByTimeAsync(120_000);
    a.update(HERE, 'precise');
    expect(lookup.calls).toBe(calls);
  });

  it('asks at most once per gap as the sharer moves, but at once when the precision changes', async () => {
    const lookup = scripted(STREET);
    const a = new PlaceAsker(lookup, (p) => places.push(p), () => Date.now(), 10_000);
    a.update(HERE, 'precise');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(9000);
    a.update(unproject([10, 0]), 'precise');
    await vi.advanceTimersByTimeAsync(0);
    expect(lookup.calls).toBe(1);
    a.update(unproject([10, 0]), 'approximate');
    await vi.advanceTimersByTimeAsync(0);
    expect(lookup.calls).toBe(2);
    await vi.advanceTimersByTimeAsync(10_000);
    a.update(unproject([20, 0]), 'approximate');
    await vi.advanceTimersByTimeAsync(0);
    expect(lookup.calls).toBe(3);
  });

  it('keeps the last name, not coordinates, when a later lookup fails', async () => {
    const lookup = scripted(STREET, 'fail');
    const a = asker(lookup);
    a.update(HERE, 'precise');
    await vi.advanceTimersByTimeAsync(0);
    a.update(unproject([10, 0]), 'precise');
    await vi.advanceTimersByTimeAsync(0);
    expect(lookup.calls).toBe(2);
    expect(places).toEqual([STREET]);
  });
});
