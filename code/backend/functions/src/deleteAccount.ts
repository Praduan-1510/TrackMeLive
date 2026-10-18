import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, Timestamp, type BulkWriter, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/https";
import { requireSharer } from "./auth.js";
import { fieldErrors } from "./requestErrors.js";
import { sessionsOwnedBy } from "./sessionLookup.js";
import { authDeleter, deleteViewerUsers } from "./sessions/deletion.js";
import { endSession, sharerStop } from "./sessions/end.js";
import { readSession, sessionRefs } from "./sessions/read.js";
import { collectionPaths, docPaths, validate, type DeleteAccountResponse } from "./shared/schema.js";

/**
 * Ends each of these sessions that is still active, as the sharer's Stop does
 * (end_reason stopped, or timer or limit if it was already due), so a viewer
 * page that's open sees it end before it disappears.
 */
async function stopLiveSessions(db: Firestore, uid: string, sessions: readonly DocumentReference[]): Promise<void> {
  if (sessions.length === 0) return;
  const live = (await db.getAll(...sessions)).filter((snap) => snap.get("status") === "active");
  await Promise.all(live.map(({ ref }) => db.runTransaction(async (tx) => {
    const read = await readSession(tx, sessionRefs(db, ref.id));
    if (read?.session.status !== "active") return;
    await endSession(tx, ref, uid, sharerStop(read.session, Timestamp.now()));
  })));
}

/**
 * Deletes the sessions and everything under them. The order makes a failed
 * run safe to repeat:
 *  1. the viewer Auth users, while viewerSignIns still records them;
 *  2. every subcollection except private, then the session docs;
 *  3. private/meta last, because it's how the next run finds the session by
 *     its owner.
 */
async function deleteSessions(db: Firestore, auth: Auth, writer: BulkWriter, sessions: readonly DocumentReference[]): Promise<void> {
  await deleteViewerUsers(authDeleter(auth), sessions);

  await Promise.all(sessions.map(async (session) => {
    const collections = await session.listCollections();
    await Promise.all(collections.filter((c) => c.id !== "private").map((c) => db.recursiveDelete(c, writer)));
  }));
  const sessionDocs = sessions.map((session) => writer.delete(session));
  await writer.flush();
  await Promise.all(sessionDocs);

  await Promise.all(sessions.map((session) => db.recursiveDelete(session.collection("private"), writer)));
}

/** The caller's callLogs entries: one per call share, keyed by session id, found by user_id. */
async function deleteCallLogs(db: Firestore, writer: BulkWriter, uid: string): Promise<void> {
  const logs = await db.collection(collectionPaths.callLog()).where("user_id", "==", uid).get();
  const deletes = logs.docs.map((doc) => writer.delete(doc.ref));
  await writer.flush();
  await Promise.all(deletes);
}

/** Steps 1–4 below: everything in Firestore, and the viewer Auth users. Returns how many sessions it deleted. */
async function deleteData(db: Firestore, auth: Auth, uid: string): Promise<number> {
  await stopLiveSessions(db, uid, await sessionsOwnedBy(db, uid));
  const writer = db.bulkWriter();
  try {
    await db.recursiveDelete(db.doc(docPaths.user(uid)), writer);
    const sessions = await sessionsOwnedBy(db, uid);
    await deleteSessions(db, auth, writer, sessions);
    await deleteCallLogs(db, writer, uid);
    return sessions.length;
  } finally {
    await writer.close();
  }
}

/** How long a re-sweep that found a late write waits for any other in-flight save before sweeping again. */
const RESWEEP_WAIT_MS = 1000;

/** Deletes users/{uid} and everything under it; true when anything was there. */
async function deleteProfile(db: Firestore, uid: string): Promise<boolean> {
  const ref = db.doc(docPaths.user(uid));
  const [snap, collections] = await Promise.all([ref.get(), ref.listCollections()]);
  if (!snap.exists && collections.length === 0) return false;
  await db.recursiveDelete(ref);
  return true;
}

/**
 * Step 4b: a save whose check passed just before the lock-out can still commit
 * after step 2 deleted the profile. Once the account is locked out, no new save
 * can start and one in flight commits within milliseconds. So the profile and
 * its devices are deleted again, and if that found anything, again after a
 * second, in case another save was still in flight.
 */
async function resweepProfile(db: Firestore, uid: string): Promise<void> {
  for (let pass = 1; pass <= 2; pass++) {
    if (!(await deleteProfile(db, uid))) return;
    logger.warn("deleteAccount re-sweep removed a profile written during the deletion", { uid, pass });
    if (pass === 1) await new Promise((resolve) => setTimeout(resolve, RESWEEP_WAIT_MS));
  }
}

const isUserNotFound = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "auth/user-not-found";

/**
 * Step 0: locks the account out before anything is deleted. A disabled user's
 * ID tokens fail requireCurrentSharer at once, so no saveProfile or
 * createSession (from a second phone, or a Settings toggle) can write while
 * the deletion runs. Revoking also stops its refresh tokens from minting new
 * ID tokens. The ID token this call came with still passes the plain check
 * deleteAccount uses, so a repeat call can finish. An Auth user that's already
 * gone needs neither step.
 */
async function lockOut(auth: Auth, uid: string): Promise<void> {
  try {
    await auth.updateUser(uid, { disabled: true });
    await auth.revokeRefreshTokens(uid);
  } catch (error) {
    if (!isUserNotFound(error)) throw error;
  }
}

/**
 * The caller's Auth user. One that's already gone counts as deleted. This is
 * deleteUser, not the batch deleteUsers the viewer sign-ins go through, so the
 * two don't share the batch call's one-a-second limit.
 */
async function deleteSignIn(auth: Auth, uid: string): Promise<void> {
  try {
    await auth.deleteUser(uid);
  } catch (error) {
    if (!isUserNotFound(error)) throw error;
  }
}

/**
 * Settings › Delete account and all data (FSD §4 "Settings", §8 "Deletion"):
 * "deleting stops any active session and deletes everything at once,
 * overriding the 30-day retention".
 *
 * In order:
 *  0. Locks the account out: disables the Auth user and revokes its refresh
 *     tokens, so every other sharer callable refuses it from here on.
 *  1. Stops the caller's live sessions, as Stop does.
 *  2. Deletes users/{uid} with its devices. With no profile, no new share can
 *     start (createSession needs one).
 *  3. Deletes every session the caller owns, found again so one started during
 *     step 1 isn't missed: its viewer Auth users, pings, viewerPings,
 *     viewerSignIns, the session doc and private/meta.
 *  4. Deletes the caller's callLogs, then sweeps the profile again for a save
 *     that was in flight at the lock-out.
 *  5. Deletes the caller's Auth user, last, so a run that fails earlier can be
 *     repeated with the same sign-in.
 * Every step finds what's left rather than what was there, so the call is
 * idempotent: repeating it finishes a run that failed and does nothing after
 * one that worked. Deletes go through a BulkWriter in batches.
 *
 * Returns {sessions_deleted}. Errors: unauthenticated, permission-denied (not a
 * phone sign-in), invalid-argument for any field sent.
 */
export const deleteAccount = onCall<unknown, Promise<DeleteAccountResponse>>(async (request) => {
  const uid = requireSharer(request.auth);
  const issues = validate("DeleteAccountRequest", request.data ?? {});
  if (issues.length > 0) {
    throw new HttpsError("invalid-argument", "The request isn't valid.", { errors: fieldErrors(issues) });
  }

  const auth = getAuth();
  const db = getFirestore();
  await lockOut(auth, uid);
  const sessionsDeleted = await deleteData(db, auth, uid);
  await resweepProfile(db, uid);
  await deleteSignIn(auth, uid);

  logger.info("account deleted", { uid, sessions_deleted: sessionsDeleted });
  return { sessions_deleted: sessionsDeleted };
});
