/**
 * Ending a session, in one place for every path that ends one: the stop job,
 * the watchdog, createSession (a stale pointer), stopSession, reportCallEnded
 * and discardSession (FSD §4 "Auto-expiry", "Stop sharing"; §6).
 */
import { FieldValue, Timestamp, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import { docPaths, type EndReason } from "../shared/schema.js";
import type { Session } from "./read.js";

export interface SessionEnd {
  reason: EndReason;
  at: Timestamp;
}

/**
 * When an active session is already over, as the rules see it: at the earlier
 * of stop_at and expires_at (x-decisions Q-SESSION-END). The 1-hour limit is
 * 'limit', and so is a stop_at equal to it; an earlier stop_at is 'timer'.
 * Null while the session is live, or once it has stopped.
 */
export function dueEnd(session: Session, now: Timestamp): SessionEnd | null {
  if (session.status !== "active") return null;
  const { stop_at: stopAt, expires_at: expiresAt } = session;
  const end: SessionEnd =
    stopAt !== null && stopAt.toMillis() < expiresAt.toMillis()
      ? { reason: "timer", at: stopAt }
      : { reason: "limit", at: expiresAt };
  return now.toMillis() >= end.at.toMillis() ? end : null;
}

/**
 * The end when the sharer stops a live session (stopSession, deleteAccount):
 * now, as stopped, unless it is already past stop_at or expires_at, which
 * ended it first.
 */
export function sharerStop(session: Session, now: Timestamp): SessionEnd {
  return dueEnd(session, now) ?? { reason: "stopped", at: now };
}

/**
 * The end for a session doc that doesn't match the shared schema, from its raw
 * fields (x-decisions Q-MALFORMED-SESSION): the earliest of its stop_at and
 * expires_at, where they are timestamps, and now. timer when stop_at came
 * first; otherwise limit, which also stands in for "unknown".
 */
export function forcedEnd(raw: Record<string, unknown>, now: Timestamp): SessionEnd {
  const ends: SessionEnd[] = [{ reason: "limit", at: now }];
  if (raw.expires_at instanceof Timestamp) ends.push({ reason: "limit", at: raw.expires_at });
  if (raw.stop_at instanceof Timestamp) ends.push({ reason: "timer", at: raw.stop_at });
  // On a tie the earlier entry wins, so stop_at == expires_at is limit.
  return ends.reduce((first, end) => (end.at.toMillis() < first.at.toMillis() ? end : first));
}

/** How a stopped session ended; null while it hasn't. */
export function recordedEnd(session: Session): SessionEnd | null {
  if (session.status !== "stopped" || session.ended_at === null || session.end_reason === null) return null;
  return { reason: session.end_reason, at: session.ended_at };
}

/**
 * The fields an end writes. Share back stops with the session, and cleaned_at
 * is written as null even on a doc that lacks it, so the 24-hour cleanup finds
 * every ended session.
 */
export function endFields(end: SessionEnd): Pick<Session, "status" | "ended_at" | "end_reason" | "viewer_sharing" | "cleaned_at"> {
  return { status: "stopped", ended_at: end.at, end_reason: end.reason, viewer_sharing: false, cleaned_at: null };
}

/**
 * Ends the session in the transaction, writing `also` in the same update, and
 * clears users/{userId}.active_session_id if it still points here (Cloud
 * Functions own that pointer). It reads the user doc, so call it before the
 * transaction's first write. userId is null when private/meta is gone.
 */
export async function endSession(
  tx: Transaction,
  sessionRef: DocumentReference,
  userId: string | null,
  end: SessionEnd,
  also: Partial<Session> = {},
): Promise<void> {
  const pointer = userId === null ? null : await pointerHere(tx, sessionRef, userId);
  tx.update(sessionRef, { ...also, ...endFields(end) });
  if (pointer) clearPointer(tx, pointer);
}

/** users/{userId}, when its active_session_id points at this session; read in the transaction. */
async function pointerHere(tx: Transaction, sessionRef: DocumentReference, userId: string): Promise<DocumentReference | null> {
  const userRef = sessionRef.firestore.doc(docPaths.user(userId));
  const user = await tx.get(userRef);
  return user.get("active_session_id") === sessionRef.id ? userRef : null;
}

function clearPointer(tx: Transaction, userRef: DocumentReference): void {
  tx.update(userRef, { active_session_id: null, updated_at: FieldValue.serverTimestamp() });
}
