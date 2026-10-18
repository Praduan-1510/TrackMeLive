import { describe, expect, it } from 'vitest';
import { BackendError } from '../backend';
import { toBackendError } from './errors';

describe('toBackendError', () => {
  it('reads the callable’s and Firestore’s codes, with the callable’s details', () => {
    const e = toBackendError({ code: 'functions/failed-precondition', message: 'ended', details: { reason: 'session_ended' } });
    expect(e).toBeInstanceOf(BackendError);
    expect(e).toMatchObject({ code: 'failed-precondition', message: 'ended', details: { reason: 'session_ended' } });
    expect(toBackendError({ code: 'permission-denied', message: 'no' }).code).toBe('permission-denied');
    expect(toBackendError({ code: 'firestore/unavailable' }).code).toBe('unavailable');
  });
  it('calls a network failure while signing in unavailable, and anything else other', () => {
    expect(toBackendError({ code: 'auth/network-request-failed' }).code).toBe('unavailable');
    expect(toBackendError({ code: 'functions/internal', message: 'internal' }).code).toBe('other');
    expect(toBackendError(new TypeError('Failed to fetch'))).toMatchObject({ code: 'other', message: 'Failed to fetch' });
    expect(toBackendError('odd').message).toBe('odd');
  });
  it('passes a BackendError through', () => {
    const e = new BackendError('not-found', 'x');
    expect(toBackendError(e)).toBe(e);
  });
});
