import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onDocumentCreated } from "firebase-functions/firestore";
import type { Session } from "../sessions/read.js";
import { dueEnd } from "../sessions/end.js";
import { deliverAlert, type AlertDeps, type AlertSpec, type DeliveryOutcome } from "./delivery.js";
import { defaultSender, type PushSender } from "./push.js";

/**
 * After this long the open is old news: a retried trigger stops sending
 * (x-decisions Q-ALERT-ONCE). Retries back off from seconds to minutes, so a
 * short FCM outage still gets the alert through.
 */
export const LINK_OPENED_MAX_AGE_MS = 10 * 60_000;

/**
 * The prototype's words (prototype/js/app.js openLink): "Mom opened your link",
 * or "They opened your link" without a name; then where the sharer stands.
 * The name is the sharer's own "who it's for" (private/meta.viewer_name),
 * already held to the shared PersonName, so it has no control characters.
 */
export function linkOpenedCopy(viewerName: string | null, callActive: boolean): { title: string; body: string } {
  return {
    title: `${viewerName ?? "They"} opened your link`,
    body: callActive ? "You’re live on their map until your call ends." : "You’re live on their map.",
  };
}

/** When the session ends: the earlier of stop_at and expires_at. */
function endsAt(session: Session): Timestamp {
  const { stop_at: stopAt, expires_at: expiresAt } = session;
  return stopAt !== null && stopAt.toMillis() < expiresAt.toMillis() ? stopAt : expiresAt;
}

/**
 * FSD §4 "View notification": the sharer's phones hear once, on the first
 * open, unless "When my link is opened" is off. Not sent once the session is
 * over: it would say "You're live" about a share that ended.
 */
export const linkOpened: AlertSpec = {
  kind: "link_opened",
  setting: "alert_link_opened",
  compose({ sessionId, session, meta, nowMs }) {
    if (session.first_viewed_at === null) return "not_opened";
    if (session.status !== "active" || dueEnd(session, Timestamp.fromMillis(nowMs)) !== null) return "session_over";
    return { kind: "link_opened", sessionId, ...linkOpenedCopy(meta.viewer_name, session.call_active), endsAt: endsAt(session) };
  },
};

export type SignInOutcome = DeliveryOutcome | { outcome: "skipped"; reason: "watcher" | "too_late" };

/**
 * A viewerSignIns doc was created. redeemLinkToken writes exactly one with
 * role viewer per session, in the transaction that sets first_viewed_at, so
 * that one is the first open; watchers (forwarded links, other browsers)
 * never alert. eventTime is the CloudEvent's time, when the doc was written.
 */
export async function onViewerSignIn(
  deps: AlertDeps,
  signIn: { sessionId: string; role: unknown; eventTime: string },
): Promise<SignInOutcome> {
  if (signIn.role !== "viewer") return { outcome: "skipped", reason: "watcher" };
  const age = deps.now() - Date.parse(signIn.eventTime);
  if (!(age <= LINK_OPENED_MAX_AGE_MS)) {
    logger.warn("link-opened alert too late; not sent", { session_id: signIn.sessionId, event_time: signIn.eventTime });
    return { outcome: "skipped", reason: "too_late" };
  }
  return deliverAlert(deps, linkOpened, signIn.sessionId);
}

let sender: PushSender | undefined;

/** The trigger's dependencies: the default app's Firestore, this project's sender (made once per instance), the real clock. */
export function alertDeps(): AlertDeps {
  sender ??= defaultSender();
  return { db: getFirestore(), sender, now: Date.now };
}

/**
 * The view alert (FSD §4, §5, §6 "Viewer access"). Retried on failure, so a
 * busy FCM or a device due a retry gets another go, until
 * LINK_OPENED_MAX_AGE_MS. On the emulators it only logs the alert.
 */
export const sendLinkOpenedAlert = onDocumentCreated(
  { document: "shareSessions/{sessionId}/viewerSignIns/{viewerUid}", retry: true, timeoutSeconds: 60 },
  async (event) => {
    await onViewerSignIn(alertDeps(), { sessionId: event.params.sessionId, role: event.data?.get("role"), eventTime: event.time });
  },
);
