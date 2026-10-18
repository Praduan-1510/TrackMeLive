/**
 * Viewer sign-ins: one Firebase Auth user per browser, scoped to one session
 * (FSD §5, §6 "Viewer access"; x-decisions Q-VIEWER-SIGNIN, Q-VIEWER-ROLE).
 *
 * redeemLinkToken mints a custom token per browser with the claims {sid, role}.
 * The Auth user is created when the page signs in with that token. Each uid is
 * also recorded in shareSessions/{sid}/viewerSignIns, so the session's cleanup
 * can delete every viewer and watcher sign-in (FSD §8 "Retention").
 */
import { randomBytes } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import type { ViewerClaims } from "./shared/schema.js";

/** 96 random bits per browser: unguessable, and short enough to read in logs. */
const VIEWER_UID_RANDOM_BYTES = 12;

/**
 * A new browser's uid: "v_<sessionId>_<random>". The prefix tells viewer
 * sign-ins apart from sharers in the Auth console, and the session id names
 * the session they belong to.
 */
export function newViewerUid(sessionId: string): string {
  return `v_${sessionId}_${randomBytes(VIEWER_UID_RANDOM_BYTES).toString("base64url")}`;
}

/** A custom token for signInWithCustomToken, carrying exactly {sid, role}. */
export function mintViewerToken(uid: string, claims: ViewerClaims): Promise<string> {
  return getAuth().createCustomToken(uid, { sid: claims.sid, role: claims.role });
}
