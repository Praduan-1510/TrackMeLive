import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onCall } from "firebase-functions/https";
import { requireCurrentSharer } from "../auth.js";
import type { ReportCallEndedResponse } from "../shared/schema.js";
import { dueEnd, endFields, endSession, type SessionEnd } from "./end.js";
import { readOwnedSession, sessionRefs, type Session } from "./read.js";
import { parseRequest, requireSessionCall } from "./request.js";

type CallEndState = Pick<Session, "status" | "call_ended_at" | "ended_at" | "end_reason">;

const stateOf = (s: CallEndState): CallEndState => ({
  status: s.status,
  call_ended_at: s.call_ended_at,
  ended_at: s.ended_at,
  end_reason: s.end_reason,
});

/**
 * The session's call ended (FSD §4 "Auto-expiry", §9 "Call drops mid-share";
 * shared ReportCallEndedRequest).
 *
 * In one transaction: call_ended_at now, call_active false and viewer_sharing
 * false, so share back stops right away and call_active can never come back
 * (x-decisions Q-CALL-ENDED-AT). With the call stop rule the session ends too
 * (end_reason call) and users.active_session_id is cleared; with a timer it
 * keeps going. Idempotent: a repeat report, or one for a session that has
 * already ended, changes nothing. A session already past stop_at or expires_at
 * ends as timer or limit instead.
 */
export const reportCallEnded = onCall<unknown, Promise<ReportCallEndedResponse>>(async (request) => {
  const uid = await requireCurrentSharer(request.auth);
  const { session_id: sessionId, call_id: callId } = parseRequest("ReportCallEndedRequest", request.data);
  const db = getFirestore();
  const refs = sessionRefs(db, sessionId);

  const after = await db.runTransaction(async (tx): Promise<CallEndState> => {
    const { session } = await readOwnedSession(tx, refs, uid);
    requireSessionCall(session.call_id, callId);
    if (session.status === "stopped") return stateOf(session);

    const now = Timestamp.now();
    const due = dueEnd(session, now);
    if (due) {
      await endSession(tx, refs.session, uid, due);
      return { ...stateOf(session), ...endFields(due) };
    }
    if (session.call_ended_at !== null) return stateOf(session);

    const callEnd = { call_ended_at: now, call_active: false, viewer_sharing: false };
    if (session.stop_rule === "call") {
      const end: SessionEnd = { reason: "call", at: now };
      await endSession(tx, refs.session, uid, end, callEnd);
      return { ...stateOf(session), ...callEnd, ...endFields(end) };
    }
    tx.update(refs.session, callEnd);
    return { ...stateOf(session), ...callEnd };
  });

  logger.info("call ended", { session_id: sessionId, status: after.status, end_reason: after.end_reason });
  return {
    session_id: sessionId,
    status: after.status,
    call_ended_at: after.call_ended_at?.toMillis() ?? null,
    ended_at: after.ended_at?.toMillis() ?? null,
    end_reason: after.end_reason,
  };
});
