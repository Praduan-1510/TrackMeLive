/**
 * Firestore documents as the page reads them: checked against the shared schema (code/shared/schema)
 * and with every Timestamp turned into a Date. A field the schema doesn't know yet (a newer backend)
 * is set aside before the check, so an added field never breaks a page that's already out there; a
 * document that's missing a field or holds a wrong value is refused (null), never half-read.
 */

import { SCHEMA_DEFS, validate, type SharerSnapshot } from '@tml/shared/schema/generated/ts/schema';
import type { Session, SessionPing } from './source';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Only the fields `def` names, from a plain object. */
function known(def: 'ShareSession' | 'Ping' | 'SharerSnapshot', value: Record<string, unknown>): Record<string, unknown> {
  const names = Object.keys(SCHEMA_DEFS[def].properties);
  return Object.fromEntries(Object.entries(value).filter(([k]) => names.includes(k)));
}

interface TimestampLike {
  toDate(): Date;
}
const isTimestamp = (v: unknown): v is TimestampLike => isRecord(v) && typeof v.toDate === 'function';

/** The same object with every Timestamp value as a Date. */
function withDates(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, isTimestamp(v) ? v.toDate() : v]));
}

/** `shareSessions/{id}`, or null when it doesn't match the schema. */
export function decodeSession(data: unknown): Session | null {
  if (!isRecord(data)) return null;
  const fields = known('ShareSession', data);
  if (isRecord(fields.sharer)) fields.sharer = known('SharerSnapshot', fields.sharer);
  if (validate('ShareSession', fields).length > 0) return null;
  // The schema checked every field's type, Timestamps included.
  return withDates(fields) as unknown as Session;
}

/** `shareSessions/{id}/pings/{id}`, or null when it doesn't match the schema. */
export function decodePing(data: unknown): SessionPing | null {
  if (!isRecord(data)) return null;
  const fields = known('Ping', data);
  if (validate('Ping', fields).length > 0) return null;
  return withDates(fields) as unknown as SessionPing;
}

/** The sharer named in redeemLinkToken's "session_ended" refusal, or null when it isn't one. */
export function decodeSharer(data: unknown): SharerSnapshot | null {
  if (!isRecord(data)) return null;
  const fields = known('SharerSnapshot', data);
  return validate('SharerSnapshot', fields).length > 0 ? null : (fields as unknown as SharerSnapshot);
}
