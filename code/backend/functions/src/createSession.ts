import { createHash, randomBytes } from "node:crypto";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/https";
import { defineString } from "firebase-functions/params";
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

/**
 * Where the viewer page is served, e.g. https://trackmelive.web.app. Set per
 * project in functions/.env.<projectId>; the demo project points at the Hosting
 * emulator.
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
    return new URL(VIEWER_ORIGIN.value()).origin;
  } catch {
    logger.error("VIEWER_ORIGIN is not a valid URL origin", { value: VIEWER_ORIGIN.value() });
    throw new HttpsError("internal", "Sharing isn't available right now.");
  }
}

/**
 * Starts a share (FSD §4 "Live map link", "Manual sharing", §5, §6).
 *
 * In one transaction:
 *  - checks users/{uid}.active_session_id: only one session runs at a time;
 *  - creates shareSessions/{id} (only what the viewer may see) and
 *    shareSessions/{id}/private/meta (sharer-only);
 *  - points users/{uid}.active_session_id at the new session, and remembers
 *    "who it's for" in last_viewer_name when a name is given.
 * The owner is the caller's uid; the request can't name one.
 *
 * Sprint 1 TODO: App Check, and a callLogs entry for call-triggered shares.
 */
export const createSession = onCall<unknown, Promise<CreateSessionResponse>>(async (request) => {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "Sign in to share your location.");
  }
  // Viewers get a one-session custom sign-in; only phone-number sharers start shares.
  if (auth.token.firebase?.sign_in_provider !== "phone") {
    throw new HttpsError("permission-denied", "Only a signed-in sharer can start a share.");
  }

  const parsed = parseCreateSessionRequest(request.data);
  if (!parsed.ok) {
    throw new HttpsError("invalid-argument", "The share request isn't valid.", { errors: parsed.errors });
  }
  const input = parsed.value;
  const uid = auth.uid;
  const origin = viewerOrigin();

  const db = getFirestore();
  const userRef = db.doc(`users/${uid}`);
  const sessionRef = db.collection("shareSessions").doc();
  const metaRef = sessionRef.collection("private").doc("meta");
  const linkToken = newLinkToken();

  const times = await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const profile = userSnap.data();
    const sharer = isRecord(profile) ? sharerSnapshotFrom(profile) : null;
    if (!isRecord(profile) || !sharer) {
      throw new HttpsError("failed-precondition", "Finish signing up before sharing.", { reason: "no_profile" });
    }

    const startedAtMs = Date.now();

    // One session at a time. A stale pointer (the session stopped, passed its
    // limit, or is gone) doesn't block; the scheduled stop cleans those up.
    const activeId = profile.active_session_id;
    if (typeof activeId === "string" && activeId.length > 0) {
      const active = (await tx.get(db.doc(`shareSessions/${activeId}`))).data();
      const expiresAt = active?.expires_at as Timestamp | undefined;
      if (active?.status === "active" && expiresAt instanceof Timestamp && expiresAt.toMillis() > startedAtMs) {
        throw new HttpsError("already-exists", "You're already sharing.", { reason: "active_session", session_id: activeId });
      }
    }

    const expiresAtMs = startedAtMs + SESSION_LIMIT_MS;
    const stopAtMs = stopAtFor(input, startedAtMs, expiresAtMs);
    const startedAt = Timestamp.fromMillis(startedAtMs);

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
      ping_interval_s: INITIAL_PING_INTERVAL_SECONDS,
      precision: input.precision,
      precision_next: null,
      sharer,
      first_viewed_at: null,
      viewer_sharing: false,
      share_back_requested_at: null,
    };
    const meta: SessionPrivateMeta = {
      user_id: uid,
      link_token_hash: hashLinkToken(linkToken),
      viewer_uid: null,
      viewer_name: input.viewer_name ?? null,
      activity_push_token: null,
    };

    tx.create(sessionRef, session);
    tx.create(metaRef, meta);
    tx.update(userRef, {
      active_session_id: sessionRef.id,
      updated_at: FieldValue.serverTimestamp(),
      ...(input.viewer_name ? { last_viewer_name: input.viewer_name } : {}),
    });
    return { startedAtMs, expiresAtMs };
  });

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
