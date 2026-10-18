/**
 * What the live source needs from the backend, and nothing about how: the Firebase implementation
 * (src/session/firebase/backend.ts) is the only file that knows the SDK, so the source's logic is
 * tested without it (src/session/live-source.test.ts) and the SDK loads only on a real share link.
 */

import type { ViewerRole } from '@tml/shared/schema/generated/ts/schema';
import type { SessionPing } from './source';

/** The callable and Firestore error codes the page tells apart; everything else is 'other'. */
export type BackendErrorCode =
  | 'not-found'
  | 'invalid-argument'
  | 'failed-precondition'
  | 'resource-exhausted'
  | 'permission-denied'
  | 'unauthenticated'
  | 'unavailable'
  | 'deadline-exceeded'
  | 'other';

export class BackendError extends Error {
  readonly code: BackendErrorCode;
  /** A callable's `details` (redeemLinkToken: {reason, sharer}). */
  readonly details: unknown;

  constructor(code: BackendErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'BackendError';
    this.code = code;
    this.details = details;
  }
}

/** Worth asking again: the backend couldn't be reached or didn't answer in time. */
export const isTransient = (code: BackendErrorCode): boolean => code === 'unavailable' || code === 'deadline-exceeded' || code === 'other';

export interface Redeemed {
  readonly sessionId: string;
  readonly role: ViewerRole;
}

/** A listener's callbacks. `fromCache`: the snapshot came from the local cache, not the backend (offline). */
export interface Watch<T> {
  next(value: T, fromCache: boolean): void;
  /** The listener has stopped for good; listen again to retry. */
  error(error: BackendError): void;
}

export interface ViewerBackend {
  /** Trades the link token (redeemLinkToken) and signs this browser in with the custom token it returns. */
  redeem(token: string): Promise<Redeemed>;
  /** `shareSessions/{id}`'s data, or null when the document doesn't exist. Returns a function that stops. */
  watchSession(sessionId: string, watch: Watch<unknown>): () => void;
  /** The newest `limit` pings' data, newest first. Returns a function that stops. */
  watchPings(sessionId: string, limit: number, watch: Watch<readonly unknown[]>): () => void;
  /** Writes one viewer ping; with `first`, sets `viewer_sharing` to true in the same batch (the rules need both). */
  writeViewerPing(sessionId: string, ping: SessionPing, first: boolean): Promise<void>;
  /** Sets `viewer_sharing` to false. */
  stopViewerSharing(sessionId: string): Promise<void>;
}

/** Whether the browser thinks it's online (navigator.onLine and its events). */
export interface Connectivity {
  readonly online: boolean;
  /** Calls `listener` on every change. Returns a function that stops. */
  onChange(listener: (online: boolean) => void): () => void;
}

export function browserConnectivity(win: Window): Connectivity {
  return {
    get online() {
      return win.navigator.onLine;
    },
    onChange(listener) {
      const on = (): void => {
        listener(true);
      };
      const off = (): void => {
        listener(false);
      };
      win.addEventListener('online', on);
      win.addEventListener('offline', off);
      return () => {
        win.removeEventListener('online', on);
        win.removeEventListener('offline', off);
      };
    },
  };
}
