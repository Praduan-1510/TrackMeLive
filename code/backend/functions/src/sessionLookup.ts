/**
 * Finding sessions through their private/meta doc: by link token
 * (redeemLinkToken) and by owner (deleteAccount). The session doc holds only
 * what the viewer may see, so both the token hash and the owner live in
 * private/meta, and a collection-group query on "private" finds them
 * (firestore.indexes.json has the field overrides).
 */
import type { DocumentReference, Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { hashLinkToken } from "./createSession.js";

/** shareSessions/{id} for its private/meta doc; null for any other doc in a "private" collection. */
function sessionOfMeta(meta: QueryDocumentSnapshot): DocumentReference | null {
  const session = meta.ref.parent.parent;
  if (meta.id !== "meta" || !session || session.parent.id !== "shareSessions" || session.parent.parent !== null) return null;
  return session;
}

/**
 * The session a link token belongs to: SHA-256 of the token, lowercase hex,
 * against private.link_token_hash (x-decisions Q-LINK-FORMAT). Null when
 * nothing matches.
 */
export async function sessionForToken(db: Firestore, token: string): Promise<DocumentReference | null> {
  const hits = await db.collectionGroup("private").where("link_token_hash", "==", hashLinkToken(token)).limit(1).get();
  const meta = hits.docs[0];
  return meta ? sessionOfMeta(meta) : null;
}

/** Every session whose private/meta names this owner, stopped ones included. */
export async function sessionsOwnedBy(db: Firestore, uid: string): Promise<DocumentReference[]> {
  const metas = await db.collectionGroup("private").where("user_id", "==", uid).get();
  return metas.docs.flatMap((meta) => sessionOfMeta(meta) ?? []);
}
