import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, Timestamp, type BulkWriter, type DocumentSnapshot, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/scheduler";
import { SESSION_LIMIT_MS } from "../contracts.js";
import { METADATA_RETENTION_DAYS, PING_RETENTION_HOURS, collectionPaths, docPaths } from "../shared/schema.js";
import { authDeleter, type DeleteUsers } from "../sessions/deletion.js";
import { forEachPage, minus, runTime, Tally, unlessGoneOrChanged } from "./run.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const LOCATION_RETENTION_MS = PING_RETENTION_HOURS * HOUR_MS;
const METADATA_RETENTION_MS = METADATA_RETENTION_DAYS * DAY_MS;

/**
 * FCM treats a token unused for 270 days as expired, so a device doc not
 * rewritten in that long holds a token that has stopped working (FSD §8
 * Retention). The apps rewrite their device doc at every launch, and every
 * share starts in the app, so no device that could still get an alert is this
 * old.
 */
export const STALE_DEVICE_DAYS = 270;

/** The session id a pings, viewerPings or viewerSignIns doc sits under; null for a same-named collection anywhere else. */
function sessionIdOf(doc: QueryDocumentSnapshot): string | null {
  const session = doc.ref.parent.parent;
  return session?.parent.id === collectionPaths.shareSession() ? session.id : null;
}

/**
 * Whether a session's data may go at `cutoff`: its doc is gone, or it stopped
 * at or before `cutoff`. Read from the raw fields, so a stopped session that
 * doesn't match the shared schema still counts.
 */
function pastCutoff(snap: DocumentSnapshot, cutoff: Timestamp): boolean {
  if (!snap.exists) return true;
  const endedAt: unknown = snap.get("ended_at");
  return snap.get("status") === "stopped" && endedAt instanceof Timestamp && endedAt.toMillis() <= cutoff.toMillis();
}

/** The ids, of the sessions named, whose data may go at cutoff; each session is read once. */
async function sessionsPast(db: Firestore, ids: readonly (string | null)[], cutoff: Timestamp): Promise<Set<string>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Set();
  const snaps = await db.getAll(...unique.map((id) => db.doc(docPaths.shareSession(id))));
  return new Set(snaps.filter((snap) => pastCutoff(snap, cutoff)).map((snap) => snap.id));
}

interface Sweep {
  db: Firestore;
  writer: BulkWriter;
  deleteUsers: DeleteUsers;
  now: Timestamp;
}

/**
 * Pings and viewerPings recorded more than 25 hours ago (24 hours after the
 * end of a session that lasts at most an hour) whose session is gone or ended
 * at least 24 hours ago. A phone whose clock is behind writes old recorded_at
 * values; while its session is live, or ended under 24 hours ago, its pings
 * stay.
 */
async function sweepLocations({ db, writer, now }: Sweep, tally: Tally): Promise<void> {
  const cutoff = minus(now, LOCATION_RETENTION_MS);
  for (const group of ["pings", "viewerPings"]) {
    const old = db.collectionGroup(group).where("recorded_at", "<=", minus(cutoff, SESSION_LIMIT_MS)).orderBy("recorded_at");
    await forEachPage(old, async (docs) => {
      const due = await sessionsPast(db, docs.map(sessionIdOf), cutoff);
      const refs = docs.filter((doc) => due.has(sessionIdOf(doc) ?? "")).map((doc) => doc.ref);
      await tally.bulk(writer, refs, `deleting an old ${group} doc`, (ref) => writer.delete(ref).then(() => true));
    });
  }
}

/**
 * Viewer sign-ins created more than 25 hours ago, on the same test: the Auth
 * user first, because the doc is the only record of its uid, then the doc.
 */
async function sweepViewerSignIns({ db, writer, deleteUsers, now }: Sweep, tally: Tally): Promise<void> {
  const cutoff = minus(now, LOCATION_RETENTION_MS);
  const old = db.collectionGroup("viewerSignIns").where("created_at", "<=", minus(cutoff, SESSION_LIMIT_MS)).orderBy("created_at");
  await forEachPage(old, async (docs) => {
    const due = await sessionsPast(db, docs.map(sessionIdOf), cutoff);
    const refs = docs.filter((doc) => due.has(sessionIdOf(doc) ?? "")).map((doc) => doc.ref);
    if (refs.length === 0) return;
    try {
      await deleteUsers(refs.map((ref) => ref.id));
    } catch (error) {
      tally.failed += refs.length;
      logger.error("deleting old viewer sign-ins failed", { error: String(error) });
      return;
    }
    await tally.bulk(writer, refs, "deleting an old viewerSignIns doc", (ref) => writer.delete(ref).then(() => true));
  });
}

/**
 * callLogs whose call was seen more than 30 days and an hour ago (its session
 * ended by then), when that session is gone or ended at least 30 days ago.
 * callLogId is the session id (x-decisions Q-CALLLOG-ID).
 */
async function sweepCallLogs({ db, writer, now }: Sweep, tally: Tally): Promise<void> {
  const cutoff = minus(now, METADATA_RETENTION_MS);
  const sessionOf = (doc: QueryDocumentSnapshot): string => {
    const id: unknown = doc.get("session_id");
    return typeof id === "string" && id !== "" ? id : doc.id;
  };
  const old = db.collection(collectionPaths.callLog()).where("call_time", "<=", minus(cutoff, SESSION_LIMIT_MS)).orderBy("call_time");
  await forEachPage(old, async (docs) => {
    const due = await sessionsPast(db, docs.map(sessionOf), cutoff);
    const refs = docs.filter((doc) => due.has(sessionOf(doc))).map((doc) => doc.ref);
    await tally.bulk(writer, refs, "deleting an old callLogs doc", (ref) => writer.delete(ref).then(() => true));
  });
}

/** Device docs not rewritten for STALE_DEVICE_DAYS; one the app rewrites meanwhile stays. */
async function sweepDevices({ db, writer, now }: Sweep, tally: Tally): Promise<void> {
  const stale = db.collectionGroup("devices").where("updated_at", "<=", minus(now, STALE_DEVICE_DAYS * DAY_MS)).orderBy("updated_at");
  await forEachPage(stale, async (docs) => {
    const read = new Map(docs.map((doc) => [doc.ref.path, doc.updateTime]));
    await tally.bulk(writer, docs.map((doc) => doc.ref), "deleting a stale device", (ref) =>
      unlessGoneOrChanged(writer.delete(ref, { lastUpdateTime: read.get(ref.path) })),
    );
  });
}

const SWEEPS = { locations: sweepLocations, viewerSignIns: sweepViewerSignIns, callLogs: sweepCallLogs, devices: sweepDevices } as const;

/**
 * The retention backstop (FSD §8 Retention). cleanupEndedSessions (24 hours)
 * and purgeEndedSessions (30 days) find their work through the session docs.
 * This finds what they can't: data left under a session doc that is gone, as
 * a deletion that stopped part way can leave it (discardSession's last step, or
 * a deleteAccount run that wasn't repeated), and device tokens that stopped
 * working without a send to say so. Each sweep is idempotent and pages
 * through its query 100 docs at a time; one that fails doesn't stop the
 * others, and the run then throws so the next one retries.
 */
async function sweep(db: Firestore, auth: Auth, now: Timestamp): Promise<void> {
  const writer = db.bulkWriter();
  const ctx: Sweep = { db, writer, deleteUsers: authDeleter(auth), now };
  const counts: Record<string, { deleted: number; failed: number }> = {};
  let failed = 0;
  try {
    for (const [name, run] of Object.entries(SWEEPS)) {
      const tally = new Tally();
      try {
        await run(ctx, tally);
      } catch (error) {
        tally.failed++;
        logger.error(`sweepRetention: ${name} failed`, { error: String(error) });
      }
      counts[name] = { deleted: tally.changed, failed: tally.failed };
      failed += tally.failed;
    }
  } finally {
    await writer.close();
  }
  logger.info("sweepRetention done", counts);
  if (failed > 0) throw new Error(`sweepRetention: ${failed} failed`);
}

export const sweepRetention = onSchedule({ schedule: "every 24 hours", timeoutSeconds: 540 }, (event) =>
  sweep(getFirestore(), getAuth(), runTime(event)),
);
