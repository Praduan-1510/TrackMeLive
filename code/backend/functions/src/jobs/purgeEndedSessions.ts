import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore, type Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/scheduler";
import { METADATA_RETENTION_DAYS, collectionPaths, docPaths } from "../shared/schema.js";
import { authDeleter, deleteViewerUsers } from "../sessions/deletion.js";
import { forEachPage, minus, runTime } from "./run.js";

const RETENTION_MS = METADATA_RETENTION_DAYS * 86_400_000;

/**
 * 30 days after a session ends, deletes it: the session doc, private/meta,
 * anything else under it, and its callLogs entry (FSD §8 Retention). It also
 * deletes any viewer Auth user the 24-hour pass didn't get to. Deleted
 * sessions no longer match, so a repeat run only does what's left.
 */
async function purge(db: Firestore, auth: Auth, now: Timestamp): Promise<void> {
  const ended = db.collection(collectionPaths.shareSession())
    .where("status", "==", "stopped")
    .where("ended_at", "<=", minus(now, RETENTION_MS))
    .orderBy("ended_at");

  const writer = db.bulkWriter();
  const deleteUsers = authDeleter(auth);
  let sessions = 0;
  try {
    await forEachPage(ended, async (docs) => {
      const refs = docs.map((doc) => doc.ref);
      await deleteViewerUsers(deleteUsers, refs);
      const callLogs = Promise.all(refs.map((ref) => writer.delete(db.doc(docPaths.callLog(ref.id)))));
      await Promise.all(refs.map((ref) => db.recursiveDelete(ref, writer)));
      await writer.flush();
      await callLogs;
      sessions += docs.length;
    });
  } finally {
    await writer.close();
  }
  logger.info("purgeEndedSessions done", { sessions });
}

export const purgeEndedSessions = onSchedule({ schedule: "every 60 minutes", timeoutSeconds: 540 }, (event) =>
  purge(getFirestore(), getAuth(), runTime(event)),
);
