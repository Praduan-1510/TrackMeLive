import { describe, expect, it } from 'vitest';
import { frameCamera, keepsInBand, lerpCamera, sameCamera, toScreen, type Pt } from './camera';
import { trailDots } from './trail';

const band = { left: 0, top: 100, right: 390, bottom: 400 };
const limits = { pad: 56, minZoom: 0.3, maxZoom: 1, lift: 8 };

describe('frameCamera', () => {
  it('puts one person in the middle of the band, at full size', () => {
    const c = frameCamera([[500, -200]], band, limits);
    expect(c.zoom).toBe(1);
    expect(toScreen(c, [500, -200])).toEqual([195, 242]);
  });

  it('keeps two people who fit at full size, centered between them', () => {
    const pts: Pt[] = [[0, 0], [140, -140]];
    const c = frameCamera(pts, band, limits);
    expect(c.zoom).toBe(1);
    expect(keepsInBand(c, pts, band, limits.pad)).toBe(true);
  });

  it('zooms out only as far as two people need', () => {
    const pts: Pt[] = [[0, 0], [0, 600]];
    const c = frameCamera(pts, band, limits);
    expect(c.zoom).toBeCloseTo((300 - 2 * 56) / 600, 6);
    // Lifted a little, for the marker's halo above and name below.
    expect(keepsInBand(c, pts, band, limits.pad - limits.lift - 0.001)).toBe(true);
  });

  it('never zooms out past the least zoom', () => {
    expect(frameCamera([[0, 0], [0, 10_000]], band, limits).zoom).toBe(0.3);
  });
});

describe('keepsInBand and the camera’s motion', () => {
  it('notices a person leaving the band', () => {
    const c = { x: 0, y: 0, zoom: 1 };
    expect(keepsInBand(c, [[195, 250]], band, 56)).toBe(true);
    expect(keepsInBand(c, [[195, 380]], band, 56)).toBe(false);
  });
  it('moves straight between two cameras', () => {
    const a = { x: 0, y: 0, zoom: 1 };
    const b = { x: 100, y: -50, zoom: 0.5 };
    expect(lerpCamera(a, b, 0.5)).toEqual({ x: 50, y: -25, zoom: 0.75 });
    expect(sameCamera(lerpCamera(a, b, 1), b)).toBe(true);
    expect(sameCamera(a, b)).toBe(false);
  });
});

describe('trailDots', () => {
  const spacing = { gap: 14, clear: 34, max: 8 };
  const line = (n: number, step: number): Pt[] => Array.from({ length: n }, (_, i) => [-(n - i) * step, 0]);

  it('keeps dots apart from each other and from the marker, newest first', () => {
    const dots = trailDots(line(30, 3), [0, 0], spacing);
    const xs = dots.map((d) => d.at[0]);
    expect(Math.max(...xs)).toBeLessThanOrEqual(-34);
    for (let i = 1; i < xs.length; i++) expect(Math.abs((xs[i] ?? 0) - (xs[i - 1] ?? 0))).toBeGreaterThanOrEqual(14);
  });

  it('draws at most `max` dots, sized by age from about 4px to 8px across', () => {
    const dots = trailDots(line(60, 20), [0, 0], spacing);
    expect(dots).toHaveLength(8);
    expect(dots[0]?.r).toBeCloseTo(2.25, 6);
    expect(dots[7]?.r).toBe(4);
    // Oldest first, so the newest draws on top.
    expect(dots[0]?.at[0]).toBeLessThan(dots[7]?.at[0] ?? 0);
  });

  it('draws nothing when every earlier point is under the marker', () => {
    expect(trailDots([[-1, 0], [-2, 0]], [0, 0], spacing)).toEqual([]);
  });
});
