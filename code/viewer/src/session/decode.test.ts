import { describe, expect, it } from 'vitest';
import { session, T0 } from '../test-fixtures';
import { decodePing, decodeSession, decodeSharer } from './decode';

const ts = (ms: number) => ({ seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1e6, toDate: () => new Date(ms), toMillis: () => ms });

function doc(over: Record<string, unknown> = {}): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(session())) d[k] = v instanceof Date ? ts(v.getTime()) : v;
  return { ...d, ...over };
}

describe('decodeSession', () => {
  it('reads every Timestamp as a Date', () => {
    expect(decodeSession(doc())).toEqual(session());
  });
  it('reads last_fix_at as a Date, and takes it null or missing (a session older than the field)', () => {
    expect(decodeSession(doc({ last_fix_at: ts(T0 - 2000) }))?.last_fix_at).toEqual(new Date(T0 - 2000));
    expect(decodeSession(doc({ last_fix_at: null }))?.last_fix_at).toBeNull();
    expect(decodeSession(doc())).not.toHaveProperty('last_fix_at');
  });
  it('sets aside fields it doesn’t know, at the top and in the sharer', () => {
    const s = decodeSession(doc({ newer_field: 1, sharer: { ...session().sharer, nickname: 'A' } }));
    expect(s).toEqual(session());
  });
  it('refuses a document with a missing or wrong field', () => {
    expect(decodeSession(doc({ status: 'paused' }))).toBeNull();
    expect(decodeSession(doc({ expires_at: '2026-10-17' }))).toBeNull();
    const { precision: _, ...noPrecision } = doc();
    expect(decodeSession(noPrecision)).toBeNull();
    expect(decodeSession(null)).toBeNull();
    expect(decodeSession([doc()])).toBeNull();
  });
});

describe('decodePing', () => {
  it('reads a ping, and refuses one out of range or incomplete', () => {
    expect(decodePing({ lat: 1, lng: 2, accuracy_m: 3, recorded_at: ts(T0) })).toEqual({ lat: 1, lng: 2, accuracy_m: 3, recorded_at: new Date(T0) });
    expect(decodePing({ lat: 91, lng: 2, accuracy_m: 3, recorded_at: ts(T0) })).toBeNull();
    expect(decodePing({ lat: 1, lng: 2, recorded_at: ts(T0) })).toBeNull();
    expect(decodePing('x')).toBeNull();
  });
});

describe('decodeSharer', () => {
  it('reads the sharer from a refusal, and refuses anything else', () => {
    expect(decodeSharer(session().sharer)).toEqual(session().sharer);
    expect(decodeSharer({ name: 'Alex' })).toBeNull();
    expect(decodeSharer(undefined)).toBeNull();
  });
});
