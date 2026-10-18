/**
 * Reading a session inside a transaction, checked against the shared schema.
 * createSession and the rules guarantee these shapes, so a doc that doesn't
 * match is a bug to log, never data to act on.
 */
import type { DocumentReference, DocumentSnapshot, Firestore, Timestamp, Transaction } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError } from "firebase-functions/https";
import { isRecord } from "../contracts.js";
import { docPaths, validate, type SessionPrivateMeta, type ShareSession } from "../shared/schema.js";

/** A session doc as the Admin SDK reads it. */
export type Session = ShareSession<Timestamp>;

const isSession = (value: unknown): value is Session => validate("ShareSession", value).length === 0;
const isMeta = (value: unknown): value is SessionPrivateMeta => validate("SessionPrivateMeta", value).length === 0;

export interface SessionRefs {
  session: DocumentReference;
  meta: DocumentReference;
}

export function sessionRefs(db: Firestore, sessionId: string): SessionRefs {
  return {
    session: db.doc(docPaths.shareSession(sessionId)),
    meta: db.doc(docPaths.sessionPrivateMeta(sessionId)),
  };
}

export interface SessionRead {
  session: Session;
  /** Null once private/meta is gone (a discarded session that is still being deleted). */
  meta: SessionPrivateMeta | null;
}

/**
 * What a session snapshot holds: nothing, a doc that doesn't match the shared
 * schema (its raw fields, so it can still be ended; logged), or a session.
 */
export type SessionDoc =
  | { state: "missing" }
  | { state: "malformed"; raw: Record<string, unknown> }
  | { state: "valid"; session: Session };

export function sessionDocFrom(snap: DocumentSnapshot): SessionDoc {
  if (!snap.exists) return { state: "missing" };
  const data: unknown = snap.data();
  if (isSession(data)) return { state: "valid", session: data };
  logger.error("session doesn't match the shared schema", { session_id: snap.id, issues: validate("ShareSession", data) });
  return { state: "malformed", raw: isRecord(data) ? data : {} };
}

function metaFrom(snap: DocumentSnapshot | undefined): SessionPrivateMeta | null {
  if (!snap?.exists) return null;
  const meta: unknown = snap.data();
  if (isMeta(meta)) return meta;
  logger.error("private/meta doesn't match the shared schema", { session_id: snap.ref.parent.parent?.id, issues: validate("SessionPrivateMeta", meta) });
  return null;
}

/** The session doc, whatever its state, and its private/meta (null when gone or malformed), read in the transaction. */
export async function readSessionDoc(tx: Transaction, refs: SessionRefs): Promise<{ doc: SessionDoc; meta: SessionPrivateMeta | null }> {
  const [sessionSnap, metaSnap] = await tx.getAll(refs.session, refs.meta);
  return { doc: sessionSnap ? sessionDocFrom(sessionSnap) : { state: "missing" }, meta: metaFrom(metaSnap) };
}

/**
 * The session and its private/meta, read in the transaction. Null when the
 * session doesn't exist or doesn't match the shared schema (logged).
 */
export async function readSession(tx: Transaction, refs: SessionRefs): Promise<SessionRead | null> {
  const { doc, meta } = await readSessionDoc(tx, refs);
  return doc.state === "valid" ? { session: doc.session, meta } : null;
}

/**
 * The caller's own session. not-found when it's missing or belongs to someone
 * else, so the answer says nothing about other people's sessions.
 */
export async function readOwnedSession(
  tx: Transaction,
  refs: SessionRefs,
  uid: string,
): Promise<{ session: Session; meta: SessionPrivateMeta }> {
  const read = await readSession(tx, refs);
  if (!read?.meta || read.meta.user_id !== uid) {
    throw new HttpsError("not-found", "This share isn't available.");
  }
  return { session: read.session, meta: read.meta };
}
