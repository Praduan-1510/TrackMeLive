/**
 * Deleting what an ended session leaves behind (FSD §8 Retention): the viewer
 * and watcher Auth users (one per browser, recorded in viewerSignIns by
 * redeemLinkToken), and the session's subcollections.
 */
import type { Auth } from "firebase-admin/auth";
import type { BulkWriter, DocumentReference, Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { collectionPaths } from "../shared/schema.js";

/** deleteUsers takes at most 1000 uids a call, and Auth allows about one call a second. */
const DELETE_USERS_MAX = 1000;
const DELETE_USERS_GAP_MS = 1000;

export type DeleteUsers = (uids: readonly string[]) => Promise<void>;

/**
 * deleteUsers for one job run, spaced at least a second apart. Users that are
 * already gone count as deleted (deleteUsers is idempotent); any other failure
 * throws, so the run fails and the next one tries again.
 */
export function authDeleter(auth: Auth): DeleteUsers {
  let lastCall = 0;
  return async (uids) => {
    for (let i = 0; i < uids.length; i += DELETE_USERS_MAX) {
      const wait = lastCall + DELETE_USERS_GAP_MS - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      lastCall = Date.now();
      const chunk = uids.slice(i, i + DELETE_USERS_MAX);
      const result = await auth.deleteUsers([...chunk]);
      if (result.failureCount > 0) {
        logger.error("deleting viewer sign-ins failed", {
          errors: result.errors.map((e) => ({ uid: chunk[e.index], message: e.error.message })),
        });
        throw new Error(`${result.failureCount} viewer sign-ins weren't deleted`);
      }
    }
  };
}

/**
 * Deletes the Auth users these sessions' viewer pages signed in as. Auth goes
 * first, because the viewerSignIns docs are the only record of those uids;
 * the docs go with the session's other data.
 */
export async function deleteViewerUsers(deleteUsers: DeleteUsers, sessions: readonly DocumentReference[]): Promise<void> {
  const signIns = await Promise.all(sessions.map((s) => s.collection("viewerSignIns").listDocuments()));
  await deleteUsers(signIns.flat().map((ref) => ref.id));
}

/**
 * The 24-hour pass: the viewer Auth users, then pings, viewerPings and
 * viewerSignIns. The session doc and private/meta stay for the 30-day purge.
 */
export async function deleteLocations(
  db: Firestore,
  deleteUsers: DeleteUsers,
  writer: BulkWriter,
  sessions: readonly DocumentReference[],
): Promise<void> {
  await deleteViewerUsers(deleteUsers, sessions);
  const collections = sessions.flatMap((s) => [
    collectionPaths.ping(s.id),
    collectionPaths.viewerPing(s.id),
    collectionPaths.viewerSignIn(s.id),
  ]);
  await Promise.all(collections.map((path) => db.recursiveDelete(db.collection(path), writer)));
}
