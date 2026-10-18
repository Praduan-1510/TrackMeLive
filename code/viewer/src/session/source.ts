/**
 * Where the page's facts come from. A SessionSource trades the share link for a session and then
 * reports the session document and its newest pings until the page stops listening.
 *
 * Sprint 1 runs on SampleSessionSource (src/sample/). Sprint 2 adds the Firestore source:
 *   redeemLinkToken({link_token})          → 'opened' {role}, or 'invalid' (functions/not-found), or
 *                                            'expired' {sharer} (functions/failed-precondition,
 *                                            details.reason 'session_ended'), or 'unavailable'
 *                                            (functions/resource-exhausted 'too_many_viewers', or
 *                                            an error that outlasts its retries)
 *   onSnapshot(shareSessions/{sid})        → 'session' (readable after the end too), or 'gone' once
 *                                            the document no longer exists (the sharer deleted
 *                                            their account)
 *   onSnapshot(pings, newest first)        → 'pings' (refused once the session ends; the page keeps
 *                                            the last ones it had)
 *   snapshot metadata / network state      → 'connection'
 * Share back writes viewerPings, the first in one batch with {viewer_sharing: true}.
 *
 * Field names and types are the shared schema's (code/shared/schema), with Timestamps read as Date.
 */

import type { Ping, SharerSnapshot, ShareSession, ViewerRole } from '@tml/shared/schema/generated/ts/schema';

/** `shareSessions/{sessionId}`: only what the viewer may see. */
export type Session = ShareSession<Date>;
/** `shareSessions/{sessionId}/pings/{id}` (and `viewerPings`, same fields). */
export type SessionPing = Ping<Date>;

export type SessionEvent =
  /** The link matches no session: mistyped, cut off, or never real. */
  | { readonly type: 'invalid' }
  /** The link's session ended before this page opened it. */
  | { readonly type: 'expired'; readonly sharer: SharerSnapshot }
  /** The link is real but can't be opened right now (too many browsers have it, or the backend can't be reached). */
  | { readonly type: 'unavailable' }
  /** The link opened a session. Only the first browser is the 'viewer'; later ones only watch. */
  | { readonly type: 'opened'; readonly role: ViewerRole }
  | { readonly type: 'session'; readonly session: Session }
  /** The session document no longer exists: its sharer deleted their account. */
  | { readonly type: 'gone' }
  /** The newest pings, newest first. [0] is where the sharer is now. */
  | { readonly type: 'pings'; readonly pings: readonly SessionPing[] }
  /** Whether the page can currently reach the backend. */
  | { readonly type: 'connection'; readonly online: boolean };

export interface SessionSource {
  /** Starts trading the link and listening. Returns a function that stops listening. */
  start(onEvent: (event: SessionEvent) => void): () => void;
  /** Writes one viewer ping. The first one also sets `viewer_sharing`. Rejects when refused. */
  shareBack(ping: SessionPing): Promise<void>;
  /** Sets `viewer_sharing` to false. Always allowed. */
  stopShareBack(): Promise<void>;
}
