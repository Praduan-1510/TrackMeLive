import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onCall } from "firebase-functions/https";
import { requireCurrentSharer } from "../auth.js";
import type { ReportCallActiveResponse } from "../shared/schema.js";
import { dueEnd } from "./end.js";
import { readOwnedSession, sessionRefs } from "./read.js";
import { parseRequest, refuse, requireSessionCall } from "./request.js";

/**
 * Pings resumed and the platform still reports the session's call connected,
 * after the watchdog cleared call_active (FSD §6: "if the app comes back while
 * the same call is still connected it sets it again"; shared
 * ReportCallActiveRequest). A signal gap must not end share back for the rest
 * of the call.
 *
 * Sets call_active true and last_ping_at to now, only while the session is
 * live, the call matches and call_ended_at is null: after the call ends,
 * call_active never comes back. Idempotent.
 */
export const reportCallActive = onCall<unknown, Promise<ReportCallActiveResponse>>(async (request) => {
  const uid = await requireCurrentSharer(request.auth);
  const { session_id: sessionId, call_id: callId } = parseRequest("ReportCallActiveRequest", request.data);
  const db = getFirestore();
  const refs = sessionRefs(db, sessionId);

  const checkedInAt = await db.runTransaction(async (tx): Promise<Timestamp> => {
    const { session } = await readOwnedSession(tx, refs, uid);
    requireSessionCall(session.call_id, callId);
    const now = Timestamp.now();
    if (session.status !== "active" || dueEnd(session, now)) throw refuse("session_ended", "This share has ended.");
    if (session.call_ended_at !== null) throw refuse("call_ended", "This share's call has ended.");
    tx.update(refs.session, { call_active: true, last_ping_at: now });
    return now;
  });

  logger.info("call active again", { session_id: sessionId });
  return { session_id: sessionId, last_ping_at: checkedInAt.toMillis() };
});
