/**
 * Sending alerts to phones: FCM HTTP v1 for both platforms, with iOS reached
 * through FCM's APNs link (FSD §5; architecture "Cloud Functions → APNs and
 * FCM → apps"). The sender sits behind PushSender, so tests pass a fake and the
 * emulators only log what would have gone out.
 */
import { getMessaging, type Messaging, type TokenMessage } from "firebase-admin/messaging";
import { logger } from "firebase-functions";

/** What FCM said about one message. code is the Admin SDK's, such as "messaging/registration-token-not-registered". */
export type PushResult = { ok: true } | { ok: false; code: string; message: string };

export interface PushSender {
  /** For the logs: "fcm", "log" (the emulators), or a test's fake. */
  readonly name: string;
  /**
   * Sends each message on its own and resolves one result per message, in
   * order. Rejects only when nothing could be tried, such as when FCM can't be
   * reached or the credentials don't work.
   */
  send(messages: readonly TokenMessage[]): Promise<PushResult[]>;
}

/** sendEach takes at most 500 messages a call. */
const SEND_EACH_MAX = 500;

export function fcmSender(messaging: Messaging = getMessaging()): PushSender {
  return {
    name: "fcm",
    async send(messages) {
      const results: PushResult[] = [];
      for (let i = 0; i < messages.length; i += SEND_EACH_MAX) {
        const batch = await messaging.sendEach(messages.slice(i, i + SEND_EACH_MAX));
        for (const r of batch.responses) {
          results.push(r.success ? { ok: true } : { ok: false, code: r.error?.code ?? "messaging/unknown-error", message: r.error?.message ?? "" });
        }
      }
      return results;
    },
  };
}

/**
 * The emulators' sender: logs each alert it would send and reports it
 * delivered, so the apps' and QA's runs show an alert fired in the functions
 * log. It never logs the whole token.
 */
export function loggingSender(): PushSender {
  return {
    name: "log",
    send(messages) {
      for (const m of messages) {
        logger.info("alert (emulator: logged, not sent)", {
          title: m.notification?.title,
          body: m.notification?.body,
          data: m.data,
          token_tail: m.token.slice(-6),
        });
      }
      return Promise.resolve(messages.map((): PushResult => ({ ok: true })));
    },
  };
}

/**
 * The emulators, and any demo- project (which can never reach real
 * resources), log alerts; a real project sends them through FCM.
 */
export function defaultSender(env: NodeJS.ProcessEnv = process.env): PushSender {
  const demo = env.FUNCTIONS_EMULATOR === "true" || (env.GCLOUD_PROJECT ?? "").startsWith("demo-");
  return demo ? loggingSender() : fcmSender();
}

/**
 * What a failed send means for its device:
 *  - gone: the token stopped working (the app was uninstalled, or the token
 *    was replaced). The device doc is deleted (FSD §8 Retention);
 *  - retry: FCM or APNs was busy or failing; trying again later may work;
 *  - failed: anything else, such as a bad payload, a credential that isn't
 *    allowed to send, or the APNs key missing in FCM. Retrying won't help and
 *    the token may be fine, so it's logged and kept.
 * A malformed token comes back from FCM v1 as invalid-argument, which a bad
 * payload also gives, so that is "failed", never a reason to delete every
 * token.
 */
export type FailureKind = "gone" | "retry" | "failed";

const GONE = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token"]);
const RETRY = new Set([
  "messaging/server-unavailable",
  "messaging/internal-error",
  "messaging/message-rate-exceeded",
  "messaging/device-message-rate-exceeded",
  "messaging/unknown-error",
]);

export function failureKind(code: string): FailureKind {
  if (GONE.has(code)) return "gone";
  if (RETRY.has(code)) return "retry";
  return "failed";
}
