/**
 * FSD §8 Retention, each window at its boundary: the 24-hour cleanup, the
 * 30-day purge, and sweepRetention, the backstop for what they can't find
 * (data under a session doc that is gone, and device tokens that stopped
 * working). Each job runs through its handler at a chosen schedule time, as
 * lifecycle.test.ts does, so "exactly at the window" and "a millisecond
 * short" are both tested. Overlapping and repeated runs are tested too.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { DEFAULT_USER_SETTINGS, validate } from "../../../shared/schema/generated/ts/schema.ts";
import { PROJECT_ID, clearAuth, clearFirestore } from "./emulators.ts";
import { cleanupEndedSessions, purgeEndedSessions, sweepRetention } from "../../functions/lib/index.js";
import { unlessGoneOrChanged } from "../../functions/lib/jobs/run.js";
import { STALE_DEVICE_DAYS } from "../../functions/lib/jobs/sweepRetention.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let app: App;
let db: Firestore;
let auth: Auth;
/** Every run in a test is scheduled at T, so the windows are exact. */
let T: number;

type Job = typeof cleanupEndedSessions;
const run = (job: Job, ms = T) => job.run({ scheduleTime: new Date(ms).toISOString() });
const at = (ms: number) => Timestamp.fromMillis(ms);

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "retention-test");
  db = getFirestore(app);
  auth = getAuth(app);
});

after(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  await clearFirestore();
  await clearAuth();
  T = Date.now();
});

/** A session that ended at endedAt (null: still live), as the session functions leave it. */
function sessionDoc(endedAt: number | null) {
  const end = endedAt ?? T + 30 * MIN;
  const session = {
    status: endedAt === null ? "active" : "stopped",
    started_at: at(end - 20 * MIN),
    expires_at: at(end + 40 * MIN),
    stop_rule: "call", stop_minutes: null, stop_at: null,
    ended_at: endedAt === null ? null : at(endedAt),
    end_reason: endedAt === null ? null : "stopped",
    call_id: "call-1", call_active: false, call_ended_at: null, share_back_allowed: true,
    last_ping_at: at(end - MIN), ping_interval_s: 5, precision: "precise", precision_next: null,
    sharer: { name: "Alex", mascot_id: "fox", mascot_color: "original", mascot_accessory: null },
    first_viewed_at: at(end - 15 * MIN), viewer_sharing: false, share_back_requested_at: null, cleaned_at: null,
  };
  assert.deepEqual(validate("ShareSession", session), []);
  return session;
}

interface Seed {
  /** When it ended; null for a live session; "gone" for data whose session doc is gone. */
  ended: number | null | "gone";
  pings?: number[];
  viewerPings?: number[];
  /** viewerSignIns created at these times, each with an Auth user. */
  viewers?: number[];
  callLogAt?: number;
  activityToken?: string | null;
}

/** Seeds a session and what it holds; returns the viewer uids. */
async function seed(id: string, s: Seed): Promise<string[]> {
  const { ended, pings = [], viewerPings = [], viewers = [], callLogAt, activityToken = null } = s;
  const ref = db.doc(`shareSessions/${id}`);
  const batch = db.batch();
  if (ended !== "gone") {
    batch.set(ref, sessionDoc(ended));
    batch.set(ref.collection("private").doc("meta"), {
      user_id: "alice", link_token_hash: "0".repeat(64), viewer_uid: null, viewer_name: null, activity_push_token: activityToken,
    });
  }
  const ping = (t: number) => ({ lat: 51.5, lng: -0.12, accuracy_m: 8, recorded_at: at(t) });
  pings.forEach((t) => batch.set(ref.collection("pings").doc(), ping(t)));
  viewerPings.forEach((t) => batch.set(ref.collection("viewerPings").doc(), ping(t)));
  const uids = viewers.map((_, i) => `v_${id}_${i}`);
  // Watchers, so the alert trigger leaves these sessions alone.
  viewers.forEach((t, i) => batch.set(ref.collection("viewerSignIns").doc(uids[i]!), { role: "watcher", created_at: at(t) }));
  if (callLogAt !== undefined) batch.set(db.doc(`callLogs/${id}`), { user_id: "alice", session_id: id, call_id: "call-1", call_time: at(callLogAt) });
  await batch.commit();
  for (const uid of uids) await auth.createUser({ uid });
  return uids;
}

const count = async (path: string) => (await db.collection(path).count().get()).data().count;
const exists = async (path: string) => (await db.doc(path).get()).exists;
const authUserExists = (uid: string) => auth.getUser(uid).then(() => true, () => false);

describe("cleanupEndedSessions: 24 hours after the end", () => {
  it("cleans a session that ended exactly 24 hours before the run, and not one that ended a millisecond later", async () => {
    await seed("due", { ended: T - DAY, pings: [T - DAY - MIN], viewerPings: [T - DAY - MIN], viewers: [T - DAY - 10 * MIN] });
    await seed("short", { ended: T - DAY + 1, pings: [T - DAY - MIN], viewerPings: [T - DAY - MIN], viewers: [T - DAY - 10 * MIN] });
    await run(cleanupEndedSessions);

    for (const sub of ["pings", "viewerPings", "viewerSignIns"]) assert.equal(await count(`shareSessions/due/${sub}`), 0, sub);
    assert.equal(await authUserExists("v_due_0"), false);
    assert.equal((await db.doc("shareSessions/due").get()).get("cleaned_at")?.toMillis(), T);

    for (const sub of ["pings", "viewerPings", "viewerSignIns"]) assert.equal(await count(`shareSessions/short/${sub}`), 1, sub);
    assert.ok(await authUserExists("v_short_0"));
    assert.equal((await db.doc("shareSessions/short").get()).get("cleaned_at"), null);
  });

  it("clears the session's Live Activity token, which ended with it, and keeps the rest of private/meta", async () => {
    await seed("s1", { ended: T - DAY, activityToken: "la-token" });
    await run(cleanupEndedSessions);
    const meta = (await db.doc("shareSessions/s1/private/meta").get()).data();
    assert.equal(meta?.activity_push_token, null);
    assert.deepEqual(validate("SessionPrivateMeta", meta), []);
    assert.equal(meta?.user_id, "alice");
  });

  it("still cleans a session whose private/meta is already gone", async () => {
    await seed("s1", { ended: T - DAY, pings: [T - DAY - MIN] });
    await db.doc("shareSessions/s1/private/meta").delete();
    await run(cleanupEndedSessions);
    assert.equal(await count("shareSessions/s1/pings"), 0);
    assert.equal(await exists("shareSessions/s1/private/meta"), false, "the token clear didn't recreate it");
    assert.equal((await db.doc("shareSessions/s1").get()).get("cleaned_at")?.toMillis(), T);
  });

  it("is safe alongside the purge, and twice at once", async () => {
    await seed("old", { ended: T - 31 * DAY, pings: [T - 31 * DAY - MIN], viewers: [T - 31 * DAY - MIN], callLogAt: T - 31 * DAY - 20 * MIN });
    await seed("day", { ended: T - 2 * DAY, pings: [T - 2 * DAY - MIN] });
    await Promise.all([run(cleanupEndedSessions), run(purgeEndedSessions), run(cleanupEndedSessions)]);
    assert.equal(await exists("shareSessions/old"), false);
    assert.equal(await count("shareSessions/old/pings"), 0);
    assert.equal(await exists("callLogs/old"), false);
    assert.equal(await count("shareSessions/day/pings"), 0);
    assert.ok(await exists("shareSessions/day"));
  });
});

describe("purgeEndedSessions: 30 days after the end", () => {
  it("purges a session that ended exactly 30 days before the run, and not one that ended a millisecond later", async () => {
    await seed("due", { ended: T - 30 * DAY, callLogAt: T - 30 * DAY - 20 * MIN, viewers: [T - 30 * DAY - MIN] });
    await seed("short", { ended: T - 30 * DAY + 1, callLogAt: T - 30 * DAY - 20 * MIN });
    await run(purgeEndedSessions);
    assert.equal(await exists("shareSessions/due"), false);
    assert.equal(await exists("shareSessions/due/private/meta"), false);
    assert.equal(await exists("callLogs/due"), false);
    assert.equal(await authUserExists("v_due_0"), false);
    assert.ok(await exists("shareSessions/short"));
    assert.ok(await exists("shareSessions/short/private/meta"));
    assert.ok(await exists("callLogs/short"));
  });

  it("deletes the alert marker with the session", async () => {
    await seed("s1", { ended: T - 30 * DAY });
    await db.doc("shareSessions/s1/alerts/link_opened").set({
      kind: "link_opened", state: "sent", delivered: ["d-1"], attempts: 1, lease_until: at(T), created_at: at(T), updated_at: at(T),
    });
    await run(purgeEndedSessions);
    assert.equal(await count("shareSessions/s1/alerts"), 0);
  });

  it("two runs at once both finish", async () => {
    await seed("s1", { ended: T - 31 * DAY, pings: [T - 31 * DAY - MIN], callLogAt: T - 31 * DAY - 20 * MIN });
    await Promise.all([run(purgeEndedSessions), run(purgeEndedSessions)]);
    assert.equal(await exists("shareSessions/s1"), false);
  });
});

describe("sweepRetention: location data left under a session that's gone", () => {
  const WINDOW = DAY + HOUR; // 24 hours after the end of a session of at most an hour

  it("deletes pings and viewer pings recorded 25 hours or more before the run, and not a millisecond later", async () => {
    await seed("gone", { ended: "gone", pings: [T - WINDOW, T - WINDOW + 1], viewerPings: [T - WINDOW, T - WINDOW + 1] });
    await run(sweepRetention);
    for (const sub of ["pings", "viewerPings"]) {
      const left = (await db.collection(`shareSessions/gone/${sub}`).get()).docs.map((d) => d.get("recorded_at").toMillis());
      assert.deepEqual(left, [T - WINDOW + 1], sub);
    }
  });

  it("keeps old-looking pings of a live session (a phone clock that's behind) and of one ended under 24 hours ago", async () => {
    await seed("live", { ended: null, pings: [T - 3 * DAY] });
    await seed("recent", { ended: T - DAY + 1, pings: [T - 3 * DAY] });
    await seed("due", { ended: T - DAY, pings: [T - 3 * DAY] });
    await run(sweepRetention);
    assert.equal(await count("shareSessions/live/pings"), 1);
    assert.equal(await count("shareSessions/recent/pings"), 1);
    assert.equal(await count("shareSessions/due/pings"), 0);
  });

  it("deletes viewer sign-ins left under a session that's gone: the Auth user, then the doc", async () => {
    const [old] = await seed("gone", { ended: "gone", viewers: [T - WINDOW] });
    const [newer] = await seed("gone2", { ended: "gone", viewers: [T - WINDOW + 1] });
    const [live] = await seed("live", { ended: null, viewers: [T - 2 * DAY] });
    await run(sweepRetention);
    assert.equal(await authUserExists(old!), false);
    assert.equal(await count("shareSessions/gone/viewerSignIns"), 0);
    assert.ok(await authUserExists(newer!));
    assert.equal(await count("shareSessions/gone2/viewerSignIns"), 1);
    assert.ok(await authUserExists(live!));
    assert.equal(await count("shareSessions/live/viewerSignIns"), 1);
  });
});

describe("sweepRetention: call logs past 30 days", () => {
  const WINDOW = 30 * DAY + HOUR; // the session ended at most an hour after its call was seen

  it("deletes a call log left without its session once its call is 30 days and an hour old, and not a millisecond sooner", async () => {
    await seed("due", { ended: "gone", callLogAt: T - WINDOW });
    await seed("short", { ended: "gone", callLogAt: T - WINDOW + 1 });
    await run(sweepRetention);
    assert.equal(await exists("callLogs/due"), false);
    assert.ok(await exists("callLogs/short"));
  });

  it("keeps an old call log whose session is still kept (ended under 30 days ago)", async () => {
    await seed("kept", { ended: T - 30 * DAY + 1, callLogAt: T - WINDOW - DAY });
    await run(sweepRetention);
    assert.ok(await exists("callLogs/kept"));
  });
});

describe("sweepRetention: device tokens that stopped working", () => {
  async function device(id: string, updatedAt: number) {
    await db.doc(`users/alice/devices/${id}`).set({ platform: "android", push_token: `tok-${id}`, live_activity_start_token: null, updated_at: at(updatedAt) });
  }

  it(`deletes a device not rewritten for ${STALE_DEVICE_DAYS} days, and not one rewritten a millisecond later`, async () => {
    const t = Timestamp.now().toMillis();
    await db.doc("users/alice").set({
      name: "Alex", mascot_id: "fox", mascot_color: "original", mascot_accessory: null, last_viewer_name: null,
      settings: DEFAULT_USER_SETTINGS, active_session_id: null, created_at: at(t), updated_at: at(t),
    });
    await device("stale", T - STALE_DEVICE_DAYS * DAY);
    await device("fresh", T - STALE_DEVICE_DAYS * DAY + 1);
    await run(sweepRetention);
    assert.equal(await exists("users/alice/devices/stale"), false);
    assert.ok(await exists("users/alice/devices/fresh"));
    assert.ok(await exists("users/alice"), "the profile stays");
  });
});

describe("sweepRetention: repeated and overlapping runs", () => {
  it("a repeat finds nothing, and two at once both finish", async () => {
    await seed("gone", { ended: "gone", pings: [T - 2 * DAY], viewers: [T - 2 * DAY], callLogAt: T - 40 * DAY });
    await Promise.all([run(sweepRetention), run(sweepRetention)]);
    await run(sweepRetention);
    assert.equal(await count("shareSessions/gone/pings"), 0);
    assert.equal(await count("shareSessions/gone/viewerSignIns"), 0);
    assert.equal(await exists("callLogs/gone"), false);
  });
});

describe("unlessGoneOrChanged: a write a concurrent job already made moot", () => {
  const failing = (code: number) => Promise.reject(Object.assign(new Error(`code ${code}`), { code }));

  it("is true when the write lands, false when its doc is gone (5) or changed (9), and passes anything else on", async () => {
    assert.equal(await unlessGoneOrChanged(Promise.resolve()), true);
    assert.equal(await unlessGoneOrChanged(failing(5)), false);
    assert.equal(await unlessGoneOrChanged(failing(9)), false);
    await assert.rejects(unlessGoneOrChanged(failing(14)), /code 14/);
  });

  it("on the emulator: an update to a deleted doc, and a delete whose doc changed since it was read", async () => {
    assert.equal(await unlessGoneOrChanged(db.doc("x/missing").update({ a: 1 })), false);
    await db.doc("x/doc").set({ a: 1 });
    const read = await db.doc("x/doc").get();
    await db.doc("x/doc").set({ a: 2 });
    assert.equal(await unlessGoneOrChanged(db.doc("x/doc").delete({ lastUpdateTime: read.updateTime! })), false);
    assert.ok(await exists("x/doc"));
  });
});
