import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onCall } from "firebase-functions/https";
import { requireCurrentSharer } from "../auth.js";
import { docPaths, type DiscardSessionResponse } from "../shared/schema.js";
import { endSession } from "./end.js";
import { readOwnedSession, sessionRefs } from "./read.js";
import { parseRequest, refuse } from "./request.js";
import { runContended } from "./transactions.js";

/**
 * The share sheet closed without a choice, so the session is deleted before
 * anyone can see it (FSD §4 "Live map link"; shared DiscardSessionRequest).
 * Only while first_viewed_at is null: redeemLinkToken sets it in a
 * transaction, so of a discard and a first open exactly one wins.
 *
 * The transaction ends the session, deletes private/meta and the callLogs
 * entry, and clears users.active_session_id. With meta gone nothing can read or
 * write it or redeem its link. Then the session and everything under it (pings
 * the app wrote meanwhile) are deleted. If that last step fails, what's left
 * is an ended session that the cleanup and purge jobs delete.
 */
export const discardSession = onCall<unknown, Promise<DiscardSessionResponse>>(async (request) => {
  const uid = await requireCurrentSharer(request.auth);
  const { session_id: sessionId } = parseRequest("DiscardSessionRequest", request.data);
  const db = getFirestore();
  const refs = sessionRefs(db, sessionId);

  await runContended(db, "discardSession", async (tx) => {
    const { session } = await readOwnedSession(tx, refs, uid);
    if (session.first_viewed_at !== null) {
      throw refuse("link_opened", "Someone has opened this link, so it can't be discarded.");
    }
    await endSession(tx, refs.session, uid, { reason: "stopped", at: Timestamp.now() });
    tx.delete(refs.meta);
    tx.delete(db.doc(docPaths.callLog(sessionId)));
  });
  await db.recursiveDelete(refs.session);

  logger.info("session discarded", { session_id: sessionId });
  return { session_id: sessionId };
});
