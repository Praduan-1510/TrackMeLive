/**
 * The scheduled jobs: stopDueSessions, callWatchdog, cleanupEndedSessions and
 * purgeEndedSessions. Each test seeds Firestore and Auth with the Admin SDK,
 * runs the deployed function's handler directly at a chosen schedule time
 * (functions/lib, the code the emulator runs), and reads back what it did. The
 * Functions emulator never runs them on a schedule (there is no Pub/Sub
 * emulator), so nothing else touches the data meanwhile.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  DEFAULT_USER_SETTINGS,
  validate,
  type CreateSessionResponse,
} from "../../../shared/schema/generated/ts/schema.ts";
import { PROJECT_ID, callFunction, clearAuth, clearFirestore, signInWithPhone } from "./emulators.ts";
import { callWatchdog, cleanupEndedSessions, purgeEndedSessions, stopDueSessions } from "../../functions/lib/index.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let app: App;
let db: Firestore;
let auth: Auth;

type Job = typeof stopDueSessions;
/** Runs a job as Cloud Scheduler would, scheduled for `ms`. */
const runAt = async (job: Job, ms: number) => {
  await job.run({ scheduleTime: new Date(ms).toISOString() });
};

const at = (ms: number) => Timestamp.fromMillis(ms);

/** A live call share that stops with the call, as createSession writes it. */
function sessionDoc(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  const session = {
    status: "active",
    started_at: at(now - 5 * MIN),
    expires_at: at(now + 55 * MIN),
    stop_rule: "call",
    stop_minutes: null,
    stop_at: null,
    ended_at: null,
    end_reason: null,
    call_id: "call-1",
    call_active: true,
    call_ended_at: null,
    share_back_allowed: true,
    last_ping_at: at(now - 10_000),
    ping_interval_s: 5,
    precision: "precise",
    precision_next: null,
    sharer: { name: "Alex", mascot_id: "fox", mascot_color: "original", mascot_accessory: null },
    first_viewed_at: at(now - 4 * MIN),
    viewer_sharing: false,
    share_back_requested_at: null,
    cleaned_at: null,
    ...overrides,
  };
  assert.deepEqual(validate("ShareSession", session), []);
  return session;
}

/** A call share on a 30-minute timer. */
const timerSession = (overrides: Record<string, unknown> = {}) =>
  sessionDoc({ stop_rule: "minutes", stop_minutes: 30, stop_at: at(Date.now() + 25 * MIN), ...overrides });

/** A session that ended `ago` ms ago. */
const endedSession = (ago: number) =>
  sessionDoc({
    status: "stopped",
    started_at: at(Date.now() - ago - 10 * MIN),
    expires_at: at(Date.now() - ago + 50 * MIN),
    ended_at: at(Date.now() - ago),
    end_reason: "stopped",
  });

const ping = () => ({ lat: 51.5, lng: -0.12, accuracy_m: 8, recorded_at: Timestamp.now() });

interface Seed {
  /** The sharer; default "alice". null for a session whose private/meta is gone. */
  owner?: string | null;
  /** Whether users/{owner}.active_session_id points at it; default true. */
  pointer?: boolean;
  pings?: number;
  viewerPings?: number;
  /** Viewer page sign-ins: viewerSignIns docs, each with an Auth user unless listed in noAuthUser. */
  viewers?: string[];
  noAuthUser?: string[];
  callLog?: boolean;
}

async function seed(id: string, session: Record<string, unknown>, opts: Seed = {}): Promise<void> {
  const { owner = "alice", pointer = true, pings = 0, viewerPings = 0, viewers = [], noAuthUser = [], callLog = false } = opts;
  const batch = db.batch();
  const ref = db.doc(`shareSessions/${id}`);
  batch.set(ref, session);
  if (owner !== null) {
    batch.set(ref.collection("private").doc("meta"), {
      user_id: owner, link_token_hash: "0".repeat(64), viewer_uid: viewers[0] ?? null, viewer_name: null, activity_push_token: null,
    });
    if (pointer) batch.set(db.doc(`users/${owner}`), userDoc(id));
  }
  for (let i = 0; i < pings; i++) batch.set(ref.collection("pings").doc(), ping());
  for (let i = 0; i < viewerPings; i++) batch.set(ref.collection("viewerPings").doc(), ping());
  viewers.forEach((uid, i) => batch.set(ref.collection("viewerSignIns").doc(uid), { role: i === 0 ? "viewer" : "watcher", created_at: Timestamp.now() }));
  if (callLog) batch.set(db.doc(`callLogs/${id}`), { user_id: owner ?? "alice", session_id: id, call_id: "call-1", call_time: Timestamp.now() });
  await batch.commit();
  for (const uid of viewers.filter((v) => !noAuthUser.includes(v))) await auth.createUser({ uid });
}

function userDoc(activeSessionId: string | null) {
  const t = at(Date.now() - DAY);
  return {
    name: "Alex", mascot_id: "fox", mascot_color: "original", mascot_accessory: null, last_viewer_name: null,
    settings: DEFAULT_USER_SETTINGS, active_session_id: activeSessionId, created_at: t, updated_at: t,
  };
}

const sessionOf = async (id: string) => (await db.doc(`shareSessions/${id}`).get()).data()!;
const updateTimeOf = async (path: string) => (await db.doc(path).get()).updateTime!;
const exists = async (path: string) => (await db.doc(path).get()).exists;
const count = async (path: string) => (await db.collection(path).count().get()).data().count;
const authUserExists = (uid: string) => auth.getUser(uid).then(() => true, () => false);

before(async () => {
  app = initializeApp({ projectId: PROJECT_ID }, "lifecycle-test");
  db = getFirestore(app);
  auth = getAuth(app);
});

beforeEach(async () => {
  await clearFirestore();
  await clearAuth();
});

after(async () => {
  if (app) await deleteApp(app);
});

describe("stopDueSessions", () => {
  it("stops a session at its 1-hour limit: limit, at expires_at, share back off, pointer cleared", async () => {
    const expiresAt = at(Date.now() - 1000);
    await seed("s1", sessionDoc({ started_at: at(Date.now() - 61 * MIN), expires_at: expiresAt, viewer_sharing: true }));
    const userBefore = await updateTimeOf("users/alice");
    await runAt(stopDueSessions, Date.now());

    const s = await sessionOf("s1");
    assert.deepEqual(validate("ShareSession", s), []);
    assert.equal(s.status, "stopped");
    assert.equal(s.end_reason, "limit");
    assert.equal(s.ended_at.toMillis(), expiresAt.toMillis());
    assert.equal(s.viewer_sharing, false);
    const user = (await db.doc("users/alice").get()).data()!;
    assert.equal(user.active_session_id, null);
    assert.ok(user.updated_at.toMillis() > userBefore.toMillis() - 1000);
    assert.deepEqual(validate("User", user), []);
  });

  it("stops a session at its timer: timer, at stop_at", async () => {
    const stopAt = at(Date.now() - 1000);
    await seed("s1", timerSession({ stop_at: stopAt }));
    await runAt(stopDueSessions, Date.now());
    const s = await sessionOf("s1");
    assert.equal(s.status, "stopped");
    assert.equal(s.end_reason, "timer");
    assert.equal(s.ended_at.toMillis(), stopAt.toMillis());
  });

  it("a timer set at the limit ends as limit", async () => {
    const limit = at(Date.now() - 1000);
    await seed("s1", sessionDoc({ stop_rule: "limit", stop_at: limit, expires_at: limit, started_at: at(Date.now() - 61 * MIN) }));
    await runAt(stopDueSessions, Date.now());
    assert.equal((await sessionOf("s1")).end_reason, "limit");
  });

  it("leaves live and ended sessions alone", async () => {
    await seed("live-call", sessionDoc(), { owner: "a" });
    await seed("live-timer", timerSession(), { owner: "b" });
    await seed("ended", sessionDoc({ status: "stopped", ended_at: at(Date.now() - 2 * MIN), end_reason: "stopped", expires_at: at(Date.now() - MIN), started_at: at(Date.now() - 61 * MIN) }), { owner: "c", pointer: false });
    const before = await Promise.all(["live-call", "live-timer", "ended"].map((id) => updateTimeOf(`shareSessions/${id}`)));
    await runAt(stopDueSessions, Date.now());
    const afterRun = await Promise.all(["live-call", "live-timer", "ended"].map((id) => updateTimeOf(`shareSessions/${id}`)));
    afterRun.forEach((t, i) => assert.ok(t.isEqual(before[i]!)));
    assert.equal((await sessionOf("ended")).end_reason, "stopped");
  });

  it("leaves a pointer at another session alone, and ends a session whose meta is gone", async () => {
    await seed("old", timerSession({ stop_at: at(Date.now() - 1000) }), { pointer: false });
    await db.doc("users/alice").set(userDoc("new"));
    await seed("orphan", timerSession({ stop_at: at(Date.now() - 1000) }), { owner: null });
    await runAt(stopDueSessions, Date.now());
    assert.equal((await sessionOf("old")).status, "stopped");
    assert.equal((await sessionOf("orphan")).status, "stopped");
    assert.equal((await db.doc("users/alice").get()).get("active_session_id"), "new");
  });

  it("works through more than one page of due sessions", async () => {
    const batch = db.batch();
    for (let i = 0; i < 120; i++) {
      batch.set(db.doc(`shareSessions/due-${i}`), timerSession({ stop_at: at(Date.now() - 1000 - i) }));
    }
    await batch.commit();
    await runAt(stopDueSessions, Date.now());
    const stillActive = await db.collection("shareSessions").where("status", "==", "active").count().get();
    assert.equal(stillActive.data().count, 0);
  });

  it("force-ends a due session that doesn't match the schema, from its raw fields, and it is cleaned 24 h later", async () => {
    const expiresAt = at(Date.now() - 1000);
    // No sharer snapshot and no cleaned_at: it fails the schema check.
    const { sharer: _, cleaned_at: __, ...broken } = sessionDoc({ started_at: at(Date.now() - 61 * MIN), expires_at: expiresAt, viewer_sharing: true });
    await seed("broken", broken, { pings: 1 });
    await runAt(stopDueSessions, Date.now());

    const s = await sessionOf("broken");
    assert.equal(s.status, "stopped");
    assert.equal(s.end_reason, "limit");
    assert.equal(s.ended_at.toMillis(), expiresAt.toMillis());
    assert.equal(s.viewer_sharing, false);
    assert.equal(s.cleaned_at, null);
    assert.equal((await db.doc("users/alice").get()).get("active_session_id"), null);

    await runAt(cleanupEndedSessions, expiresAt.toMillis() + 25 * HOUR);
    assert.equal(await count("shareSessions/broken/pings"), 0);
  });

  it("a malformed session's timer, when it came first, makes it timer; a malformed stopped one is left alone", async () => {
    const stopAt = at(Date.now() - 2000);
    await seed("timer", { status: "active", stop_at: stopAt, expires_at: at(Date.now() + 10 * MIN) }, { owner: "a" });
    await seed("stopped", { status: "stopped", stop_at: stopAt, ended_at: stopAt }, { owner: "b", pointer: false });
    const before = await updateTimeOf("shareSessions/stopped");
    await runAt(stopDueSessions, Date.now());
    const s = await sessionOf("timer");
    assert.equal(s.status, "stopped");
    assert.equal(s.end_reason, "timer");
    assert.equal(s.ended_at.toMillis(), stopAt.toMillis());
    assert.ok((await updateTimeOf("shareSessions/stopped")).isEqual(before));
  });

  it("is idempotent: a second run changes nothing", async () => {
    await seed("s1", timerSession({ stop_at: at(Date.now() - 1000) }));
    await runAt(stopDueSessions, Date.now());
    const first = await updateTimeOf("shareSessions/s1");
    const user = await updateTimeOf("users/alice");
    await runAt(stopDueSessions, Date.now() + MIN);
    assert.ok((await updateTimeOf("shareSessions/s1")).isEqual(first));
    assert.ok((await updateTimeOf("users/alice")).isEqual(user));
  });
});

describe("callWatchdog", () => {
  it("clears call_active and viewer_sharing once the app has been silent for 2 minutes", async () => {
    await seed("call", sessionDoc({ last_ping_at: at(Date.now() - 150_000), viewer_sharing: true }), { owner: "a" });
    await seed("timer", timerSession({ last_ping_at: at(Date.now() - 150_000), viewer_sharing: true }), { owner: "b" });
    await runAt(callWatchdog, Date.now());
    for (const id of ["call", "timer"]) {
      const s = await sessionOf(id);
      assert.equal(s.status, "active");
      assert.equal(s.call_active, false);
      assert.equal(s.viewer_sharing, false);
      assert.equal(s.call_ended_at, null, "the watchdog never sets call_ended_at");
    }
  });

  it("leaves a share that checked in under 2 minutes ago alone", async () => {
    await seed("s1", sessionDoc({ last_ping_at: at(Date.now() - 90_000), viewer_sharing: true }));
    const before = await updateTimeOf("shareSessions/s1");
    await runAt(callWatchdog, Date.now());
    assert.ok((await updateTimeOf("shareSessions/s1")).isEqual(before));
  });

  it("stops a share that stops with the call 10 minutes after that: call, at the run time, pointer cleared", async () => {
    await seed("s1", sessionDoc({ last_ping_at: at(Date.now() - 13 * MIN), call_active: false }));
    const runTime = Date.now();
    await runAt(callWatchdog, runTime);
    const s = await sessionOf("s1");
    assert.deepEqual(validate("ShareSession", s), []);
    assert.equal(s.status, "stopped");
    assert.equal(s.end_reason, "call");
    assert.equal(s.ended_at.toMillis(), runTime);
    assert.equal((await db.doc("users/alice").get()).get("active_session_id"), null);
  });

  it("doesn't stop a call share silent for 11 minutes, or a timer share silent for longer", async () => {
    await seed("call", sessionDoc({ last_ping_at: at(Date.now() - 11 * MIN) }), { owner: "a" });
    await seed("timer", timerSession({ last_ping_at: at(Date.now() - 20 * MIN) }), { owner: "b" });
    await runAt(callWatchdog, Date.now());
    for (const id of ["call", "timer"]) {
      const s = await sessionOf(id);
      assert.equal(s.status, "active");
      assert.equal(s.call_active, false);
    }
  });

  it("a silent call share already past its limit ends as limit", async () => {
    const expiresAt = at(Date.now() - 1000);
    await seed("s1", sessionDoc({ started_at: at(Date.now() - 61 * MIN), expires_at: expiresAt, last_ping_at: at(Date.now() - 13 * MIN) }));
    await runAt(callWatchdog, Date.now());
    const s = await sessionOf("s1");
    assert.equal(s.end_reason, "limit");
    assert.equal(s.ended_at.toMillis(), expiresAt.toMillis());
  });

  it("is idempotent: a second run changes nothing", async () => {
    await seed("s1", sessionDoc({ last_ping_at: at(Date.now() - 150_000) }));
    await runAt(callWatchdog, Date.now());
    const first = await updateTimeOf("shareSessions/s1");
    await runAt(callWatchdog, Date.now());
    assert.ok((await updateTimeOf("shareSessions/s1")).isEqual(first));
  });

  it("after a signal gap, reportCallActive brings call_active back while the same call is connected", async () => {
    const sharer = await signInWithPhone("+15555550401");
    await db.doc(`users/${sharer.uid}`).set(userDoc(null));
    const created = await callFunction<CreateSessionResponse>("createSession", {
      stop_rule: "call", stop_minutes: null, call_id: "call-9", share_back_allowed: true, precision: "precise",
    }, sharer.idToken);
    assert.ok(created.ok, JSON.stringify(created));
    const id = created.data.session_id;
    await db.doc(`shareSessions/${id}`).update({ last_ping_at: at(Date.now() - 3 * MIN) });

    await runAt(callWatchdog, Date.now());
    assert.equal((await sessionOf(id)).call_active, false);

    const back = await callFunction("reportCallActive", { session_id: id, call_id: "call-9" }, sharer.idToken);
    assert.ok(back.ok, JSON.stringify(back));
    assert.equal((await sessionOf(id)).call_active, true);
  });
});

describe("cleanupEndedSessions", () => {
  it("24 hours after the end: deletes pings, viewer pings, sign-ins and their Auth users; keeps the session, meta and call log", async () => {
    await seed("s1", endedSession(25 * HOUR), { pointer: false, pings: 3, viewerPings: 2, viewers: ["v_s1_a", "v_s1_b"], callLog: true });
    await runAt(cleanupEndedSessions, Date.now());

    assert.equal(await count("shareSessions/s1/pings"), 0);
    assert.equal(await count("shareSessions/s1/viewerPings"), 0);
    assert.equal(await count("shareSessions/s1/viewerSignIns"), 0);
    assert.equal(await authUserExists("v_s1_a"), false);
    assert.equal(await authUserExists("v_s1_b"), false);
    assert.ok(await exists("shareSessions/s1"));
    assert.ok(await exists("shareSessions/s1/private/meta"));
    assert.ok(await exists("callLogs/s1"));
  });

  it("leaves a session that ended under 24 hours ago, and a live one, alone", async () => {
    await seed("recent", endedSession(23 * HOUR), { owner: "a", pointer: false, pings: 1, viewers: ["v_recent_a"] });
    await seed("live", sessionDoc(), { owner: "b", pings: 1, viewers: ["v_live_a"] });
    await runAt(cleanupEndedSessions, Date.now());
    for (const id of ["recent", "live"]) {
      assert.equal(await count(`shareSessions/${id}/pings`), 1);
      assert.equal(await count(`shareSessions/${id}/viewerSignIns`), 1);
      assert.ok(await authUserExists(`v_${id}_a`));
    }
  });

  it("marks what it cleaned, and a later run leaves it alone", async () => {
    const t = Date.now();
    await seed("s1", endedSession(25 * HOUR), { pointer: false, pings: 1 });
    await runAt(cleanupEndedSessions, t);
    const s = await sessionOf("s1");
    assert.deepEqual(validate("ShareSession", s), []);
    assert.equal(s.cleaned_at.toMillis(), t);
    const cleaned = await updateTimeOf("shareSessions/s1");
    await runAt(cleanupEndedSessions, t + HOUR);
    assert.ok((await updateTimeOf("shareSessions/s1")).isEqual(cleaned));
  });

  it("cleans a session ended late, with ended_at set back to when it was due, on the next run", async () => {
    const t = Date.now();
    await runAt(cleanupEndedSessions, t);
    // Stopped after the run above (createSession closing an overdue session, or
    // the stop job after an outage), with ended_at already more than 24 h back.
    await seed("late", endedSession(26 * HOUR), { pointer: false, pings: 2, viewers: ["v_late_a"] });
    await runAt(cleanupEndedSessions, t + MIN);
    assert.equal(await count("shareSessions/late/pings"), 0);
    assert.equal(await authUserExists("v_late_a"), false);
    assert.equal((await sessionOf("late")).cleaned_at.toMillis(), t + MIN);
  });

  it("is idempotent: a viewer Auth user that is already gone counts as deleted, and a repeat run is fine", async () => {
    await seed("s1", endedSession(25 * HOUR), { pointer: false, pings: 1, viewers: ["v_s1_a", "v_s1_gone"], noAuthUser: ["v_s1_gone"] });
    await runAt(cleanupEndedSessions, Date.now());
    assert.equal(await count("shareSessions/s1/viewerSignIns"), 0);
    assert.equal(await authUserExists("v_s1_a"), false);
    await runAt(cleanupEndedSessions, Date.now());
  });
});

describe("purgeEndedSessions", () => {
  it("30 days after the end: deletes the session, meta, everything under it, its call log and any leftover viewer Auth user", async () => {
    await seed("s1", endedSession(31 * DAY), { pointer: false, pings: 1, viewerPings: 1, viewers: ["v_s1_a"], callLog: true });
    await runAt(purgeEndedSessions, Date.now());
    assert.equal(await exists("shareSessions/s1"), false);
    assert.equal(await exists("shareSessions/s1/private/meta"), false);
    for (const sub of ["pings", "viewerPings", "viewerSignIns"]) assert.equal(await count(`shareSessions/s1/${sub}`), 0);
    assert.equal(await exists("callLogs/s1"), false);
    assert.equal(await authUserExists("v_s1_a"), false);
  });

  it("leaves a session that ended under 30 days ago, and a live one, alone", async () => {
    await seed("recent", endedSession(29 * DAY), { owner: "a", pointer: false, callLog: true });
    await seed("live", sessionDoc(), { owner: "b", callLog: true });
    await runAt(purgeEndedSessions, Date.now());
    for (const id of ["recent", "live"]) {
      assert.ok(await exists(`shareSessions/${id}`));
      assert.ok(await exists(`shareSessions/${id}/private/meta`));
      assert.ok(await exists(`callLogs/${id}`));
    }
  });

  it("is idempotent: a repeat run finds nothing left to do", async () => {
    await seed("s1", endedSession(31 * DAY), { pointer: false, callLog: true });
    await runAt(purgeEndedSessions, Date.now());
    await runAt(purgeEndedSessions, Date.now());
    assert.equal(await exists("shareSessions/s1"), false);
  });
});
