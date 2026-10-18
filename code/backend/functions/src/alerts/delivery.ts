/**
 * Sending an alert once per session, however often its trigger runs
 * (x-decisions Q-ALERT-ONCE). Triggers are delivered at least once and retried
 * on failure, so each alert has a function-only marker,
 * shareSessions/{sessionId}/alerts/{kind}:
 *  1. Claim, in a transaction: a marker that is sent or skipped means a
 *     duplicate, so nothing is sent. One held by another attempt (lease_until
 *     in the future) is busy, and the trigger retries later. Otherwise this
 *     attempt takes the lease and goes on with the devices not yet reached.
 *  2. Send to the user's devices (users/{userId}/devices), each token once.
 *  3. Prune: a device whose token stopped working is deleted, unless the app
 *     rewrote it meanwhile (FSD §8 Retention).
 *  4. Finish, in a transaction: record the devices FCM accepted. With nothing
 *     left to retry it's sent; otherwise the lease is let go and the attempt
 *     throws, so the trigger retries for the rest.
 * The claim and the finish read users/{userId}. deleteAccount deletes that doc
 * before it lists a session's subcollections, so a marker is never left behind
 * under an account being deleted; the finish deletes it when the session or
 * the account is already gone.
 */
import { FieldValue, Timestamp, type DocumentSnapshot, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { unlessGoneOrChanged } from "../jobs/run.js";
import { readSession, sessionRefs, type Session } from "../sessions/read.js";
import {
  collectionPaths,
  docPaths,
  validate,
  type AlertDelivery,
  type AlertKind,
  type Device,
  type SessionPrivateMeta,
  type User,
  type UserSettings,
} from "../shared/schema.js";
import { alertMessage, type Alert } from "./message.js";
import { failureKind, type PushResult, type PushSender } from "./push.js";

export interface AlertDeps {
  db: Firestore;
  sender: PushSender;
  /** Epoch ms. */
  now: () => number;
}

/**
 * How long an attempt holds an alert. Longer than the trigger's 60-second
 * timeout, so an attempt that dies mid-send always lets go of it.
 */
export const LEASE_MS = 90_000;

// ---------- The marker ----------

/** The marker states (the shared AlertDelivery.state). */
export type AlertState = "sending" | "sent" | "skipped";

/** shareSessions/{sessionId}/alerts/{kind}, as the Admin SDK reads it. */
export type Marker = AlertDelivery<Timestamp> & { state: AlertState };

const isMarker = (v: unknown): v is Marker => validate("AlertDelivery", v).length === 0;

/** The decision a claim makes from the marker as it stands. */
export type Claim =
  | { action: "send"; delivered: readonly string[]; attempt: number }
  | { action: "done" }
  | { action: "busy" };

/** The marker as read: none yet, a valid one, or one that doesn't match AlertDelivery (only a bug writes that). */
export type MarkerRead = Marker | null | "malformed";

/**
 * No marker: the first attempt. Sent or skipped: a duplicate. Sending with its
 * lease still running: another attempt is on it. Sending with the lease run
 * out: that attempt failed or died, so this one takes over and skips the
 * devices already reached. A malformed marker counts as sent: a missed alert
 * is better than repeated ones.
 */
export function claimFrom(marker: MarkerRead, nowMs: number): Claim {
  if (marker === null) return { action: "send", delivered: [], attempt: 1 };
  if (marker === "malformed" || marker.state !== "sending") return { action: "done" };
  if (marker.lease_until.toMillis() > nowMs) return { action: "busy" };
  return { action: "send", delivered: marker.delivered, attempt: marker.attempts + 1 };
}

// ---------- Kinds ----------

/** What an alert kind decides from the session, read in the claim. */
export interface AlertContext {
  sessionId: string;
  session: Session;
  meta: SessionPrivateMeta;
  nowMs: number;
}

/** An alert that doesn't apply (now or ever): nothing is sent or recorded. */
export type NotDue = "not_opened" | "session_over";

export interface AlertSpec {
  kind: AlertKind;
  /** The user's switch for it in Settings (FSD §4 Settings). Off is recorded, so turning it on later doesn't send a stale alert. */
  setting: keyof Pick<UserSettings, "alert_link_opened" | "alert_call_ended" | "alert_expiry">;
  compose(ctx: AlertContext): Alert | NotDue;
}

// ---------- Delivery ----------

export type SkipReason = NotDue | "session_gone" | "no_profile" | "setting_off";

export type DeliveryOutcome =
  | { outcome: "sent"; attempt: number; devices: number; delivered: number; pruned: number; failed: number }
  | { outcome: "duplicate" }
  | { outcome: "skipped"; reason: SkipReason };

/** Thrown so the trigger runs again: another attempt holds the alert, or some devices are due a retry. */
export class AlertRetryError extends Error {
  override name = "AlertRetryError";
}

type Claimed =
  | { outcome: "claimed"; alert: Alert; userId: string; delivered: readonly string[]; attempt: number }
  | { outcome: "busy" }
  | Exclude<DeliveryOutcome, { outcome: "sent" }>;

const isUser = (v: unknown): v is User<Timestamp> => validate("User", v).length === 0;
const isDevice = (v: unknown): v is Device<Timestamp> => validate("Device", v).length === 0;

function markerFrom(snap: DocumentSnapshot): MarkerRead {
  if (!snap.exists) return null;
  const data: unknown = snap.data();
  if (isMarker(data)) return data;
  logger.error("alert marker doesn't match AlertDelivery; not sending", { path: snap.ref.path, issues: validate("AlertDelivery", data) });
  return "malformed";
}

async function claim(deps: AlertDeps, spec: AlertSpec, sessionId: string): Promise<Claimed> {
  const { db } = deps;
  const refs = sessionRefs(db, sessionId);
  const markerRef = db.doc(docPaths.alertDelivery(sessionId, spec.kind));
  return db.runTransaction<Claimed>(async (tx) => {
    const nowMs = deps.now();
    const read = await readSession(tx, refs);
    const markerSnap = await tx.get(markerRef);
    const decision = claimFrom(markerFrom(markerSnap), nowMs);
    if (decision.action === "done") return { outcome: "duplicate" };
    if (decision.action === "busy") return { outcome: "busy" };
    if (!read?.meta) return { outcome: "skipped", reason: "session_gone" };

    const userId = read.meta.user_id;
    const user: unknown = (await tx.get(db.doc(docPaths.user(userId)))).data();
    if (!isUser(user)) return { outcome: "skipped", reason: "no_profile" };

    const lease = { lease_until: Timestamp.fromMillis(nowMs + LEASE_MS), updated_at: FieldValue.serverTimestamp() };
    const created = markerSnap.exists ? {} : { kind: spec.kind, created_at: FieldValue.serverTimestamp() };
    const write = (state: AlertState) =>
      tx.set(markerRef, { ...created, ...lease, state, delivered: [...decision.delivered], attempts: decision.attempt }, { merge: true });

    if (!user.settings[spec.setting]) {
      write("skipped");
      return { outcome: "skipped", reason: "setting_off" };
    }
    const alert = spec.compose({ sessionId, session: read.session, meta: read.meta, nowMs });
    if (typeof alert === "string") return { outcome: "skipped", reason: alert };
    write("sending");
    return { outcome: "claimed", alert, userId, delivered: decision.delivered, attempt: decision.attempt };
  });
}

/** How each device's send went. */
export interface Sorted {
  delivered: string[];
  gone: string[];
  retry: string[];
  failed: { deviceId: string; code: string }[];
}

/** Sorts one result per device id, in order; a missing result is retried. */
export function sortResults(deviceIds: readonly string[], results: readonly PushResult[]): Sorted {
  const sorted: Sorted = { delivered: [], gone: [], retry: [], failed: [] };
  deviceIds.forEach((deviceId, i) => {
    const r = results[i] ?? { ok: false, code: "messaging/unknown-error", message: "no result" };
    if (r.ok) {
      sorted.delivered.push(deviceId);
      return;
    }
    const kind = failureKind(r.code);
    if (kind === "failed") sorted.failed.push({ deviceId, code: r.code });
    else sorted[kind].push(deviceId);
  });
  return sorted;
}

/**
 * Deletes a device whose token stopped working, unless the doc changed since
 * it was read: the app rewrote it with a fresh token, which must stay. True
 * when it was deleted.
 */
function prune(device: QueryDocumentSnapshot): Promise<boolean> {
  return unlessGoneOrChanged(device.ref.delete({ lastUpdateTime: device.updateTime }));
}

/**
 * Records what this attempt delivered. done: nothing is left to retry, so the
 * alert is sent; otherwise the lease is let go so the retry can start at once.
 * When the session or the account is gone, the marker goes too.
 */
async function finish(deps: AlertDeps, sessionId: string, kind: AlertKind, delivered: readonly string[], done: boolean): Promise<void> {
  const { db } = deps;
  const refs = sessionRefs(db, sessionId);
  const markerRef = db.doc(docPaths.alertDelivery(sessionId, kind));
  await db.runTransaction(async (tx) => {
    const [sessionSnap, metaSnap, markerSnap] = await tx.getAll(refs.session, refs.meta, markerRef);
    const userId: unknown = metaSnap?.get("user_id");
    const userSnap = typeof userId === "string" ? await tx.get(db.doc(docPaths.user(userId))) : null;
    if (!markerSnap?.exists) return;
    if (!sessionSnap?.exists || !userSnap?.exists) {
      tx.delete(markerRef);
      return;
    }
    const before: unknown = markerSnap.get("delivered");
    const already = Array.isArray(before) ? before.filter((id): id is string => typeof id === "string") : [];
    tx.update(markerRef, {
      delivered: [...new Set([...already, ...delivered])],
      state: done ? "sent" : "sending",
      ...(done ? {} : { lease_until: Timestamp.fromMillis(deps.now()) }),
      updated_at: FieldValue.serverTimestamp(),
    });
  });
}

/** The user's devices that are valid Device docs; a malformed one is logged and left out. */
async function devicesOf(db: Firestore, userId: string): Promise<{ snap: QueryDocumentSnapshot; device: Device<Timestamp> }[]> {
  const docs = (await db.collection(collectionPaths.device(userId)).get()).docs;
  return docs.flatMap((snap) => {
    const device: unknown = snap.data();
    if (isDevice(device)) return [{ snap, device }];
    logger.warn("device doc doesn't match the shared schema; skipped", { path: snap.ref.path, issues: validate("Device", device) });
    return [];
  });
}

/** What one attempt did with the devices it had. */
interface Sent {
  devices: number;
  sorted: Sorted;
  pruned: number;
}

/** Sends to the user's devices not yet reached, and deletes those whose tokens stopped working. */
async function sendToDevices(deps: AlertDeps, alert: Alert, userId: string, already: ReadonlySet<string>, progress: { delivered: string[] }): Promise<Sent> {
  const devices = (await devicesOf(deps.db, userId)).filter((d) => !already.has(d.snap.id));
  const nowMs = deps.now();
  const results = devices.length > 0 ? await deps.sender.send(devices.map((d) => alertMessage(alert, d.device.push_token, nowMs))) : [];
  const sorted = sortResults(devices.map((d) => d.snap.id), results);
  progress.delivered = sorted.delivered;
  const gone = new Set(sorted.gone);
  const pruned = (await Promise.all(devices.filter((d) => gone.has(d.snap.id)).map((d) => prune(d.snap)))).filter(Boolean).length;
  return { devices: devices.length, sorted, pruned };
}

/**
 * Sends one alert kind for a session, once (see the top of this file).
 * Resolves with what happened. Throws AlertRetryError when the trigger should
 * run again; any other error (Firestore, or FCM unreachable) is passed on
 * after letting go of the lease and recording any devices already reached.
 */
export async function deliverAlert(deps: AlertDeps, spec: AlertSpec, sessionId: string): Promise<DeliveryOutcome> {
  const claimed = await claim(deps, spec, sessionId);
  if (claimed.outcome === "busy") throw new AlertRetryError(`${spec.kind} for ${sessionId} is being sent by another attempt`);
  if (claimed.outcome !== "claimed") return claimed;
  const { alert, userId, attempt } = claimed;

  const progress = { delivered: [] as string[] };
  let sent: Sent;
  try {
    sent = await sendToDevices(deps, alert, userId, new Set(claimed.delivered), progress);
  } catch (error) {
    await finish(deps, sessionId, spec.kind, progress.delivered, false).catch((releaseError: unknown) =>
      logger.error("couldn't let go of the alert lease; it runs out by itself", { session_id: sessionId, error: String(releaseError) }),
    );
    throw error;
  }
  const { devices, sorted, pruned } = sent;
  await finish(deps, sessionId, spec.kind, sorted.delivered, sorted.retry.length === 0);

  const log = {
    session_id: sessionId, kind: spec.kind, sender: deps.sender.name, attempt, devices,
    delivered: sorted.delivered.length, pruned, retry: sorted.retry.length, failed: sorted.failed,
  };
  if (sorted.failed.length > 0) logger.error("alert failed for some devices", log);
  if (sorted.retry.length > 0) {
    logger.warn("alert to retry for some devices", log);
    throw new AlertRetryError(`${spec.kind} for ${sessionId}: ${sorted.retry.length} devices to retry`);
  }
  logger.info("alert sent", log);
  return { outcome: "sent", attempt, devices, delivered: sorted.delivered.length, pruned, failed: sorted.failed.length };
}
