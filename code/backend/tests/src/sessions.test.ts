/**
 * The session callables against the emulators: stopSession, reportCallEnded,
 * reportCallActive and discardSession, called over the callable protocol by a
 * real phone sign-in, on sessions createSession made. Every doc and response is
 * checked with the shared schema's validate().
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  DEFAULT_USER_SETTINGS,
  validate,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type DiscardSessionResponse,
  type ReportCallActiveResponse,
  type ReportCallEndedResponse,
  type SchemaDefName,
  type StopSessionResponse,
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

const MIN = 60_000;

let app: App;
let db: Firestore;
let alex: SignedIn;
let bob: SignedIn;

const callShare: CreateSessionRequest = { stop_rule: "call", stop_minutes: null, call_id: "call-123", share_back_allowed: true, precision: "precise" };
const timerCallShare: CreateSessionRequest = { ...callShare, stop_rule: "minutes", stop_minutes: 30 };
const manualShare: CreateSessionRequest = { stop_rule: "minutes", stop_minutes: 30, call_id: null, share_back_allowed: false, precision: "precise" };

function ok<T>(r: CallableResult<T>): T {
  assert.ok(r.ok, JSON.stringify(r));
  return r.data;
}

/** The error code, and details.reason for a failed-precondition. */
function failure(r: CallableResult<unknown>): { code: string; reason?: unknown } {
  assert.ok(!r.ok, `expected an error, got ${JSON.stringify(r)}`);
  return { code: r.code, reason: (r.details as { reason?: unknown } | undefined)?.reason };
}

function valid<T>(def: SchemaDefName, value: T): T {
  assert.deepEqual(validate(def, value), []);
  return value;
}

const call = <T>(name: string, data: unknown, who: SignedIn | null = alex) => callFunction<T>(name, data, who?.idToken);
const stop = (sessionId: string, who?: SignedIn | null) => call<StopSessionResponse>("stopSession", { session_id: sessionId }, who);
const callEnded = (sessionId: string, callId = "call-123", who?: SignedIn | null) =>
  call<ReportCallEndedResponse>("reportCallEnded", { session_id: sessionId, call_id: callId }, who);
const callActive = (sessionId: string, callId = "call-123", who?: SignedIn | null) =>
  call<ReportCallActiveResponse>("reportCallActive", { session_id: sessionId, call_id: callId }, who);
const discard = (sessionId: string, who?: SignedIn | null) => call<DiscardSessionResponse>("discardSession", { session_id: sessionId }, who);

const sessionRef = (id: string) => db.doc(`shareSessions/${id}`);
const sessionOf = async (id: string) => (await sessionRef(id).get()).data()!;
const pointerOf = async (uid: string) => (await db.doc(`users/${uid}`).get()).get("active_session_id") as string | null;

/** A new share by Alex, after ending whatever Alex was sharing. */
async function share(request: CreateSessionRequest): Promise<string> {
  const active = await pointerOf(alex.uid);
  if (active) ok(await stop(active));
  return ok(await call<CreateSessionResponse>("createSession", request)).session_id;
}

before(async () => {
  await clearFirestore();
  await clearAuth();
  app = initializeApp({ projectId: PROJECT_ID }, "sessions-test");
  db = getFirestore(app);
  alex = await signInWithPhone("+15555550301");
  bob = await signInWithPhone("+15555550302");
  const t = Timestamp.now();
  for (const who of [alex, bob]) {
    await db.doc(`users/${who.uid}`).set(valid("User", {
      name: "Alex", mascot_id: "fox", mascot_color: "original", mascot_accessory: null,
      last_viewer_name: null, settings: DEFAULT_USER_SETTINGS, active_session_id: null, created_at: t, updated_at: t,
    }));
  }
});

after(async () => {
  if (app) await deleteApp(app);
});

describe("every session callable: who may call it, and with what", () => {
  const callables: [string, (id: string, who?: SignedIn | null) => Promise<CallableResult<unknown>>][] = [
    ["stopSession", stop],
    ["reportCallEnded", (id, who) => callEnded(id, "call-123", who)],
    ["reportCallActive", (id, who) => callActive(id, "call-123", who)],
    ["discardSession", discard],
  ];
  let sessionId: string;
  before(async () => {
    sessionId = await share(callShare);
  });

  for (const [name, fn] of callables) {
    describe(name, () => {
      it("needs a phone sign-in", async () => {
        assert.equal(failure(await fn(sessionId, null)).code, "UNAUTHENTICATED");
        assert.equal(failure(await fn(sessionId, await signInAnonymously())).code, "PERMISSION_DENIED");
      });

      it("answers not-found for a session that isn't the caller's, or doesn't exist", async () => {
        assert.equal(failure(await fn(sessionId, bob)).code, "NOT_FOUND");
        assert.equal(failure(await fn("no-such-session")).code, "NOT_FOUND");
      });

      it("rejects a malformed request, listing the fields", async () => {
        for (const bad of [null, {}, { session_id: "" }, { session_id: 7 }, { session_id: "a/b" }, { session_id: sessionId, call_id: "call-123", user_id: "x" }]) {
          const r = await call(name, bad);
          assert.equal(failure(r).code, "INVALID_ARGUMENT", JSON.stringify(bad));
          assert.ok(!r.ok && (r.details as { errors: unknown[] }).errors.length > 0);
        }
      });
    });
  }

  it("leaves the session untouched", async () => {
    const s = await sessionOf(sessionId);
    assert.equal(s.status, "active");
    assert.equal(s.call_active, true);
  });
});

describe("stopSession", () => {
  it("ends the share now, turns share back off and clears the pointer", async () => {
    const id = await share(callShare);
    await sessionRef(id).update({ viewer_sharing: true });
    const t0 = Date.now();
    const res = valid("StopSessionResponse", ok(await stop(id)));
    const s = valid("ShareSession", await sessionOf(id));
    assert.equal(s.status, "stopped");
    assert.equal(s.end_reason, "stopped");
    assert.equal(s.viewer_sharing, false);
    assert.ok(s.ended_at.toMillis() >= t0 - 1000 && s.ended_at.toMillis() <= Date.now() + 1000);
    assert.deepEqual(res, { session_id: id, ended_at: s.ended_at.toMillis(), end_reason: "stopped" });
    assert.equal(await pointerOf(alex.uid), null);
  });

  it("is idempotent: stopping again returns the same end and changes nothing", async () => {
    const id = await share(manualShare);
    const first = ok(await stop(id));
    const before = (await sessionRef(id).get()).updateTime;
    assert.deepEqual(ok(await stop(id)), first);
    assert.ok((await sessionRef(id).get()).updateTime?.isEqual(before!));
  });

  it("ends a session already past its timer as timer, at stop_at, or past its limit as limit, at expires_at", async () => {
    const timer = await share(manualShare);
    const stopAt = Timestamp.fromMillis(Date.now() - 1000);
    await sessionRef(timer).update({ stop_at: stopAt });
    assert.deepEqual(ok(await stop(timer)), { session_id: timer, ended_at: stopAt.toMillis(), end_reason: "timer" });

    const limit = await share(callShare);
    const expiresAt = Timestamp.fromMillis(Date.now() - 1000);
    await sessionRef(limit).update({ expires_at: expiresAt });
    assert.deepEqual(ok(await stop(limit)), { session_id: limit, ended_at: expiresAt.toMillis(), end_reason: "limit" });
  });

  it("leaves the pointer alone when it points at a newer share", async () => {
    const old = await share(manualShare);
    const current = await share(manualShare);
    ok(await stop(old));
    assert.equal(await pointerOf(alex.uid), current);
  });
});

describe("reportCallEnded", () => {
  it("with the call stop rule: ends the share (end_reason call) and turns share back off", async () => {
    const id = await share(callShare);
    await sessionRef(id).update({ viewer_sharing: true });
    const res = valid("ReportCallEndedResponse", ok(await callEnded(id)));
    const s = valid("ShareSession", await sessionOf(id));
    assert.equal(s.status, "stopped");
    assert.equal(s.end_reason, "call");
    assert.equal(s.call_active, false);
    assert.equal(s.viewer_sharing, false);
    assert.ok(s.call_ended_at && s.ended_at);
    assert.equal(s.call_ended_at.toMillis(), s.ended_at.toMillis());
    assert.deepEqual(res, { session_id: id, status: "stopped", call_ended_at: s.call_ended_at.toMillis(), ended_at: s.ended_at.toMillis(), end_reason: "call" });
    assert.equal(await pointerOf(alex.uid), null);
  });

  it("with a timer: sharing keeps going, but the call is over for good", async () => {
    const id = await share(timerCallShare);
    await sessionRef(id).update({ viewer_sharing: true });
    const res = valid("ReportCallEndedResponse", ok(await callEnded(id)));
    const s = valid("ShareSession", await sessionOf(id));
    assert.equal(s.status, "active");
    assert.equal(s.call_active, false);
    assert.equal(s.viewer_sharing, false);
    assert.ok(s.call_ended_at);
    assert.deepEqual(res, { session_id: id, status: "active", call_ended_at: s.call_ended_at.toMillis(), ended_at: null, end_reason: null });
    assert.equal(await pointerOf(alex.uid), id);
  });

  it("is idempotent: a second report returns the same state and changes nothing", async () => {
    const id = await share(timerCallShare);
    const first = ok(await callEnded(id));
    const before = (await sessionRef(id).get()).updateTime;
    assert.deepEqual(ok(await callEnded(id)), first);
    assert.ok((await sessionRef(id).get()).updateTime?.isEqual(before!));
  });

  it("changes nothing on a session that has already ended", async () => {
    const id = await share(timerCallShare);
    const stopped = ok(await stop(id));
    assert.deepEqual(ok(await callEnded(id)), {
      session_id: id, status: "stopped", call_ended_at: null, ended_at: stopped.ended_at, end_reason: "stopped",
    });
    assert.equal((await sessionOf(id)).call_active, true);
  });

  it("ends a session already past its timer as timer, not call", async () => {
    const id = await share(timerCallShare);
    const stopAt = Timestamp.fromMillis(Date.now() - 1000);
    await sessionRef(id).update({ stop_at: stopAt });
    const res = ok(await callEnded(id));
    assert.deepEqual(res, { session_id: id, status: "stopped", call_ended_at: null, ended_at: stopAt.toMillis(), end_reason: "timer" });
  });

  it("refuses a manual share (no_call) and another call (call_mismatch)", async () => {
    const manual = await share(manualShare);
    assert.deepEqual(failure(await callEnded(manual)), { code: "FAILED_PRECONDITION", reason: "no_call" });
    const onCall = await share(callShare);
    assert.deepEqual(failure(await callEnded(onCall, "call-999")), { code: "FAILED_PRECONDITION", reason: "call_mismatch" });
    assert.equal((await sessionOf(onCall)).call_active, true);
  });
});

describe("reportCallActive", () => {
  it("sets call_active again after the watchdog cleared it, and checks in", async () => {
    const id = await share(callShare);
    await sessionRef(id).update({ call_active: false, last_ping_at: Timestamp.fromMillis(Date.now() - 3 * MIN) });
    const t0 = Date.now();
    const res = valid("ReportCallActiveResponse", ok(await callActive(id)));
    const s = valid("ShareSession", await sessionOf(id));
    assert.equal(s.call_active, true);
    assert.equal(s.last_ping_at.toMillis(), res.last_ping_at);
    assert.ok(res.last_ping_at >= t0 - 1000);
  });

  it("is idempotent", async () => {
    const id = await share(callShare);
    ok(await callActive(id));
    ok(await callActive(id));
    assert.equal((await sessionOf(id)).call_active, true);
  });

  it("after call_ended_at, call_active never comes back", async () => {
    const id = await share(timerCallShare);
    ok(await callEnded(id));
    assert.deepEqual(failure(await callActive(id)), { code: "FAILED_PRECONDITION", reason: "call_ended" });
    assert.equal((await sessionOf(id)).call_active, false);
  });

  it("refuses an ended session: stopped, past its timer, or past its limit", async () => {
    const stopped = await share(callShare);
    ok(await stop(stopped));
    assert.deepEqual(failure(await callActive(stopped)), { code: "FAILED_PRECONDITION", reason: "session_ended" });

    for (const field of ["stop_at", "expires_at"]) {
      const id = await share(timerCallShare);
      await sessionRef(id).update({ call_active: false, [field]: Timestamp.fromMillis(Date.now() - 1000) });
      assert.deepEqual(failure(await callActive(id)), { code: "FAILED_PRECONDITION", reason: "session_ended" });
      assert.equal((await sessionOf(id)).call_active, false);
    }
  });

  it("refuses a manual share (no_call) and another call (call_mismatch)", async () => {
    const manual = await share(manualShare);
    assert.deepEqual(failure(await callActive(manual)), { code: "FAILED_PRECONDITION", reason: "no_call" });
    assert.equal((await sessionOf(manual)).call_active, false);
    const onCall = await share(callShare);
    await sessionRef(onCall).update({ call_active: false });
    assert.deepEqual(failure(await callActive(onCall, "call-999")), { code: "FAILED_PRECONDITION", reason: "call_mismatch" });
    assert.equal((await sessionOf(onCall)).call_active, false);
  });
});

describe("discardSession", () => {
  it("deletes an unopened share and everything under it, and frees the user to share again", async () => {
    const id = await share(callShare);
    await db.collection(`shareSessions/${id}/pings`).add({ lat: 1, lng: 2, accuracy_m: 8, recorded_at: Timestamp.now() });
    assert.ok((await db.doc(`callLogs/${id}`).get()).exists);

    assert.deepEqual(valid("DiscardSessionResponse", ok(await discard(id))), { session_id: id });
    assert.equal((await sessionRef(id).get()).exists, false);
    assert.equal((await db.doc(`shareSessions/${id}/private/meta`).get()).exists, false);
    assert.equal((await db.collection(`shareSessions/${id}/pings`).get()).size, 0);
    assert.equal((await db.doc(`callLogs/${id}`).get()).exists, false);
    assert.equal(await pointerOf(alex.uid), null);
    ok(await call<CreateSessionResponse>("createSession", manualShare));
  });

  it("answers not-found on a retry", async () => {
    const id = await share(manualShare);
    ok(await discard(id));
    assert.equal(failure(await discard(id)).code, "NOT_FOUND");
  });

  it("refuses once the link has been opened, and deletes nothing", async () => {
    const id = await share(callShare);
    await sessionRef(id).update({ first_viewed_at: Timestamp.now() });
    assert.deepEqual(failure(await discard(id)), { code: "FAILED_PRECONDITION", reason: "link_opened" });
    assert.equal((await sessionOf(id)).status, "active");
    assert.ok((await db.doc(`shareSessions/${id}/private/meta`).get()).exists);
    assert.ok((await db.doc(`callLogs/${id}`).get()).exists);
    assert.equal(await pointerOf(alex.uid), id);
  });
});
