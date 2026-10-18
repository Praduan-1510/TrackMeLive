import { describe, expect, it } from 'vitest';
import { answerOnly, chooseSource } from './choose-source';
import type { ShareLink } from './link';
import type { SessionEvent } from './source';

const TOKEN: ShareLink = { kind: 'token', token: 'AbCdEfGhIjKlMnOpQr-_12' };
const MALFORMED: ShareLink = { kind: 'malformed' };
const ROOT: ShareLink = { kind: 'none' };

describe('chooseSource', () => {
  it('never shows sample data on a real share link', () => {
    expect(chooseSource(TOKEN, false, false)).toBe('unavailable');
    expect(chooseSource(TOKEN, false, true)).toBe('unavailable');
  });
  it('shows the sample on a review link (?state=), in any build', () => {
    expect(chooseSource(TOKEN, true, false)).toBe('sample');
    expect(chooseSource(ROOT, true, false)).toBe('sample');
  });
  it('shows the sample at the root only in a development build', () => {
    expect(chooseSource(ROOT, false, true)).toBe('sample');
    expect(chooseSource(ROOT, false, false)).toBe('invalid');
  });
  it('calls a malformed link invalid, always', () => {
    expect(chooseSource(MALFORMED, false, false)).toBe('invalid');
    expect(chooseSource(MALFORMED, true, true)).toBe('invalid');
  });
});

describe('answerOnly', () => {
  it('gives its one answer, and refuses share back', async () => {
    const events: SessionEvent[] = [];
    const source = answerOnly({ type: 'unavailable' });
    source.start((e) => events.push(e));
    await Promise.resolve();
    expect(events).toEqual([{ type: 'unavailable' }]);
    await expect(source.shareBack({ lat: 0, lng: 0, accuracy_m: 1, recorded_at: new Date(0) })).rejects.toThrow();
    await expect(source.stopShareBack()).resolves.toBeUndefined();
  });
});
