import { describe, expect, it } from 'vitest';
import { formatDistance, unitsFor } from './distance';

const text = (m: number, units: 'metric' | 'imperial', approx = false): string => formatDistance(m, units, approx).text;
const spoken = (m: number, units: 'metric' | 'imperial', approx = false): string => formatDistance(m, units, approx).spoken;

describe('formatDistance, metric', () => {
  it('writes under 1 km in meters, rounded to 10', () => {
    expect(text(0, 'metric')).toBe('10 m');
    expect(text(337, 'metric')).toBe('340 m');
    expect(text(994, 'metric')).toBe('990 m');
    expect(spoken(337, 'metric')).toBe('340 meters');
  });
  it('writes 1 to 10 km with one decimal', () => {
    expect(text(995, 'metric')).toBe('1.0 km');
    expect(text(1234, 'metric')).toBe('1.2 km');
    expect(text(9949, 'metric')).toBe('9.9 km');
    expect(spoken(1234, 'metric')).toBe('1.2 kilometers');
  });
  it('writes 10 km and up in whole numbers', () => {
    expect(text(9950, 'metric')).toBe('10 km');
    expect(text(12_345, 'metric')).toBe('12 km');
    expect(spoken(12_345, 'metric')).toBe('12 kilometers');
  });
});

describe('formatDistance, imperial', () => {
  it('writes under 0.1 mi in feet, rounded to 10', () => {
    expect(text(91, 'imperial')).toBe('300 ft');
    expect(text(1, 'imperial')).toBe('10 ft');
    expect(spoken(91, 'imperial')).toBe('300 feet');
  });
  it('writes one decimal under 10 mi and whole miles from 10', () => {
    expect(text(161, 'imperial')).toBe('0.1 mi');
    expect(text(4023, 'imperial')).toBe('2.5 mi');
    expect(text(19_312, 'imperial')).toBe('12 mi');
    expect(spoken(4023, 'imperial')).toBe('2.5 miles');
  });
});

describe('formatDistance, approximate', () => {
  it('rounds to the nearest half and says about, or under 1', () => {
    expect(text(300, 'metric', true)).toBe('under 1 km');
    expect(spoken(300, 'metric', true)).toBe('under 1 kilometer');
    expect(text(1100, 'metric', true)).toBe('about 1 km');
    expect(spoken(1100, 'metric', true)).toBe('about 1 kilometer');
    expect(text(1300, 'metric', true)).toBe('about 1.5 km');
    expect(text(2100, 'metric', true)).toBe('about 2 km');
  });
  it('does the same in miles', () => {
    expect(text(400, 'imperial', true)).toBe('under 1 mi');
    expect(text(2000, 'imperial', true)).toBe('about 1 mi');
    expect(spoken(2500, 'imperial', true)).toBe('about 1.5 miles');
  });
});

describe('unitsFor', () => {
  it('uses miles where road distances are in miles', () => {
    expect(unitsFor('en-US')).toBe('imperial');
    expect(unitsFor('en-GB')).toBe('imperial');
  });
  it('uses kilometers elsewhere', () => {
    expect(unitsFor('en-IN')).toBe('metric');
    expect(unitsFor('de-DE')).toBe('metric');
    expect(unitsFor('fr')).toBe('metric');
  });
  it('falls back to kilometers for a locale it can’t read', () => {
    expect(unitsFor('not a locale!')).toBe('metric');
  });
});
