import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore, type Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/scheduler";
import { PING_RETENTION_HOURS, collectionPaths } from "../shared/schema.js";
import { authDeleter, deleteLocations } from "../sessions/deletion.js";
import { forEachPage, minus, runTime } from "./run.js";

const RETENTION_MS = PING_RETENTION_HOURS * 3_600_000;

/**
 * 24 hours after a session ends, deletes its pings and viewerPings, and the
 * Auth users its viewer pages signed in as (FSD §6, §8 Retention; decided
 * Oct 18). It takes every stopped session whose cleaned_at is still null and
 * whose ended_at is at least 24 hours old, so a session ended late, with
 * ended_at set back to when it was due, is cleaned on the next run
 * (x-decisions Q-CLEANUP-MARK). cleaned_at is set only after a session's data
 * is gone; a failed run leaves it null, and every step is safe to repeat.
 */
async function cleanUp(db: Firestore, auth: Auth, now: Timestamp): Promise<void> {
  const due = db.collection(collectionPaths.shareSession())
    .where("status", "==", "stopped")
    .where("cleaned_at", "==", null)
    .where("ended_at", "<=", minus(now, RETENTION_MS))
    .orderBy("ended_at");

  const writer = db.bulkWriter();
  const deleteUsers = authDeleter(auth);
  let sessions = 0;
  try {
    await forEachPage(due, async (docs) => {
      const refs = docs.map((doc) => doc.ref);
      await deleteLocations(db, deleteUsers, writer, refs);
      const marks = Promise.all(refs.map((ref) => writer.update(ref, { cleaned_at: now })));
      await writer.flush();
      await marks;
      sessions += docs.length;
    });
  } finally {
    await writer.close();
  }
  logger.info("cleanupEndedSessions done", { sessions });
}

export const cleanupEndedSessions = onSchedule({ schedule: "every 15 minutes", timeoutSeconds: 540 }, (event) =>
  cleanUp(getFirestore(), getAuth(), runTime(event)),
);
