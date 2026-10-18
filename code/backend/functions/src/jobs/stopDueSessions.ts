import { getFirestore, type DocumentReference, type Firestore, type Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/scheduler";
import { collectionPaths } from "../shared/schema.js";
import { dueEnd, endSession, forcedEnd, type SessionEnd } from "../sessions/end.js";
import { readSessionDoc, sessionRefs, type SessionDoc } from "../sessions/read.js";
import { forEachPage, runTime, Tally } from "./run.js";

/**
 * When a doc is due to end: a session at its stop time or limit, or a doc that
 * doesn't match the shared schema (and isn't stopped) from its raw fields, so
 * it is never left active (x-decisions Q-MALFORMED-SESSION).
 */
function endFor(doc: SessionDoc, now: Timestamp): SessionEnd | null {
  switch (doc.state) {
    case "missing":
      return null;
    case "valid":
      return dueEnd(doc.session, now);
    case "malformed":
      return doc.raw.status === "stopped" ? null : forcedEnd(doc.raw, now);
  }
}

/** Ends one session if it is due; false when there was nothing to do. */
async function stopIfDue(db: Firestore, sessionRef: DocumentReference, now: Timestamp): Promise<boolean> {
  const refs = sessionRefs(db, sessionRef.id);
  const ended = await db.runTransaction(async (tx) => {
    const { doc, meta } = await readSessionDoc(tx, refs);
    const end = endFor(doc, now);
    if (!end) return null;
    await endSession(tx, refs.session, meta?.user_id ?? null, end);
    return { end, malformed: doc.state === "malformed" };
  });
  if (ended?.malformed) {
    logger.error("force-ended a session that doesn't match the shared schema", {
      session_id: sessionRef.id,
      end_reason: ended.end.reason,
      ended_at: ended.end.at.toDate().toISOString(),
    });
  }
  return ended !== null;
}

/**
 * Stops every session that is past its stop time or its 1-hour limit, even if
 * the app was killed (FSD §4 "Auto-expiry", §9 "App killed in background").
 * end_reason is timer at stop_at and limit at expires_at (including when they
 * are equal), with ended_at at that time; users.active_session_id is cleared.
 * The rules already treat these sessions as ended; this makes it official.
 */
async function stopDue(db: Firestore, now: Timestamp): Promise<void> {
  const tally = new Tally();
  const active = db.collection(collectionPaths.shareSession()).where("status", "==", "active");
  for (const field of ["expires_at", "stop_at"] as const) {
    await forEachPage(active.where(field, "<=", now).orderBy(field), (docs) =>
      tally.settle(docs, "stopping a session", (doc) => stopIfDue(db, doc.ref, now)),
    );
  }
  tally.finish("stopDueSessions");
}

export const stopDueSessions = onSchedule({ schedule: "every 1 minutes", timeoutSeconds: 300 }, (event) =>
  stopDue(getFirestore(), runTime(event)),
);
