/**
 * What an alert looks like on the phone: the FCM message for one device. This
 * is the contract the apps build on (code/backend/README.md "Alerts"):
 *  - notification title and body, plain text in the prototype's words;
 *  - data {type, session_id}: type is the alert kind (link_opened), and tapping
 *    opens that session's live screen;
 *  - Android: channel = the kind, high priority, tag and collapse key
 *    "<kind>:<sessionId>";
 *  - iOS: an alert push with apns-collapse-id "<kind>:<sessionId>" and
 *    thread-id = the session id.
 * The shared tag and collapse id make a resend replace the notification
 * instead of stacking a second one. Both stop being delivered when the session
 * ends: an alert about a share that's over is no use.
 */
import type { Timestamp } from "firebase-admin/firestore";
import type { TokenMessage } from "firebase-admin/messaging";
import type { AlertKind } from "../shared/schema.js";

export interface Alert {
  kind: AlertKind;
  sessionId: string;
  title: string;
  body: string;
  /** When the session ends (the earlier of stop_at and expires_at); the alert expires with it. */
  endsAt: Timestamp;
}

/** The data keys every alert carries. FCM data values are strings. */
export interface AlertData {
  [key: string]: string;
  type: AlertKind;
  session_id: string;
}

/** Collapses a resend into the notification already shown: Android tag and collapse key, APNs collapse id (at most 64 bytes). */
export const collapseId = (alert: Alert): string => `${alert.kind}:${alert.sessionId}`;

/**
 * The FCM message for one device token. Both platform blocks go in every
 * message; FCM applies the one for the token's platform, so a device doc with
 * the wrong platform still gets its alert.
 */
export function alertMessage(alert: Alert, token: string, nowMs: number): TokenMessage {
  const id = collapseId(alert);
  const endsMs = alert.endsAt.toMillis();
  const data: AlertData = { type: alert.kind, session_id: alert.sessionId };
  return {
    token,
    notification: { title: alert.title, body: alert.body },
    data,
    android: {
      priority: "high",
      ttl: Math.max(0, endsMs - nowMs),
      collapseKey: id,
      notification: { channelId: alert.kind, tag: id },
    },
    apns: {
      headers: {
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": String(Math.ceil(endsMs / 1000)),
        "apns-collapse-id": id,
      },
      payload: { aps: { sound: "default", threadId: alert.sessionId } },
    },
  };
}
