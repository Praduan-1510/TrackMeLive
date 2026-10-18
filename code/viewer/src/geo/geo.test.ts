import { describe, expect, it } from 'vitest';
import { bearingDegrees, compass, distanceMeters } from './geo';

const sf = { lat: 37.7749, lng: -122.4194 };
const oakland = { lat: 37.8044, lng: -122.2712 };

describe('distanceMeters', () => {
  it('measures the great-circle distance', () => {
    // San Francisco to Oakland is about 13.4 km.
    expect(distanceMeters(sf, oakland)).toBeGreaterThan(13_300);
    expect(distanceMeters(sf, oakland)).toBeLessThan(13_500);
  });
  it('is zero for the same point and symmetric', () => {
    expect(distanceMeters(sf, sf)).toBe(0);
    expect(distanceMeters(sf, oakland)).toBeCloseTo(distanceMeters(oakland, sf), 6);
  });
  it('measures one degree of latitude as about 111 km', () => {
    expect(distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -2);
  });
});

describe('bearingDegrees and compass', () => {
  it('points north, east, south and west', () => {
    expect(bearingDegrees({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0, 6);
    expect(bearingDegrees({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90, 6);
    expect(bearingDegrees({ lat: 0, lng: 0 }, { lat: -1, lng: 0 })).toBeCloseTo(180, 6);
    expect(bearingDegrees({ lat: 0, lng: 0 }, { lat: 0, lng: -1 })).toBeCloseTo(270, 6);
  });
  it('names the nearest of eight directions', () => {
    expect(compass(0)).toBe('north');
    expect(compass(22)).toBe('north');
    expect(compass(23)).toBe('north-east');
    expect(compass(135)).toBe('south-east');
    expect(compass(225)).toBe('south-west');
    expect(compass(338)).toBe('north');
    expect(compass(-45)).toBe('north-west');
    expect(compass(bearingDegrees(sf, oakland))).toBe('east');
  });
});
