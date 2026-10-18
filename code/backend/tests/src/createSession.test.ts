/**
 * createSession against the emulators: Auth (a real phone-number sign-in),
 * Functions (the callable over HTTP) and Firestore (what it wrote, read back
 * with the Admin SDK). Every doc and response is checked with the shared
 * schema's validate().
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  DEFAULT_USER_SETTINGS,
  INITIAL_PING_INTERVAL_SECONDS,
  LINK_TOKEN_LENGTH,
  validate,
  type CreateSessionResponse,
} from "../../../shared/schema/generated/ts/schema.ts";
import {
  PROJECT_ID,
  callFunction,
  clearAuth,
  clearFirestore,
  signInAnonymously,
  signInWithPhone,
  type CallableResult,
  type SignedIn,
} from "./emulators.ts";

const HOUR_MS = 3_600_000;
// functions/.env.demo-trackmelive
const VIEWER_ORIGIN = "http://127.0.0.1:5050";

let app: App;
let db: Firestore;
let alex: SignedIn;
let noProfile: SignedIn;

const manualShare = {
  stop_rule: "minutes",
  stop_minutes: 30,
  call_id: null,
  share_back_allowed: false,
  precision: "precise",
};
const callShare = {
  stop_rule: "call",
  stop_minutes: null,
  call_id: "call-123",
  share_back_allowed: true,
  precision: "approximate",
};

const create = (data: unknown, who: SignedIn = alex) => callFunction<CreateSessionResponse>("createSession", data, who.idToken);

function ok<T>(r: CallableResult<T>): T {
  assert.ok(r.ok, JSON.stringify(r));
  return r.data;
}

const sessionOf = async (id: string) => (await db.doc(`shareSessions/${id}`).get()).data()!;
const userOf = async (uid: string) => (await db.doc(`users/${uid}`).get()).data()!;

/** Ends the user's active session directly, as stopSession would, so each test starts with none. */
async function endActiveSession(uid: string): Promise<void> {
  const activeId = (await userOf(uid)).active_session_id as string | null;
  if (!activeId) return;
  await db.doc(`shareSessions/${activeId}`).update({ status: "stopped", ended_at: Timestamp.now(), end_reason: "stopped" });
  await db.doc(`users/${uid}`).update({ active_session_id: null });
}

before(async () => {
  await clearFirestore();
  await clearAuth();
  app = initializeApp({ projectId: PROJECT_ID }, "createSession-test");
  db = getFirestore(app);

  alex = await signInWithPhone("+15555550111");
  noProfile = await signInWithPhone("+15555550112");
  const t = Timestamp.fromMillis(Date.now() - HOUR_MS);
  const profile = {
    name: "Alex",
    mascot_id: "ninja",
    mascot_color: "dusk",
    mascot_accessory: "headphones",
    last_viewer_name: null,
    settings: DEFAULT_USER_SETTINGS,
    active_session_id: null,
    created_at: t,
    updated_at: t,
  };
  assert.deepEqual(validate("User", profile), []);
  await db.doc(`users/${alex.uid}`).set(profile);
});

after(async () => {
  if (app) await deleteApp(app);
});

describe("createSession: who may call it", () => {
  it("rejects a signed-out caller", async () => {
    const r = await callFunction("createSession", manualShare);
    assert.equal(!r.ok && r.code, "UNAUTHENTICATED");
  });

  it("rejects an anonymous sign-in (a viewer is never a sharer)", async () => {
    const viewer = await signInAnonymously();
    const r = await create(manualShare, viewer);
    assert.equal(!r.ok && r.code, "PERMISSION_DENIED");
  });

  it("rejects a sharer who hasn't finished sign-up (no users doc)", async () => {
    const r = await create(manualShare, noProfile);
    assert.equal(!r.ok && r.code, "FAILED_PRECONDITION");
  });

  it("rejects a request that tries to name an owner", async () => {
    const r = await create({ ...manualShare, user_id: "mallory" });
    assert.equal(!r.ok && r.code, "INVALID_ARGUMENT");
    assert.deepEqual(!r.ok && (r.details as { errors: { field: string }[] }).errors.map((e) => e.field), ["user_id"]);
  });
});

describe("createSession: input validation", () => {
  beforeEach(() => endActiveSession(alex.uid));

  const bad: [string, unknown][] = [
    ["no data", null],
    ["an unknown stop rule", { ...manualShare, stop_rule: "sometime" }],
    ["a timer that isn't 15, 30 or 60", { ...manualShare, stop_minutes: 45 }],
    ["a timer with no minutes", { ...manualShare, stop_minutes: null }],
    ["stop with the call, but no call", { ...manualShare, stop_rule: "call", stop_minutes: null }],
    ["an unknown precision", { ...manualShare, precision: "exact" }],
    ["a 25-character viewer name", { ...manualShare, viewer_name: "x".repeat(25) }],
    ["a viewer name that isn't a string", { ...manualShare, viewer_name: 7 }],
    ["a viewer name with a text-direction override", { ...manualShare, viewer_name: "Mom\u202E" }],
    ["a viewer name of only zero-width characters", { ...manualShare, viewer_name: "\u200B\u200D" }],
    ["a missing call_id", { stop_rule: "limit", stop_minutes: null, share_back_allowed: false, precision: "precise" }],
  ];
  for (const [label, data] of bad) {
    it(`rejects ${label}`, async () => {
      const r = await create(data);
      assert.equal(!r.ok && r.code, "INVALID_ARGUMENT", JSON.stringify(r));
    });
  }

  it("lists every bad field in the error details", async () => {
    const r = await create({ stop_rule: "call", stop_minutes: null, call_id: null, share_back_allowed: "yes", precision: "?" });
    const fields = !r.ok ? (r.details as { errors: { field: string }[] }).errors.map((e) => e.field) : [];
    assert.deepEqual(fields.sort(), ["precision", "share_back_allowed", "stop_rule"]);
  });

  it("accepts a 24-character name, counting an emoji as one character", async () => {
    const name = "\u{1F469}\u{1F3FD}\u200D\u{1F9B1}" + "a".repeat(23);
    const res = ok(await create({ ...manualShare, viewer_name: `  ${name}  ` }));
    const meta = await db.doc(`shareSessions/${res.session_id}/private/meta`).get();
    assert.equal(meta.get("viewer_name"), name);
    // The shared schema counts graphemes too, so the stored name is valid there.
    assert.deepEqual(validate("SessionPrivateMeta", meta.data()), []);
  });
});

describe("createSession: what it writes", () => {
  beforeEach(() => endActiveSession(alex.uid));

  it("creates an active session with a 1-hour expiry and a hashed 128-bit link token", async () => {
    const userBefore = await userOf(alex.uid);
    const t0 = Date.now();
    const res = ok(await create({ ...manualShare, viewer_name: " Mom " }));
    const t1 = Date.now();

    // Response: a valid CreateSessionResponse.
    assert.deepEqual(validate("CreateSessionResponse", res), []);
    assert.equal(res.link_token.length, LINK_TOKEN_LENGTH);
    assert.match(res.link_token, /^[A-Za-z0-9_-]{22}$/, "128-bit base64url token");
    assert.equal(res.link_url, `${VIEWER_ORIGIN}/s/${res.link_token}`);
    assert.ok(res.started_at >= t0 - 1000 && res.started_at <= t1 + 1000);
    assert.equal(res.expires_at - res.started_at, HOUR_MS);

    // Session doc: a valid ShareSession, only what the viewer may see.
    const s = await sessionOf(res.session_id);
    assert.deepEqual(validate("ShareSession", s), []);
    assert.equal(s.status, "active");
    assert.ok(s.started_at instanceof Timestamp);
    assert.equal(s.started_at.toMillis(), res.started_at);
    assert.equal(s.expires_at.toMillis(), s.started_at.toMillis() + HOUR_MS);
    assert.equal(s.expires_at.toMillis(), res.expires_at);
    assert.equal(s.stop_rule, "minutes");
    assert.equal(s.stop_minutes, 30);
    assert.equal(s.stop_at.toMillis(), res.started_at + 30 * 60_000);
    assert.equal(s.ended_at, null);
    assert.equal(s.end_reason, null);
    assert.equal(s.call_id, null);
    assert.equal(s.call_active, false);
    assert.equal(s.call_ended_at, null);
    assert.equal(s.share_back_allowed, false);
    assert.equal(s.last_ping_at.toMillis(), res.started_at);
    assert.equal(s.ping_interval_s, INITIAL_PING_INTERVAL_SECONDS);
    assert.equal(s.precision, "precise");
    assert.equal(s.precision_next, null);
    assert.equal(s.first_viewed_at, null);
    assert.equal(s.viewer_sharing, false);
    assert.equal(s.share_back_requested_at, null);
    assert.equal(s.cleaned_at, null);
    assert.deepEqual(s.sharer, { name: "Alex", mascot_id: "ninja", mascot_color: "dusk", mascot_accessory: "headphones" });

    // private/meta: owner from the auth token, token stored only as a hash.
    const meta = (await db.doc(`shareSessions/${res.session_id}/private/meta`).get()).data()!;
    assert.deepEqual(validate("SessionPrivateMeta", meta), []);
    assert.equal(meta.user_id, alex.uid);
    assert.equal(meta.link_token_hash, createHash("sha256").update(res.link_token).digest("hex"));
    assert.equal(meta.viewer_uid, null);
    assert.equal(meta.viewer_name, "Mom");
    assert.equal(meta.activity_push_token, null);
    assert.ok(!JSON.stringify([s, meta]).includes(res.link_token), "the plaintext token is never stored");

    // users: points at the new session, remembers "who it's for", still a valid User.
    const user = await userOf(alex.uid);
    assert.deepEqual(validate("User", user), []);
    assert.equal(user.active_session_id, res.session_id);
    assert.equal(user.last_viewer_name, "Mom");
    assert.ok(user.updated_at.toMillis() > userBefore.updated_at.toMillis());
    assert.equal(user.created_at.toMillis(), userBefore.created_at.toMillis());
  });

  it("ties a call-triggered share to its call", async () => {
    const res = ok(await create(callShare));
    const s = await sessionOf(res.session_id);
    assert.deepEqual(validate("ShareSession", s), []);
    assert.equal(s.stop_rule, "call");
    assert.equal(s.stop_minutes, null);
    assert.equal(s.stop_at, null);
    assert.equal(s.call_id, "call-123");
    assert.equal(s.call_active, true);
    assert.equal(s.call_ended_at, null);
    assert.equal(s.share_back_allowed, true);
    assert.equal(s.precision, "approximate");
    assert.equal(s.expires_at.toMillis() - s.started_at.toMillis(), HOUR_MS);
  });

  it("logs the call for a call-triggered share, under the session's id", async () => {
    const t0 = Date.now();
    const res = ok(await create(callShare));
    const log = (await db.doc(`callLogs/${res.session_id}`).get()).data()!;
    assert.deepEqual(validate("CallLog", log), []);
    assert.equal(log.user_id, alex.uid);
    assert.equal(log.session_id, res.session_id);
    assert.equal(log.call_id, "call-123");
    assert.ok(log.call_time.toMillis() >= t0 - 1000 && log.call_time.toMillis() <= Date.now() + 1000);
  });

  it("logs no call for a manual share", async () => {
    const res = ok(await create(manualShare));
    assert.equal((await db.doc(`callLogs/${res.session_id}`).get()).exists, false);
  });

  it("forces share back off for a manual share", async () => {
    const res = ok(await create({ ...manualShare, share_back_allowed: true }));
    assert.equal((await sessionOf(res.session_id)).share_back_allowed, false);
  });

  it("caps stop_at at expires_at (In 1 hour, and the 1-hour limit)", async () => {
    for (const rule of [{ stop_rule: "minutes", stop_minutes: 60 }, { stop_rule: "limit", stop_minutes: null }]) {
      await endActiveSession(alex.uid);
      const s = await sessionOf(ok(await create({ ...manualShare, ...rule })).session_id);
      assert.equal(s.stop_at.toMillis(), s.expires_at.toMillis());
    }
  });

  it("gives every session its own id and token", async () => {
    const a = ok(await create(manualShare));
    await endActiveSession(alex.uid);
    const b = ok(await create(manualShare));
    assert.notEqual(a.session_id, b.session_id);
    assert.notEqual(a.link_token, b.link_token);
  });
});

describe("createSession: one session at a time", () => {
  beforeEach(() => endActiveSession(alex.uid));

  it("refuses a second share while one is active, naming the active one", async () => {
    const first = ok(await create(manualShare));
    const second = await create(callShare);
    assert.equal(!second.ok && second.code, "ALREADY_EXISTS");
    assert.deepEqual(!second.ok && second.details, { reason: "active_session", session_id: first.session_id });
    assert.equal((await userOf(alex.uid)).active_session_id, first.session_id);
  });

  it("allows a new share once the active one has stopped", async () => {
    ok(await create(manualShare));
    await endActiveSession(alex.uid);
    ok(await create(manualShare));
  });

  it("ends a session past its limit on the spot, in the same transaction, as limit at expires_at", async () => {
    const overdue = ok(await create(callShare));
    // Still "active", but past expires_at: the stop job just hasn't run yet.
    const expiresAt = Timestamp.fromMillis(Date.now() - 1000);
    await db.doc(`shareSessions/${overdue.session_id}`).update({ expires_at: expiresAt, viewer_sharing: true });
    const next = ok(await create(manualShare));

    const old = await sessionOf(overdue.session_id);
    assert.deepEqual(validate("ShareSession", old), []);
    assert.equal(old.status, "stopped");
    assert.equal(old.end_reason, "limit");
    assert.equal(old.ended_at.toMillis(), expiresAt.toMillis());
    assert.equal(old.viewer_sharing, false);
    assert.equal(old.cleaned_at, null);
    assert.equal((await userOf(alex.uid)).active_session_id, next.session_id);
  });

  it("ends a session past its timer on the spot as timer, at stop_at", async () => {
    const overdue = ok(await create(manualShare));
    const stopAt = Timestamp.fromMillis(Date.now() - 1000);
    await db.doc(`shareSessions/${overdue.session_id}`).update({ stop_at: stopAt });
    ok(await create(manualShare));

    const old = await sessionOf(overdue.session_id);
    assert.equal(old.status, "stopped");
    assert.equal(old.end_reason, "timer");
    assert.equal(old.ended_at.toMillis(), stopAt.toMillis());
  });

  it("force-ends a session behind the pointer that doesn't match the schema, instead of leaving it active", async () => {
    const broken = ok(await create(manualShare));
    await db.doc(`shareSessions/${broken.session_id}`).update({ sharer: FieldValue.delete(), ping_interval_s: "fast", viewer_sharing: true });
    const t0 = Date.now();
    const next = ok(await create(manualShare));

    const old = await sessionOf(broken.session_id);
    assert.equal(old.status, "stopped");
    // Its timer and limit are still ahead, so it ends now, as limit.
    assert.equal(old.end_reason, "limit");
    assert.ok(old.ended_at.toMillis() >= t0 - 1000 && old.ended_at.toMillis() <= Date.now() + 1000);
    assert.equal(old.viewer_sharing, false);
    assert.equal(old.cleaned_at, null);
    assert.equal((await userOf(alex.uid)).active_session_id, next.session_id);
  });

  it("isn't blocked by a pointer at a session that stopped or is gone, and leaves a stopped one as it was", async () => {
    const stopped = ok(await create(manualShare));
    const endedAt = Timestamp.fromMillis(Date.now() - 5000);
    await db.doc(`shareSessions/${stopped.session_id}`).update({ status: "stopped", ended_at: endedAt, end_reason: "timer" });
    const next = ok(await create(manualShare));
    const old = await sessionOf(stopped.session_id);
    assert.equal(old.end_reason, "timer");
    assert.equal(old.ended_at.toMillis(), endedAt.toMillis());

    // Points at a session that no longer exists.
    await db.doc(`shareSessions/${next.session_id}`).delete();
    ok(await create(manualShare));
  });

  it("lets only one of two simultaneous shares win", async () => {
    const results = await Promise.all([create(manualShare), create(callShare)]);
    const wins = results.filter((r) => r.ok);
    const losses = results.filter((r) => !r.ok);
    assert.equal(wins.length, 1, JSON.stringify(results));
    assert.equal(!losses[0]!.ok && losses[0]!.code, "ALREADY_EXISTS");
    const winner = wins[0]!.ok ? wins[0]!.data.session_id : "";
    assert.equal((await userOf(alex.uid)).active_session_id, winner);
  });
});
