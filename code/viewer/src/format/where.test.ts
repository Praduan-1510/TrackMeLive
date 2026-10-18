import { describe, expect, it } from 'vitest';
import type { Place } from '../places/lookup';
import { sharerPhrase, whereLine, type WhereInput } from './where';

const street: Place = { kind: 'street', name: 'Harbor Way' };
const base: WhereInput = { place: street, lastSeen: false, approximate: false, fromViewer: null, units: 'metric' };
/** 1.2 km, the sharer north-east of the viewer. */
const ne = { meters: 1234, bearing: 45 };

describe('whereLine', () => {
  it('names the nearest street, the park, or only the area', () => {
    expect(whereLine(base).text).toBe('Near Harbor Way');
    expect(whereLine({ ...base, place: { kind: 'park', name: 'Alder Park' } }).text).toBe('In Alder Park');
    expect(whereLine({ ...base, place: { kind: 'area', name: 'Market' }, approximate: true }).text).toBe('In the Market area');
  });

  it('says "Last seen" when the newest ping is stale', () => {
    expect(whereLine({ ...base, lastSeen: true }).text).toBe('Last seen near Harbor Way');
    expect(whereLine({ ...base, lastSeen: true, place: { kind: 'park', name: 'Alder Park' } }).text).toBe('Last seen in Alder Park');
    expect(whereLine({ ...base, lastSeen: true, place: { kind: 'area', name: 'Market' } }).text).toBe('Last seen in the Market area');
  });

  it('adds how far and which way once the viewer shares back', () => {
    const w = whereLine({ ...base, fromViewer: ne });
    expect(w.text).toBe('Near Harbor Way · 1.2 km north-east of you');
    expect(w.spoken).toBe('Near Harbor Way, 1.2 kilometers north-east of you');
  });

  it('says "about" for a last-seen distance, since the sharer may have moved', () => {
    expect(whereLine({ ...base, lastSeen: true, fromViewer: ne }).text).toBe('Last seen near Harbor Way · about 1.2 km north-east of you');
  });

  it('gives no direction while approximate, only a rounded distance', () => {
    const w = whereLine({ ...base, place: { kind: 'area', name: 'Market' }, approximate: true, fromViewer: ne });
    expect(w.text).toBe('In the Market area · about 1 km from you');
    expect(w.spoken).toBe('In the Market area, about 1 kilometer from you');
  });

  it('says where in coordinates while no name has come back', () => {
    const w = whereLine({ ...base, place: { kind: 'coordinates', lat: 37.79432, lng: -122.39468 } });
    expect(w).toEqual({ text: 'Near 37.7943° N, 122.3947° W', spoken: 'Near 37.7943 degrees north, 122.3947 degrees west' });
    expect(whereLine({ ...base, place: { kind: 'coordinates', lat: -33.8688, lng: 151.2093 }, lastSeen: true }).text).toBe(
      'Last seen near 33.8688° S, 151.2093° E',
    );
  });

  it('never shows coordinates while the sharer is approximate, only that it’s approximate', () => {
    const place: Place = { kind: 'coordinates', lat: 37.79432, lng: -122.39468 };
    expect(whereLine({ ...base, place, approximate: true })).toEqual({ text: 'Approximate location', spoken: 'Approximate location' });
    expect(whereLine({ ...base, place, approximate: true, lastSeen: true }).text).toBe('Last seen at an approximate location');
    const withDistance = whereLine({ ...base, place, approximate: true, fromViewer: ne });
    expect(withDistance.text).toBe('Approximate location · about 1 km from you');
    expect(withDistance.text).not.toMatch(/\d+\.\d/);
  });

  it('uses the device’s units', () => {
    expect(whereLine({ ...base, fromViewer: ne, units: 'imperial' }).text).toBe('Near Harbor Way · 0.8 mi north-east of you');
  });
});

describe('sharerPhrase', () => {
  const units = 'metric';
  it('reads a live marker as one phrase', () => {
    expect(sharerPhrase({ name: 'Alex', state: { kind: 'live', ago: '2 seconds ago' }, approximate: false, fromViewer: ne, units })).toBe(
      'Alex, live, 1.2 kilometers away, updated 2 seconds ago',
    );
    expect(sharerPhrase({ name: 'Alex', state: { kind: 'live', ago: 'now' }, approximate: true, fromViewer: null, units })).toBe(
      'Alex, live, approximate location, updated now',
    );
  });
  it('reads a last-seen marker with its time, and when sharing ended', () => {
    expect(sharerPhrase({ name: 'Alex', state: { kind: 'last-seen', at: '9:41 pm', ended: false }, approximate: false, fromViewer: ne, units })).toBe(
      'Alex, last seen at 9:41 pm, about 1.2 kilometers away',
    );
    expect(sharerPhrase({ name: 'Alex', state: { kind: 'last-seen', at: '9:52 pm', ended: true }, approximate: false, fromViewer: null, units })).toBe(
      'Alex, last seen at 9:52 pm, when sharing stopped',
    );
  });
});
