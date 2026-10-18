import { describe, expect, it } from 'vitest';
import { distanceMeters } from '../../geo/geo';
import { METERS_PER_PX, project, projectionAt, unproject } from './projection';

describe('projectionAt', () => {
  const p = projectionAt({ lat: 12.9716, lng: 77.5946 });

  it('puts its origin at (0, 0), north up, east right', () => {
    const [x0, y0] = p.project({ lat: 12.9716, lng: 77.5946 });
    // -0 or 0: the origin either way.
    expect(Math.abs(x0) + Math.abs(y0)).toBe(0);
    const [x, y] = p.project({ lat: 12.98, lng: 77.6 });
    expect(x).toBeGreaterThan(0);
    expect(y).toBeLessThan(0);
  });

  it('round-trips, and keeps meters to within 1% over the kilometers an hour covers', () => {
    const far = { lat: 13.05, lng: 77.68 };
    const back = p.unproject(p.project(far));
    expect(back.lat).toBeCloseTo(far.lat, 9);
    expect(back.lng).toBeCloseTo(far.lng, 9);
    const [x, y] = p.project(far);
    const px = Math.hypot(x, y) * METERS_PER_PX;
    expect(px / distanceMeters({ lat: 12.9716, lng: 77.5946 }, far)).toBeCloseTo(1, 2);
  });

  it('keeps the sample city’s projection where it was', () => {
    const [x, y] = project({ lat: 37.79432, lng: -122.39468 });
    expect(Math.abs(x) + Math.abs(y)).toBe(0);
    expect(unproject([0, 0])).toEqual({ lat: 37.79432, lng: -122.39468 });
  });
});
