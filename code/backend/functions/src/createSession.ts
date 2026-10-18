import { createHash, randomBytes } from "node:crypto";
import { FieldValue, getFirestore, Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/https";
import { defineString } from "firebase-functions/params";
import { requireCurrentSharer } from "./auth.js";
import {
  INITIAL_PING_INTERVAL_SECONDS,
  LINK_TOKEN_BITS,
  LINK_TOKEN_LENGTH,
  SESSION_LIMIT_MS,
  SHARE_LINK_PATH,
  isRecord,
  parseCreateSessionRequest,
  sharerSnapshotFrom,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type SessionPrivateMeta,
  type ShareSession,
} from "./contracts.js";
import { dueEnd, endFields, forcedEnd, type SessionEnd } from "./sessions/end.js";
import { sessionDocFrom } from "./sessions/read.js";
import { runContended } from "./sessions/transactions.js";
import { checkedViewerOrigin } from "./viewerOrigin.js";
import { docPaths, type CallLog } from "./shared/schema.js";

/**
 * Where the viewer page is served, e.g. https://trackmelive.web.app. Set per
 * project in functions/.env.<projectId>; the demo project points at the
 * viewer's Vite dev server (checkedViewerOrigin keeps that off real projects).
 */
const VIEWER_ORIGIN = defineString("VIEWER_ORIGIN", {
  description: "Origin of the viewer page; share links are <origin>/s/<token>.",
});

/** 128 random bits, base64url: 22 characters (shared LinkToken). */
export function newLinkToken(): string {
  const token = randomBytes(LINK_TOKEN_BITS / 8).toString("base64url");
  if (token.length !== LINK_TOKEN_LENGTH) throw new Error("unexpected link token length");
  return token;
}

/** SHA-256, lowercase hex: what private/meta.link_token_hash stores. */
export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** stop_at: now plus the minutes, capped at expires_at; expires_at for the limit; null for the call. */
export function stopAtFor(req: Pick<CreateSessionRequest, "stop_rule" | "stop_minutes">, startedAtMs: number, expiresAtMs: number): number | null {
  switch (req.stop_rule) {
    case "call":
      return null;
    case "limit":
      return expiresAtMs;
    case "minutes":
      return Math.min(startedAtMs + (req.stop_minutes ?? 0) * 60_000, expiresAtMs);
  }
}

function viewerOrigin(): string {
  try {
    return checkedViewerOrigin(VIEWER_ORIGIN.value(), process.env.GCLOUD_PROJECT ?? "");
  } catch (error) {
    logger.error("VIEWER_ORIGIN can't be used", { value: VIEWER_ORIGIN.value(), error: String(error) });
    throw new HttpsError("internal", "Sharing isn't available right now.");
  }
}

/**
 * Starts a share (FSD §4 "Live map link", "Manual sharing", §5, §6).
 *
 * In one transaction:
 *  - checks users/{uid}.active_session_id: only one session runs at a time.
 *    A pointer at a session that is already over doesn't block. One that is
 *    stopped or gone is simply replaced; one still marked active but past
 *    stop_at or expires_at is ended here, as timer or limit at that time, so
 *    its end isn't left to the next stop-job run (x-decisions Q-SESSION-END).
 *    One that doesn't match the shared schema is never left active either: it
 *    is ended from its raw fields and logged (x-decisions Q-MALFORMED-SESSION);
 *  - creates shareSessions/{id} (only what the viewer may see) and
 *    shareSessions/{id}/private/meta (sharer-only), plus callLogs/{id} for a
 *    call-triggered share (x-decisions Q-CALLLOG-ID);
 *  - points users/{uid}.active_session_id at the new session, and remembers
 *    "who it's for" in last_viewer_name when a name is given.
 * The owner is the caller's uid; the request can't name one.
 *
 * Sprint 1 TODO: App Check.
 */
export const createSession = onCall<unknown, Promise<CreateSessionResponse>>(async (request) => {
  // Only a phone-number sharer whose account still exists starts a share; a
  // viewer's one-session custom sign-in never does.
  const uid = await requireCurrentSharer(request.auth);

  const parsed = parseCreateSessionRequest(request.data);
  if (!parsed.ok) {
    throw new HttpsError("invalid-argument", "The share request isn't valid.", { errors: parsed.errors });
  }
  const input = parsed.value;
  const origin = viewerOrigin();

  const db = getFirestore();
  const userRef = db.doc(`users/${uid}`);
  const sessionRef = db.collection("shareSessions").doc();
  const metaRef = sessionRef.collection("private").doc("meta");
  const linkToken = newLinkToken();

  const times = await runContended(db, "createSession", async (tx) => {
    const userSnap = await tx.get(userRef);
    const profile = userSnap.data();
    const sharer = isRecord(profile) ? sharerSnapshotFrom(profile) : null;
    if (!isRecord(profile) || !sharer) {
      throw new HttpsError("failed-precondition", "Finish signing up before sharing.", { reason: "no_profile" });
    }

    const startedAtMs = Date.now();
    const startedAt = Timestamp.fromMillis(startedAtMs);

    // One session at a time; a session that is over doesn't block (above).
    let overdue: { ref: DocumentReference; end: SessionEnd; malformed: boolean } | null = null;
    const activeId = profile.active_session_id;
    if (typeof activeId === "string" && activeId.length > 0) {
      const activeRef = db.doc(docPaths.shareSession(activeId));
      const active = sessionDocFrom(await tx.get(activeRef));
      if (active.state === "valid" && active.session.status === "active") {
        const end = dueEnd(active.session, startedAt);
        if (!end) {
          throw new HttpsError("already-exists", "You're already sharing.", { reason: "active_session", session_id: activeId });
        }
        overdue = { ref: activeRef, end, malformed: false };
      } else if (active.state === "malformed" && active.raw.status !== "stopped") {
        overdue = { ref: activeRef, end: forcedEnd(active.raw, startedAt), malformed: true };
      }
    }

    const expiresAtMs = startedAtMs + SESSION_LIMIT_MS;
    const stopAtMs = stopAtFor(input, startedAtMs, expiresAtMs);

    const session: ShareSession<Timestamp> = {
      status: "active",
      started_at: startedAt,
      expires_at: Timestamp.fromMillis(expiresAtMs),
      stop_rule: input.stop_rule,
      stop_minutes: input.stop_minutes,
      stop_at: stopAtMs === null ? null : Timestamp.fromMillis(stopAtMs),
      ended_at: null,
      end_reason: null,
      call_id: input.call_id,
      call_active: input.call_id !== null,
      call_ended_at: null,
      share_back_allowed: input.share_back_allowed,
      // The check-in clock starts now, so the watchdog doesn't clear call_active
      // before the app's first ping.
      last_ping_at: startedAt,
      // No ping yet; each ping's batch sets it (x-decisions Q-PING-WRITE).
      last_fix_at: null,
      ping_interval_s: INITIAL_PING_INTERVAL_SECONDS,
      precision: input.precision,
      precision_next: null,
      sharer,
      first_viewed_at: null,
      viewer_sharing: false,
      share_back_requested_at: null,
      cleaned_at: null,
      // No lookup yet; the sharer's phone writes it (x-decisions Q-PLACE).
      place: null,
    };
    const meta: SessionPrivateMeta = {
      user_id: uid,
      link_token_hash: hashLinkToken(linkToken),
      viewer_uid: null,
      viewer_name: input.viewer_name ?? null,
      activity_push_token: null,
    };

    if (overdue) tx.update(overdue.ref, endFields(overdue.end));
    tx.create(sessionRef, session);
    tx.create(metaRef, meta);
    if (input.call_id !== null) {
      const callLog: CallLog<FieldValue> = {
        user_id: uid,
        session_id: sessionRef.id,
        call_id: input.call_id,
        call_time: FieldValue.serverTimestamp(),
      };
      tx.create(db.doc(docPaths.callLog(sessionRef.id)), callLog);
    }
    tx.update(userRef, {
      active_session_id: sessionRef.id,
      updated_at: FieldValue.serverTimestamp(),
      ...(input.viewer_name ? { last_viewer_name: input.viewer_name } : {}),
    });
    const ended = overdue && { session_id: overdue.ref.id, end_reason: overdue.end.reason, malformed: overdue.malformed };
    return { startedAtMs, expiresAtMs, ended };
  });

  if (times.ended?.malformed) logger.error("force-ended a session that doesn't match the shared schema", times.ended);
  else if (times.ended) logger.info("overdue session ended", times.ended);
  logger.info("session created", {
    session_id: sessionRef.id,
    stop_rule: input.stop_rule,
    on_call: input.call_id !== null,
  });

  return {
    session_id: sessionRef.id,
    link_token: linkToken,
    link_url: `${origin}${SHARE_LINK_PATH}${linkToken}`,
    started_at: times.startedAtMs,
    expires_at: times.expiresAtMs,
  };
});
