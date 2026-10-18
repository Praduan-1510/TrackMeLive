/** Firebase errors as the page tells them apart. No SDK import, so it's unit-tested on its own. */

import { BackendError, type BackendErrorCode } from '../backend';

const CODES: readonly BackendErrorCode[] = [
  'not-found',
  'invalid-argument',
  'failed-precondition',
  'resource-exhausted',
  'permission-denied',
  'unauthenticated',
  'unavailable',
  'deadline-exceeded',
];

/** A Firestore, Functions or Auth error as a BackendError ("functions/not-found" → "not-found"). */
export function toBackendError(err: unknown): BackendError {
  if (err instanceof BackendError) return err;
  const e = typeof err === 'object' && err !== null ? (err as { code?: unknown; message?: unknown; details?: unknown }) : {};
  const raw = typeof e.code === 'string' ? e.code.replace(/^(functions|firestore)\//, '') : '';
  const code = CODES.find((c) => c === raw) ?? (raw === 'auth/network-request-failed' ? 'unavailable' : 'other');
  return new BackendError(code, typeof e.message === 'string' ? e.message : String(err), e.details);
}
