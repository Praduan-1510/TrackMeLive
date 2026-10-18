import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/https";
import { viewerSignInOf } from "./auth.js";
import { mintViewerToken, newViewerUid } from "./authViewer.js";
import { isRecord, type FieldError } from "./contracts.js";
import { sessionForToken } from "./sessionLookup.js";
import { runContended } from "./sessions/transactions.js";
import {
  MAX_VIEWER_SIGN_INS,
  collectionPaths,
  docPaths,
  validate,
  type RedeemLinkTokenResponse,
  type SessionPrivateMeta,
  type ShareSession,
  type SharerSnapshot,
  type ViewerRole,
  type ViewerSignIn,
} from "./shared/schema.js";

/** The one answer for every token that doesn't lead to a session. */
const notFound = () => new HttpsError("not-found", "This link doesn't work.");

const isShareSession = (value: unknown): value is ShareSession => validate("ShareSession", value).length === 0;
const isPrivateMeta = (value: unknown): value is SessionPrivateMeta => validate("SessionPrivateMeta", value).length === 0;

/**
 * The link token from the request, or a list of what's wrong with its shape.
 * Only the shape is checked here. A string that isn't a well-formed token is
 * answered like an unknown one (not-found).
 */
function linkTokenOf(input: unknown): { ok: true; token: string } | { ok: false; errors: FieldError[] } {
  if (!isRecord(input)) return { ok: false, errors: [{ field: "(root)", message: "must be an object" }] };
  const errors: FieldError[] = Object.keys(input)
    .filter((key) => key !== "link_token")
    .map((field) => ({ field, message: "is not part of the request" }));
  const token = input.link_token;
  if (typeof token !== "string") errors.push({ field: "link_token", message: "must be a string" });
  else if (errors.length === 0) return { ok: true, token };
  return { ok: false, errors };
}

/**
 * Live means a viewer may still watch: active, and before both its stop time
 * and its 1-hour limit. A session past either is over even if the scheduled
 * stop hasn't marked it stopped yet.
 */
function isLive(session: ShareSession, nowMs: number): boolean {
  return session.status === "active"
    && nowMs < session.expires_at.toMillis()
    && (session.stop_at === null || nowMs < session.stop_at.toMillis());
}

type Redeemed =
  | { outcome: "redeemed"; role: ViewerRole; canShareBack: boolean }
  | { outcome: "ended"; sharer: SharerSnapshot }
  | { outcome: "full" };

/**
 * Trades a share link's token for a sign-in scoped to that one session
 * (FSD §5, §6 "Viewer access"; x-decisions Q-VIEWER-ROLE, Q-VIEWER-SIGNIN).
 *
 * In one transaction:
 *  - the first browser becomes the session's viewer: private/meta.viewer_uid
 *    records its uid, and the session's first_viewed_at is set. Every later
 *    browser is a watcher. Of two browsers racing, exactly one becomes the
 *    viewer;
 *  - each new browser's uid is recorded in viewerSignIns, for the cleanup.
 *    A session takes at most MAX_VIEWER_SIGN_INS browsers (10), the viewer
 *    included, so a leaked link can't create Auth users without end;
 *  - nothing slow happens inside it. The sharer's pings update the session
 *    doc every few seconds, and a transaction that read it holds it until it
 *    commits, so signing a token in there (an IAM round trip in production)
 *    once timed out those locks. Both possible tokens, viewer and watcher, are
 *    signed before it, in parallel, and only the one for the role it commits
 *    is returned; the other never leaves this function. So a returned token
 *    always names a committed role, and a signing failure writes nothing.
 * A browser that redeems again with the viewer sign-in it already has for
 * this session (a refresh or a reopen) keeps its uid and its role.
 *
 * Returns {custom_token, session_id, role, can_share_back}. can_share_back is
 * true for the viewer while the session allows share back and its call is
 * active; the page follows the session doc for later changes.
 *
 * Errors:
 *  - not-found for any token that doesn't lead to a session, whether it's
 *    malformed or unknown, with the same message every time. The token format
 *    is public, so turning a malformed one away before the lookup says nothing
 *    about which tokens exist; every well-formed token costs the same indexed
 *    query, found or not;
 *  - failed-precondition {reason: "session_ended", sharer} once the session
 *    has stopped or passed stop_at or expires_at. Nothing is minted, so
 *    nothing can read pings; the page shows "This location is no longer being
 *    shared" with the sharer's name and mascot;
 *  - resource-exhausted {reason: "too_many_viewers"} for a new browser once
 *    the session has MAX_VIEWER_SIGN_INS sign-ins. Browsers that already have
 *    one can still refresh;
 *  - unavailable when the transaction keeps losing to other writes on the
 *    session after its retries; the page tries again;
 *  - invalid-argument when the request isn't {link_token: string}.
 */
export const redeemLinkToken = onCall<unknown, Promise<RedeemLinkTokenResponse>>(async (request) => {
  const parsed = linkTokenOf(request.data);
  if (!parsed.ok) {
    throw new HttpsError("invalid-argument", "The request isn't valid.", { errors: parsed.errors });
  }
  if (validate("LinkToken", parsed.token).length > 0) throw notFound();

  const db = getFirestore();
  const sessionRef = await sessionForToken(db, parsed.token);
  if (!sessionRef) throw notFound();
  const sessionId = sessionRef.id;
  const metaRef = db.doc(docPaths.sessionPrivateMeta(sessionId));

  const existing = viewerSignInOf(request.auth);
  const uid = existing?.claims.sid === sessionId ? existing.uid : newViewerUid(sessionId);
  const signInRef = db.doc(docPaths.viewerSignIn(sessionId, uid));

  // Signed before the transaction (above): either role, for this uid.
  const [viewerToken, watcherToken] = await Promise.all([
    mintViewerToken(uid, { sid: sessionId, role: "viewer" }),
    mintViewerToken(uid, { sid: sessionId, role: "watcher" }),
  ]);

  const redeemed = await runContended(db, "redeemLinkToken", async (tx): Promise<Redeemed> => {
    const [sessionSnap, metaSnap, signInSnap] = await tx.getAll(sessionRef, metaRef, signInRef);
    if (!sessionSnap.exists || !metaSnap.exists) throw notFound();
    const session: unknown = sessionSnap.data();
    const meta: unknown = metaSnap.data();
    if (!isShareSession(session) || !isPrivateMeta(meta)) {
      logger.error("session doesn't match the shared schema", {
        session_id: sessionId,
        issues: [...validate("ShareSession", session), ...validate("SessionPrivateMeta", meta)],
      });
      throw new HttpsError("internal", "This link can't be opened right now.");
    }

    if (!isLive(session, Date.now())) return { outcome: "ended", sharer: session.sharer };

    let role: ViewerRole = meta.viewer_uid === uid ? "viewer" : "watcher";
    if (!signInSnap.exists) {
      const signIns = db.collection(collectionPaths.viewerSignIn(sessionId));
      if ((await tx.get(signIns.count())).data().count >= MAX_VIEWER_SIGN_INS) return { outcome: "full" };
      if (meta.viewer_uid === null) {
        role = "viewer";
        if (session.first_viewed_at === null) tx.update(sessionRef, { first_viewed_at: FieldValue.serverTimestamp() });
      }
      const signIn: ViewerSignIn<FieldValue> = { role, created_at: FieldValue.serverTimestamp() };
      tx.create(signInRef, signIn);
      // Every new browser writes viewer_uid: the first one sets it, later ones
      // write it back unchanged. The write is what keeps the cap exact. A count
      // locks only the docs it counted, not new ones, so without a shared
      // write two browsers could both take the last place. With it, new
      // browsers commit one at a time.
      tx.update(metaRef, { viewer_uid: meta.viewer_uid ?? uid });
    }

    const canShareBack = role === "viewer" && session.share_back_allowed && session.call_active;
    return { outcome: "redeemed", role, canShareBack };
  });

  switch (redeemed.outcome) {
    case "ended":
      throw new HttpsError("failed-precondition", "This location is no longer being shared.", {
        reason: "session_ended",
        sharer: redeemed.sharer,
      });
    case "full":
      logger.warn("viewer sign-in cap reached", { session_id: sessionId });
      throw new HttpsError("resource-exhausted", "This link can't be opened right now.", { reason: "too_many_viewers" });
    case "redeemed":
      break;
  }
  logger.info("link redeemed", { session_id: sessionId, role: redeemed.role, reopened: existing?.claims.sid === sessionId });
  return {
    custom_token: redeemed.role === "viewer" ? viewerToken : watcherToken,
    session_id: sessionId,
    role: redeemed.role,
    can_share_back: redeemed.canShareBack,
  };
});
