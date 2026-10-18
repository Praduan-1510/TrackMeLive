import { getFirestore, type DocumentReference, type Firestore, type Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/scheduler";
import { CALL_STOP_GRACE_MINUTES, WATCHDOG_TIMEOUT_SECONDS, collectionPaths } from "../shared/schema.js";
import { dueEnd, endSession } from "../sessions/end.js";
import { readSession, sessionRefs, type Session } from "../sessions/read.js";
import { forEachPage, minus, runTime, Tally } from "./run.js";

/** The app hasn't checked in for 2 minutes: killed or offline (FSD §6). */
const SILENT_MS = WATCHDOG_TIMEOUT_SECONDS * 1000;
/** A call-tied session stops 10 minutes after the watchdog clears call_active (FSD §4 "Auto-expiry", §9). */
const CALL_STOP_SILENT_MS = SILENT_MS + CALL_STOP_GRACE_MINUTES * 60_000;

const silentSince = (s: Session, cutoff: Timestamp) => s.status === "active" && s.last_ping_at.toMillis() <= cutoff.toMillis();

/** call_active false, and share back off with it; false when there was nothing to do. */
function clearCallActive(db: Firestore, sessionRef: DocumentReference, cutoff: Timestamp): Promise<boolean> {
  const refs = sessionRefs(db, sessionRef.id);
  return db.runTransaction(async (tx) => {
    const read = await readSession(tx, refs);
    if (!read || !read.session.call_active || !silentSince(read.session, cutoff)) return false;
    tx.update(refs.session, { call_active: false, viewer_sharing: false });
    return true;
  });
}

/** Ends a silent call-tied session (end_reason call, or limit once past expires_at). */
function stopSilentCallShare(db: Firestore, sessionRef: DocumentReference, now: Timestamp, cutoff: Timestamp): Promise<boolean> {
  const refs = sessionRefs(db, sessionRef.id);
  return db.runTransaction(async (tx) => {
    const read = await readSession(tx, refs);
    if (!read || read.session.stop_rule !== "call" || !silentSince(read.session, cutoff)) return false;
    await endSession(tx, refs.session, read.meta?.user_id ?? null, dueEnd(read.session, now) ?? { reason: "call", at: now });
    return true;
  });
}

/**
 * The watchdog (FSD §6 "Design decisions", §9 "App killed in background";
 * x-decisions Q-WATCHDOG). When the app hasn't checked in for 2 minutes, its
 * call can't be vouched for: call_active false and viewer_sharing false. The
 * app sets call_active again through reportCallActive if the same call is
 * still connected. A session that stops with the call ends 10 minutes after
 * that, so 12 minutes after the last check-in.
 */
async function watchCalls(db: Firestore, now: Timestamp): Promise<void> {
  const tally = new Tally();
  const active = db.collection(collectionPaths.shareSession()).where("status", "==", "active");

  const silent = minus(now, SILENT_MS);
  const calls = active.where("call_active", "==", true).where("last_ping_at", "<=", silent).orderBy("last_ping_at");
  await forEachPage(calls, (docs) => tally.settle(docs, "clearing call_active", (doc) => clearCallActive(db, doc.ref, silent)));

  const gone = minus(now, CALL_STOP_SILENT_MS);
  const callShares = active.where("stop_rule", "==", "call").where("last_ping_at", "<=", gone).orderBy("last_ping_at");
  await forEachPage(callShares, (docs) =>
    tally.settle(docs, "stopping a silent call share", (doc) => stopSilentCallShare(db, doc.ref, now, gone)),
  );

  tally.finish("callWatchdog");
}

export const callWatchdog = onSchedule({ schedule: "every 2 minutes", timeoutSeconds: 300 }, (event) =>
  watchCalls(getFirestore(), runTime(event)),
);
