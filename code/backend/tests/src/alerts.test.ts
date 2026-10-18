/**
 * The link-opened alert (FSD §4 "View notification"; x-decisions Q-ALERT-PUSH,
 * Q-ALERT-ONCE). First the parts that need no emulator: the words, the FCM
 * message, how FCM's answers are sorted, and the claim's decisions. Then
 * delivery on the Firestore emulator through the functions' own code
 * (functions/lib) with a fake sender: sending, the setting, pruning, retries
 * and duplicates. Last, the deployed trigger end to end: a real redeem, with
 * the emulator logging the alert instead of sending it.
 *
 * The delivery tests never create viewerSignIns docs, so the emulator's own
 * trigger never runs on their sessions.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { Messaging, TokenMessage } from "firebase-admin/messaging";
import {
  DEFAULT_USER_SETTINGS,
  validate,
  type CreateSessionResponse,
  type RedeemLinkTokenResponse,
} from "../../../shared/schema/generated/ts/schema.ts";
import { PROJECT_ID, callFunction, clearAuth, clearFirestore, signInWithPhone } from "./emulators.ts";
// The functions' default app, which alertDeps() uses, comes up with the index.
import "../../functions/lib/index.js";
import {
  AlertRetryError,
  LEASE_MS,
  claimFrom,
  deliverAlert,
  sortResults,
  type AlertDeps,
  type Marker,
} from "../../functions/lib/alerts/delivery.js";
import { LINK_OPENED_MAX_AGE_MS, alertDeps, linkOpened, linkOpenedCopy, onViewerSignIn } from "../../functions/lib/alerts/linkOpened.js";
import { alertMessage, type Alert } from "../../functions/lib/alerts/message.js";
import { defaultSender, failureKind, fcmSender, loggingSender, type PushResult, type PushSender } from "../../functions/lib/alerts/push.js";

const MIN = 60_000;
const at = (ms: number) => Timestamp.fromMillis(ms);

// ---------- No emulator ----------

describe("linkOpenedCopy: the prototype's words", () => {
  it("names who it's for, or says they", () => {
    assert.deepEqual(linkOpenedCopy("Mom", true), { title: "Mom opened your link", body: "You’re live on their map until your call ends." });
    assert.deepEqual(linkOpenedCopy(null, false), { title: "They opened your link", body: "You’re live on their map." });
    assert.equal(linkOpenedCopy("Mom", false).body, "You’re live on their map.");
  });
});

describe("alertMessage: the FCM message the apps receive", () => {
  const now = Date.UTC(2026, 9, 18, 21, 0, 0);
  const alert: Alert = { kind: "link_opened", sessionId: "S1", title: "Mom opened your link", body: "You’re live on their map.", endsAt: at(now + 30 * MIN + 500) };

  it("carries the words, the data the tap needs, and per-platform delivery that ends with the session", () => {
    assert.deepEqual(alertMessage(alert, "tok-1", now), {
      token: "tok-1",
      notification: { title: "Mom opened your link", body: "You’re live on their map." },
      data: { type: "link_opened", session_id: "S1" },
      android: { priority: "high", ttl: 30 * MIN + 500, collapseKey: "link_opened:S1", notification: { channelId: "link_opened", tag: "link_opened:S1" } },
      apns: {
        headers: {
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-expiration": String(Math.ceil((now + 30 * MIN + 500) / 1000)),
          "apns-collapse-id": "link_opened:S1",
        },
        payload: { aps: { sound: "default", threadId: "S1" } },
      },
    });
  });

  it("never sets a negative time to live", () => {
    assert.equal(alertMessage(alert, "t", now + 60 * MIN).android?.ttl, 0);
  });

  it("keeps the collapse id inside APNs's 64 bytes for a Firestore id", () => {
    const id = alertMessage({ ...alert, sessionId: "a".repeat(20) }, "t", now).apns?.headers?.["apns-collapse-id"] ?? "";
    assert.ok(Buffer.byteLength(id) <= 64, id);
  });
});

describe("failureKind: what FCM's answer means for the token", () => {
  it("deletes only tokens FCM says are unregistered or invalid", () => {
    for (const code of ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"]) assert.equal(failureKind(code), "gone", code);
  });

  it("retries when FCM or APNs is busy or failing", () => {
    for (const code of ["messaging/server-unavailable", "messaging/internal-error", "messaging/message-rate-exceeded", "messaging/device-message-rate-exceeded", "messaging/unknown-error"]) {
      assert.equal(failureKind(code), "retry", code);
    }
  });

  it("neither deletes nor retries a bad payload or a credential problem, which every token would share", () => {
    for (const code of ["messaging/invalid-argument", "messaging/mismatched-credential", "messaging/third-party-auth-error", "messaging/payload-size-limit-exceeded", "messaging/authentication-error", "something-else"]) {
      assert.equal(failureKind(code), "failed", code);
    }
  });
});

describe("sortResults", () => {
  it("sorts each device by its result, in order, and retries one with no result", () => {
    const fail = (code: string): PushResult => ({ ok: false, code, message: "" });
    assert.deepEqual(
      sortResults(["a", "b", "c", "d", "e"], [{ ok: true }, fail("messaging/registration-token-not-registered"), fail("messaging/server-unavailable"), fail("messaging/invalid-argument")]),
      { delivered: ["a"], gone: ["b"], retry: ["c", "e"], failed: [{ deviceId: "d", code: "messaging/invalid-argument" }] },
    );
  });
});

describe("claimFrom: what an attempt does with the marker it finds", () => {
  const now = 1_000_000;
  const marker = (o: Partial<Marker>): Marker => ({
    kind: "link_opened", state: "sending", delivered: ["a"], attempts: 1,
    lease_until: at(now + 1), created_at: at(0), updated_at: at(0), ...o,
  });

  it("no marker: the first attempt sends to everyone", () => {
    assert.deepEqual(claimFrom(null, now), { action: "send", delivered: [], attempt: 1 });
  });

  it("sent, skipped or malformed: a duplicate, nothing to do", () => {
    assert.deepEqual(claimFrom(marker({ state: "sent" }), now), { action: "done" });
    assert.deepEqual(claimFrom(marker({ state: "skipped" }), now), { action: "done" });
    assert.deepEqual(claimFrom("malformed", now), { action: "done" });
  });

  it("sending under a running lease: busy; once the lease is up (at its last ms): take over, minus the devices reached", () => {
    assert.deepEqual(claimFrom(marker({}), now), { action: "busy" });
    assert.deepEqual(claimFrom(marker({ lease_until: at(now), attempts: 2 }), now), { action: "send", delivered: ["a"], attempt: 3 });
  });
});

describe("the senders", () => {
  const message = (token: string): TokenMessage => ({ token, notification: { title: "t", body: "b" }, data: { type: "link_opened", session_id: "S" } });

  it("the emulators and demo- projects log; a real project sends through FCM", () => {
    assert.equal(defaultSender({ FUNCTIONS_EMULATOR: "true", GCLOUD_PROJECT: "trackmelive" }).name, "log");
    assert.equal(defaultSender({ GCLOUD_PROJECT: "demo-trackmelive" }).name, "log");
    assert.equal(defaultSender({ GCLOUD_PROJECT: "trackmelive" }).name, "fcm");
  });

  it("the logging sender reports every message delivered", async () => {
    assert.deepEqual(await loggingSender().send([message("a"), message("b")]), [{ ok: true }, { ok: true }]);
  });

  it("the FCM sender sends 500 at a time and maps each response", async () => {
    const calls: number[] = [];
    const messaging = {
      sendEach(batch: TokenMessage[]) {
        calls.push(batch.length);
        return Promise.resolve({
          successCount: 0, failureCount: 0,
          responses: batch.map((m) => (m.token === "bad"
            ? { success: false, error: { code: "messaging/registration-token-not-registered", message: "gone" } }
            : { success: true, messageId: "m" })),
        });
      },
    } as unknown as Messaging;
    const messages = [...Array.from({ length: 500 }, () => message("ok")), message("bad")];
    const results = await fcmSender(messaging).send(messages);
    assert.deepEqual(calls, [500, 1]);
    assert.equal(results.length, 501);
    assert.deepEqual(results[0], { ok: true });
    assert.deepEqual(results[500], { ok: false, code: "messaging/registration-token-not-registered", message: "gone" });
  });
});

// ---------- On the Firestore emulator ----------

let app: App;
let db: Firestore;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "alerts-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

/** A fake FCM: records what was sent, and answers per token (ok unless scripted). */
class FakeSender implements PushSender {
  readonly name = "fake";
  sent: TokenMessage[] = [];
  answers = new Map<string, PushResult[]>();
  /** Runs during a send, before it answers: an app or a deletion racing it. */
  during: (() => Promise<void>) | null = null;
  error: Error | null = null;

  answer(token: string, ...results: PushResult[]) {
    this.answers.set(token, results);
  }

  async send(messages: readonly TokenMessage[]): Promise<PushResult[]> {
    if (this.during) await this.during();
    if (this.error) throw this.error;
    this.sent.push(...messages);
    return messages.map((m) => this.answers.get(m.token)?.shift() ?? { ok: true });
  }
}

const notRegistered: PushResult = { ok: false, code: "messaging/registration-token-not-registered", message: "gone" };
const unavailable: PushResult = { ok: false, code: "messaging/server-unavailable", message: "busy" };
const badPayload: PushResult = { ok: false, code: "messaging/invalid-argument", message: "bad" };

let clock: number;
let sender: FakeSender;
let deps: AlertDeps;

beforeEach(async () => {
  await clearFirestore();
  clock = Date.now();
  sender = new FakeSender();
  deps = { ...alertDeps(), sender, now: () => clock };
});

/** A live call share Mom opened a minute ago, as createSession and redeemLinkToken leave it. */
function sessionDoc(overrides: Record<string, unknown> = {}) {
  const session = {
    status: "active",
    started_at: at(clock - 5 * MIN),
    expires_at: at(clock + 55 * MIN),
    stop_rule: "call", stop_minutes: null, stop_at: null, ended_at: null, end_reason: null,
    call_id: "call-1", call_active: true, call_ended_at: null, share_back_allowed: true,
    last_ping_at: at(clock - 5000), ping_interval_s: 5, precision: "precise", precision_next: null,
    sharer: { name: "Alex", mascot_id: "fox", mascot_color: "original", mascot_accessory: null },
    first_viewed_at: at(clock - MIN), viewer_sharing: false, share_back_requested_at: null, cleaned_at: null,
    ...overrides,
  };
  assert.deepEqual(validate("ShareSession", session), []);
  return session;
}

interface Seed {
  session?: Record<string, unknown> | null;
  viewerName?: string | null;
  meta?: boolean;
  settings?: Partial<typeof DEFAULT_USER_SETTINGS>;
  user?: boolean;
  devices?: Record<string, { platform: "ios" | "android"; push_token: string }>;
}

const DEVICES = { "d-ios": { platform: "ios", push_token: "tok-ios" }, "d-android": { platform: "android", push_token: "tok-android" } } as const;

async function seed(id: string, opts: Seed = {}): Promise<void> {
  const { session = sessionDoc(), viewerName = "Mom", meta = true, settings = {}, user = true, devices = DEVICES } = opts;
  const batch = db.batch();
  if (session) batch.set(db.doc(`shareSessions/${id}`), session);
  if (meta) {
    batch.set(db.doc(`shareSessions/${id}/private/meta`), {
      user_id: "alice", link_token_hash: "0".repeat(64), viewer_uid: "v_viewer", viewer_name: viewerName, activity_push_token: null,
    });
  }
  if (user) {
    const t = at(clock - 24 * 60 * MIN);
    batch.set(db.doc("users/alice"), {
      name: "Alex", mascot_id: "fox", mascot_color: "original", mascot_accessory: null, last_viewer_name: viewerName,
      settings: { ...DEFAULT_USER_SETTINGS, ...settings }, active_session_id: id, created_at: t, updated_at: t,
    });
  }
  for (const [deviceId, d] of Object.entries(devices)) {
    batch.set(db.doc(`users/alice/devices/${deviceId}`), { ...d, live_activity_start_token: null, updated_at: Timestamp.now() });
  }
  await batch.commit();
}

const marker = async (id: string) => (await db.doc(`shareSessions/${id}/alerts/link_opened`).get()).data();
const tokensSent = () => sender.sent.map((m) => m.token).sort();
const deviceExists = async (id: string) => (await db.doc(`users/alice/devices/${id}`).get()).exists;

describe("deliverAlert(linkOpened): sending", () => {
  it("sends the alert to each of the sharer's phones and records it sent", async () => {
    await seed("s1");
    const outcome = await deliverAlert(deps, linkOpened, "s1");
    assert.deepEqual(outcome, { outcome: "sent", attempt: 1, devices: 2, delivered: 2, pruned: 0, failed: 0 });
    assert.deepEqual(tokensSent(), ["tok-android", "tok-ios"]);
    for (const m of sender.sent) {
      assert.deepEqual(m.notification, { title: "Mom opened your link", body: "You’re live on their map until your call ends." });
      assert.deepEqual(m.data, { type: "link_opened", session_id: "s1" });
      assert.equal(m.android?.ttl, 55 * MIN);
    }
    const m = await marker("s1");
    assert.deepEqual(validate("AlertDelivery", m), []);
    assert.equal(m?.state, "sent");
    assert.deepEqual([...m?.delivered].sort(), ["d-android", "d-ios"]);
    assert.equal(m?.attempts, 1);
  });

  it("says they without a name, and leaves the call out without one; it expires at the timer", async () => {
    await seed("s1", { viewerName: null, session: sessionDoc({ call_id: null, call_active: false, stop_rule: "minutes", stop_minutes: 15, stop_at: at(clock + 10 * MIN) }) });
    await deliverAlert(deps, linkOpened, "s1");
    assert.deepEqual(sender.sent[0]?.notification, { title: "They opened your link", body: "You’re live on their map." });
    assert.equal(sender.sent[0]?.android?.ttl, 10 * MIN);
  });

  it("with no devices, has nothing to send and is done", async () => {
    await seed("s1", { devices: {} });
    assert.deepEqual(await deliverAlert(deps, linkOpened, "s1"), { outcome: "sent", attempt: 1, devices: 0, delivered: 0, pruned: 0, failed: 0 });
    assert.equal((await marker("s1"))?.state, "sent");
  });

  it("leaves out a device doc that isn't a valid Device, and still reaches the rest", async () => {
    await seed("s1");
    await db.doc("users/alice/devices/broken").set({ platform: "windows", push_token: "", updated_at: Timestamp.now() });
    await deliverAlert(deps, linkOpened, "s1");
    assert.deepEqual(tokensSent(), ["tok-android", "tok-ios"]);
  });
});

describe("deliverAlert(linkOpened): when it isn't sent", () => {
  it("skips it when When my link is opened is off, and remembers, so turning it on later sends nothing", async () => {
    await seed("s1", { settings: { alert_link_opened: false } });
    assert.deepEqual(await deliverAlert(deps, linkOpened, "s1"), { outcome: "skipped", reason: "setting_off" });
    assert.equal((await marker("s1"))?.state, "skipped");
    await db.doc("users/alice").update({ "settings.alert_link_opened": true });
    assert.deepEqual(await deliverAlert(deps, linkOpened, "s1"), { outcome: "duplicate" });
    assert.equal(sender.sent.length, 0);
  });

  it("other alert switches don't silence it", async () => {
    await seed("s1", { settings: { alert_call_ended: false, alert_expiry: false } });
    assert.equal((await deliverAlert(deps, linkOpened, "s1")).outcome, "sent");
  });

  it("isn't sent once the session is over: stopped, or past its timer or its limit", async () => {
    const over = {
      stopped: sessionDoc({ status: "stopped", ended_at: at(clock - 1000), end_reason: "stopped" }),
      timer: sessionDoc({ stop_rule: "minutes", stop_minutes: 15, stop_at: at(clock) }),
      limit: sessionDoc({ started_at: at(clock - 60 * MIN), expires_at: at(clock) }),
    };
    for (const [id, session] of Object.entries(over)) {
      await seed(id, { session });
      assert.deepEqual(await deliverAlert(deps, linkOpened, id), { outcome: "skipped", reason: "session_over" }, id);
      assert.equal(await marker(id), undefined, id);
    }
    assert.equal(sender.sent.length, 0);
  });

  it("isn't sent for a session nobody opened", async () => {
    await seed("s1", { session: sessionDoc({ first_viewed_at: null }) });
    assert.deepEqual(await deliverAlert(deps, linkOpened, "s1"), { outcome: "skipped", reason: "not_opened" });
  });

  it("isn't sent when the session, its meta or the account is gone, and leaves nothing behind", async () => {
    await seed("no-session", { session: null });
    await seed("no-meta", { meta: false });
    for (const id of ["no-session", "no-meta"]) {
      assert.deepEqual(await deliverAlert(deps, linkOpened, id), { outcome: "skipped", reason: "session_gone" });
      assert.equal(await marker(id), undefined);
    }
    await clearFirestore();
    await seed("no-user", { user: false });
    assert.deepEqual(await deliverAlert(deps, linkOpened, "no-user"), { outcome: "skipped", reason: "no_profile" });
    assert.equal(await marker("no-user"), undefined);
    assert.equal(sender.sent.length, 0);
  });
});

describe("deliverAlert(linkOpened): tokens that stopped working", () => {
  it("deletes a device FCM says is unregistered; keeps one whose failure isn't the token's", async () => {
    await seed("s1");
    sender.answer("tok-ios", notRegistered);
    sender.answer("tok-android", badPayload);
    assert.deepEqual(await deliverAlert(deps, linkOpened, "s1"), { outcome: "sent", attempt: 1, devices: 2, delivered: 0, pruned: 1, failed: 1 });
    assert.equal(await deviceExists("d-ios"), false);
    assert.equal(await deviceExists("d-android"), true);
    assert.equal((await marker("s1"))?.state, "sent");
  });

  it("keeps a device the app rewrote with a fresh token while the alert was going out", async () => {
    await seed("s1");
    sender.answer("tok-ios", notRegistered);
    sender.during = async () => {
      await db.doc("users/alice/devices/d-ios").update({ push_token: "tok-ios-new", updated_at: Timestamp.now() });
    };
    assert.equal((await deliverAlert(deps, linkOpened, "s1")).outcome, "sent");
    assert.equal((await db.doc("users/alice/devices/d-ios").get()).get("push_token"), "tok-ios-new");
  });
});

describe("deliverAlert(linkOpened): retries and duplicates", () => {
  it("a second run, as when the trigger is delivered twice, sends nothing", async () => {
    await seed("s1");
    await deliverAlert(deps, linkOpened, "s1");
    assert.deepEqual(await deliverAlert(deps, linkOpened, "s1"), { outcome: "duplicate" });
    assert.equal(sender.sent.length, 2);
  });

  it("a device FCM couldn't take now is retried alone; the one reached isn't sent it twice", async () => {
    await seed("s1");
    sender.answer("tok-android", unavailable);
    await assert.rejects(deliverAlert(deps, linkOpened, "s1"), AlertRetryError);
    let m = await marker("s1");
    assert.equal(m?.state, "sending");
    assert.deepEqual(m?.delivered, ["d-ios"]);
    assert.ok(m?.lease_until.toMillis() <= clock, "the lease is let go for the retry");

    sender.sent = [];
    clock += 10_000;
    assert.deepEqual(await deliverAlert(deps, linkOpened, "s1"), { outcome: "sent", attempt: 2, devices: 1, delivered: 1, pruned: 0, failed: 0 });
    assert.deepEqual(tokensSent(), ["tok-android"]);
    m = await marker("s1");
    assert.equal(m?.state, "sent");
    assert.deepEqual([...m?.delivered].sort(), ["d-android", "d-ios"]);
    assert.equal(m?.attempts, 2);
  });

  it("when FCM can't be reached at all, lets go of the lease and throws; the retry sends to everyone", async () => {
    await seed("s1");
    sender.error = new Error("ECONNRESET");
    await assert.rejects(deliverAlert(deps, linkOpened, "s1"), /ECONNRESET/);
    assert.equal((await marker("s1"))?.state, "sending");
    sender.error = null;
    clock += 10_000;
    assert.equal((await deliverAlert(deps, linkOpened, "s1")).outcome, "sent");
    assert.deepEqual(tokensSent(), ["tok-android", "tok-ios"]);
  });

  it("while another attempt holds the alert, waits (a retry), then takes over once its lease runs out", async () => {
    await seed("s1");
    await db.doc("shareSessions/s1/alerts/link_opened").set({
      kind: "link_opened", state: "sending", delivered: ["d-ios"], attempts: 1,
      lease_until: at(clock + LEASE_MS), created_at: at(clock), updated_at: at(clock),
    });
    await assert.rejects(deliverAlert(deps, linkOpened, "s1"), AlertRetryError);
    assert.equal(sender.sent.length, 0);
    clock += LEASE_MS;
    assert.equal((await deliverAlert(deps, linkOpened, "s1")).outcome, "sent");
    assert.deepEqual(tokensSent(), ["tok-android"]);
  });

  it("of two attempts at once, exactly one sends", async () => {
    await seed("s1");
    const results = await Promise.allSettled([deliverAlert(deps, linkOpened, "s1"), deliverAlert(deps, linkOpened, "s1")]);
    assert.deepEqual(tokensSent(), ["tok-android", "tok-ios"]);
    const sent = results.filter((r) => r.status === "fulfilled" && r.value.outcome === "sent");
    assert.equal(sent.length, 1);
    for (const r of results) {
      if (r.status === "rejected") assert.ok(r.reason instanceof AlertRetryError);
      else if (r.value.outcome !== "sent") assert.equal(r.value.outcome, "duplicate");
    }
  });

  it("doesn't leave its marker behind when the account is deleted while it sends", async () => {
    await seed("s1");
    sender.during = async () => {
      await db.recursiveDelete(db.doc("users/alice"));
    };
    await deliverAlert(deps, linkOpened, "s1");
    assert.equal(await marker("s1"), undefined);
  });
});

describe("onViewerSignIn: which sign-ins alert", () => {
  const event = (o: { role?: string; ageMs?: number; time?: string } = {}) => ({
    sessionId: "s1",
    role: o.role ?? "viewer",
    eventTime: o.time ?? new Date(clock - (o.ageMs ?? 1000)).toISOString(),
  });

  it("the viewer's sign-in (the first open) alerts; a watcher's never does", async () => {
    await seed("s1");
    assert.deepEqual(await onViewerSignIn(deps, event({ role: "watcher" })), { outcome: "skipped", reason: "watcher" });
    assert.equal(sender.sent.length, 0);
    assert.equal((await onViewerSignIn(deps, event())).outcome, "sent");
  });

  it("sends up to 10 minutes after the open, and not after", async () => {
    await seed("s1");
    assert.deepEqual(await onViewerSignIn(deps, event({ ageMs: LINK_OPENED_MAX_AGE_MS + 1 })), { outcome: "skipped", reason: "too_late" });
    assert.deepEqual(await onViewerSignIn(deps, event({ time: "not a time" })), { outcome: "skipped", reason: "too_late" });
    assert.equal(sender.sent.length, 0);
    assert.equal((await onViewerSignIn(deps, event({ ageMs: LINK_OPENED_MAX_AGE_MS }))).outcome, "sent");
  });
});

// ---------- The deployed trigger ----------

/** Waits for the trigger's marker to reach a final state. */
async function settledMarker(sessionId: string, timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const m = await marker(sessionId);
    if (m && m.state !== "sending") return m;
    if (Date.now() > end) assert.fail(`no settled alert marker for ${sessionId}: ${JSON.stringify(m)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe("sendLinkOpenedAlert on the emulator (logs instead of sending)", () => {
  let phone = 0;
  async function shareAndOpen(settings: Partial<typeof DEFAULT_USER_SETTINGS> = {}) {
    const sharer = await signInWithPhone(`+1555555061${phone++}`);
    const saved = await callFunction("saveProfile", {
      name: "Alex", mascot_id: "fox", mascot_color: "original", mascot_accessory: null, settings: { ...DEFAULT_USER_SETTINGS, ...settings },
    }, sharer.idToken);
    assert.ok(saved.ok, JSON.stringify(saved));
    await db.doc(`users/${sharer.uid}/devices/d-1`).set({ platform: "android", push_token: "tok-e2e", live_activity_start_token: null, updated_at: Timestamp.now() });
    const created = await callFunction<CreateSessionResponse>("createSession", {
      stop_rule: "call", stop_minutes: null, call_id: "call-e2e", share_back_allowed: true, precision: "precise", viewer_name: "Mom",
    }, sharer.idToken);
    assert.ok(created.ok, JSON.stringify(created));
    const opened = await callFunction<RedeemLinkTokenResponse>("redeemLinkToken", { link_token: created.data.link_token });
    assert.ok(opened.ok && opened.data.role === "viewer", JSON.stringify(opened));
    return { linkToken: created.data.link_token, sessionId: created.data.session_id };
  }

  before(async () => {
    await clearFirestore();
    await clearAuth();
  });

  it("the first open records the alert sent to the sharer's phone, once; a second browser adds nothing", async () => {
    const { linkToken, sessionId } = await shareAndOpen();
    const m = await settledMarker(sessionId);
    assert.equal(m.state, "sent");
    assert.deepEqual(m.delivered, ["d-1"]);
    assert.equal(m.attempts, 1);

    const watcher = await callFunction<RedeemLinkTokenResponse>("redeemLinkToken", { link_token: linkToken });
    assert.ok(watcher.ok && watcher.data.role === "watcher");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const again = await marker(sessionId);
    assert.ok(again?.updated_at.isEqual(m.updated_at), "the watcher's sign-in didn't touch the alert");
  });

  it("records it skipped when the sharer turned the alert off", async () => {
    const { sessionId } = await shareAndOpen({ alert_link_opened: false });
    assert.equal((await settledMarker(sessionId)).state, "skipped");
  });
});
