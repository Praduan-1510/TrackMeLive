import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/https";
import { requireCurrentSharer } from "../auth.js";
import type { StopSessionResponse } from "../shared/schema.js";
import { endSession, recordedEnd, sharerStop, type SessionEnd } from "./end.js";
import { readOwnedSession, sessionRefs } from "./read.js";
import { parseRequest } from "./request.js";
import { runContended } from "./transactions.js";

/**
 * The sharer taps Stop (FSD §4 "Stop sharing"; shared StopSessionRequest).
 *
 * In one transaction: status stopped, ended_at now, end_reason stopped,
 * viewer_sharing false, and users.active_session_id cleared. Idempotent: a
 * session that has already ended returns how it ended, and one already past
 * stop_at or expires_at ends as timer or limit, at that time.
 */
export const stopSession = onCall<unknown, Promise<StopSessionResponse>>(async (request) => {
  const uid = await requireCurrentSharer(request.auth);
  const { session_id: sessionId } = parseRequest("StopSessionRequest", request.data);
  const db = getFirestore();
  const refs = sessionRefs(db, sessionId);

  const end = await runContended(db, "stopSession", async (tx): Promise<SessionEnd> => {
    const { session } = await readOwnedSession(tx, refs, uid);
    if (session.status === "stopped") {
      const ended = recordedEnd(session);
      if (!ended) {
        logger.error("stopped session without ended_at or end_reason", { session_id: sessionId });
        throw new HttpsError("internal", "Sharing couldn't be stopped right now.");
      }
      return ended;
    }
    const next = sharerStop(session, Timestamp.now());
    await endSession(tx, refs.session, uid, next);
    return next;
  });

  logger.info("session stopped", { session_id: sessionId, end_reason: end.reason });
  return { session_id: sessionId, ended_at: end.at.toMillis(), end_reason: end.reason };
});
