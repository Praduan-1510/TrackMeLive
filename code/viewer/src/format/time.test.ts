import { describe, expect, it } from 'vitest';
import { agoShort, agoSpoken, clockStyleFor, formatTime } from './time';

const at = (h: number, m: number): Date => new Date(2026, 9, 17, h, m);

describe('formatTime', () => {
  it('writes the product’s 12-hour style: "9:41 pm"', () => {
    const twelve = { hour12: true };
    expect(formatTime(at(21, 41), twelve)).toBe('9:41 pm');
    expect(formatTime(at(0, 5), twelve)).toBe('12:05 am');
    expect(formatTime(at(12, 0), twelve)).toBe('12:00 pm');
  });
  it('writes a 24-hour clock where the device uses one', () => {
    const day = { hour12: false };
    expect(formatTime(at(21, 41), day)).toBe('21:41');
    expect(formatTime(at(9, 5), day)).toBe('09:05');
  });
});

describe('clockStyleFor', () => {
  it('follows the locale’s clock', () => {
    expect(clockStyleFor('en-US').hour12).toBe(true);
    expect(clockStyleFor('en-GB').hour12).toBe(false);
    expect(clockStyleFor('de-DE').hour12).toBe(false);
  });
});

describe('agoShort and agoSpoken', () => {
  it('says "just now" for the first moments', () => {
    expect(agoShort(0)).toBe('just now');
    expect(agoShort(1400)).toBe('just now');
    expect(agoSpoken(0)).toBe('now');
  });
  it('ticks in seconds, then minutes', () => {
    expect(agoShort(2000)).toBe('2 s ago');
    expect(agoShort(59_000)).toBe('59 s ago');
    expect(agoShort(60_000)).toBe('1 min ago');
    expect(agoShort(150_000)).toBe('3 min ago');
  });
  it('speaks the unit’s name, never its symbol', () => {
    expect(agoSpoken(12_000)).toBe('12 seconds ago');
    expect(agoSpoken(60_000)).toBe('1 minute ago');
    expect(agoSpoken(180_000)).toBe('3 minutes ago');
  });
  it('never counts into the future', () => {
    expect(agoShort(-5000)).toBe('just now');
  });
});
