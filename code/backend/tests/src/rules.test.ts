/**
 * Firestore rules, Sprint 1: every collection in FSD §6, each path with the
 * requests it allows and the ones it refuses, for every kind of caller:
 * signed out, the session's sharer, another sharer, an anonymous sign-in with
 * the sharer's uid, the session's viewer, a watcher, and a viewer page signed in
 * for another session.
 *
 * Functions use the Admin SDK and bypass the rules, so what only functions may
 * do shows up here as refused for every client. The functions' own tests
 * (createSession, sessions, lifecycle) cover the other side.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  setLogLevel,
  Timestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import {
  APPROXIMATE_ROUNDING_METERS,
  DEFAULT_USER_SETTINGS,
  FIRST_PING_BEFORE_START_MINUTES,
  MAX_ACCURACY_METERS,
  MIN_PING_SPACING_SECONDS,
  PING_CLOCK_SKEW_SECONDS,
  PING_ID_MAX_LENGTH,
  PLACE_PART_MAX_LENGTH,
  validate,
} from "../../../shared/schema/generated/ts/schema.ts";
import { FIRESTORE, PROJECT_ID } from "./emulators.ts";

const RULES_PATH = new URL("../../firestore.rules", import.meta.url);

let env: RulesTestEnvironment;

// Every denied write is expected here; don't let the SDK log each one as a warning.
setLogLevel("error");

// ---- Who is asking -----------------------------------------------------------

type Who = () => RulesTestContext;

// Sharers sign in with a phone number; the token says so.
const sharer = (uid: string, phone: string): RulesTestContext =>
  env.authenticatedContext(uid, { phone_number: phone, firebase: { sign_in_provider: "phone" } });
// A viewer page's custom sign-in from redeemLinkToken (shared ViewerClaims).
const viewerPage = (uid: string, sid: string, role: "viewer" | "watcher"): RulesTestContext =>
  env.authenticatedContext(uid, { sid, role, firebase: { sign_in_provider: "custom" } });

const alice: Who = () => sharer("alice", "+15555550101");
const bob: Who = () => sharer("bob", "+15555550102");
// Same uid as Alice, but an anonymous sign-in: never a sharer.
const aliceAnonymous: Who = () => env.authenticatedContext("alice", { firebase: { sign_in_provider: "anonymous" } });
const stranger: Who = () => env.unauthenticatedContext();
// s-alice's viewer (private/meta.viewer_uid) and a watcher of the same link.
const viewer: Who = () => viewerPage("viewer-1", "s-alice", "viewer");
const watcher: Who = () => viewerPage("watcher-1", "s-alice", "watcher");
// A viewer page signed in for another session.
const otherViewer: Who = () => viewerPage("viewer-2", "s-other", "viewer");
// Claims role viewer but isn't the session's viewer_uid.
const posingViewer: Who = () => viewerPage("watcher-1", "s-alice", "viewer");
// The claims mean nothing without the custom sign-in redeemLinkToken mints.
const phoneWithViewerClaims: Who = () =>
  env.authenticatedContext("viewer-1", { sid: "s-alice", role: "viewer", firebase: { sign_in_provider: "phone" } });
const customWithoutClaims: Who = () => env.authenticatedContext("viewer-1", { firebase: { sign_in_provider: "custom" } });

const EVERYONE: [string, Who][] = [
  ["signed out", stranger],
  ["the sharer", alice],
  ["another sharer", bob],
  ["an anonymous sign-in", aliceAnonymous],
  ["the viewer", viewer],
  ["a watcher", watcher],
];

// ---- Seed docs -----------------------------------------------------------------

const MIN = 60_000;
const at = (ms: number) => Timestamp.fromMillis(ms);

/** A live call share with share back open, whose link the viewer has opened (shared ShareSession). */
function sessionDoc(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
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
    last_fix_at: null,
    ping_interval_s: 5,
    precision: "precise",
    precision_next: null,
    sharer: { name: "Alex", mascot_id: "fox", mascot_color: "original", mascot_accessory: null },
    first_viewed_at: at(now - 4 * MIN),
    viewer_sharing: false,
    share_back_requested_at: null,
    cleaned_at: null,
    place: null,
    ...overrides,
  };
}

/** A manual share on a 30-minute timer, not yet opened. */
const manualSession = (overrides: Record<string, unknown> = {}) =>
  sessionDoc({
    stop_rule: "minutes",
    stop_minutes: 30,
    stop_at: at(Date.now() + 25 * MIN),
    call_id: null,
    call_active: false,
    share_back_allowed: false,
    first_viewed_at: null,
    ...overrides,
  });

/** A session the sharer stopped a minute ago. */
const stoppedSession = (overrides: Record<string, unknown> = {}) =>
  sessionDoc({ status: "stopped", ended_at: at(Date.now() - MIN), end_reason: "stopped", ...overrides });

/** Still marked active, but past its 1-hour limit: the stop job hasn't run yet. */
const expiredSession = () => sessionDoc({ started_at: at(Date.now() - 61 * MIN), expires_at: at(Date.now() - MIN) });

/** Still marked active, but past its timer. */
const pastStopAtSession = () => manualSession({ stop_at: at(Date.now() - 1000) });

function metaDoc(userId: string, viewerUid: string | null = "viewer-1") {
  return { user_id: userId, link_token_hash: "0".repeat(64), viewer_uid: viewerUid, viewer_name: null, activity_push_token: null };
}

function userDoc() {
  const t = Timestamp.now();
  return {
    name: "Alex", mascot_id: "fox", mascot_color: "original", mascot_accessory: null,
    last_viewer_name: null, settings: DEFAULT_USER_SETTINGS, active_session_id: "s-alice",
    created_at: t, updated_at: t,
  };
}

function ping(accuracy_m: number, extra: Record<string, unknown> = {}) {
  return { lat: 37.7749, lng: -122.4194, recorded_at: Timestamp.now(), accuracy_m, ...extra };
}

const device = (overrides: Record<string, unknown> = {}) => ({
  platform: "ios",
  push_token: "apns-token",
  live_activity_start_token: "la-start-token",
  updated_at: serverTimestamp(),
  ...overrides,
});

/** The s-alice session as seeded for this test (its timestamps are relative to now). */
let seeded: ReturnType<typeof sessionDoc>;

/** Seeds a session the way createSession and redeemLinkToken leave it, with rules off. */
async function seedSession(sessionId: string, ownerUid: string, session: Record<string, unknown> = sessionDoc(), viewerUid: string | null = "viewer-1"): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `shareSessions/${sessionId}`), session);
    await setDoc(doc(db, `shareSessions/${sessionId}/private/meta`), metaDoc(ownerUid, viewerUid));
  });
}

/** The view alert's once-only marker, as Backend-Alerts' trigger writes it (function-only). */
function alertDoc() {
  const t = Timestamp.now();
  return { kind: "link_opened", state: "sent", delivered: ["d1"], attempts: 1, lease_until: t, created_at: t, updated_at: t };
}

/** Changes the seeded s-alice session, with rules off. */
async function patchSession(changes: Record<string, unknown>, sessionId = "s-alice"): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), `shareSessions/${sessionId}`), changes);
  });
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host: FIRESTORE.host, port: FIRESTORE.port, rules: readFileSync(RULES_PATH, "utf8") },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  seeded = sessionDoc();
  await seedSession("s-alice", "alice", seeded);
  await seedSession("s-other", "bob", sessionDoc(), "viewer-2");
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "shareSessions/s-alice/pings/p1"), ping(8));
    await setDoc(doc(db, "shareSessions/s-alice/viewerPings/v1"), ping(15));
    await setDoc(doc(db, "shareSessions/s-alice/viewerSignIns/viewer-1"), { role: "viewer", created_at: Timestamp.now() });
    await setDoc(doc(db, "shareSessions/s-other/pings/p1"), ping(8));
    await setDoc(doc(db, "users/alice"), userDoc());
    await setDoc(doc(db, "users/alice/devices/d1"), { ...device(), updated_at: Timestamp.now() });
    await setDoc(doc(db, "users/alice/trustedContacts/t1"), { contact_user_id: "bob", relation: "friend" });
    await setDoc(doc(db, "mascots/fox"), { character: "fox", set: "classics", default_color: "original", accessories: ["headphones", "glasses", "headlamp"] });
    await setDoc(doc(db, "callLogs/s-alice"), { user_id: "alice", session_id: "s-alice", call_id: "call-1", call_time: Timestamp.now() });
    await setDoc(doc(db, "shareSessions/s-alice/alerts/link_opened"), alertDoc());
  });
});

after(async () => {
  await env?.cleanup();
});

const dbOf = (who: Who) => who().firestore();
const get = (who: Who, path: string) => getDoc(doc(dbOf(who), path));
const list = (who: Who, path: string) => getDocs(collection(dbOf(who), path));
const update = (who: Who, path: string, data: Record<string, unknown>) => updateDoc(doc(dbOf(who), path), data);
const updateSession = (who: Who, data: Record<string, unknown>) => update(who, "shareSessions/s-alice", data);

describe("the seed docs match the shared schema", () => {
  it("sessions, meta, user, device, ping, call log, sign-in and alert", () => {
    for (const s of [sessionDoc(), manualSession(), stoppedSession(), expiredSession(), pastStopAtSession()]) {
      assert.deepEqual(validate("ShareSession", s), []);
    }
    assert.deepEqual(validate("SessionPrivateMeta", metaDoc("alice")), []);
    assert.deepEqual(validate("User", userDoc()), []);
    assert.deepEqual(validate("Device", { ...device(), updated_at: Timestamp.now() }), []);
    assert.deepEqual(validate("Ping", ping(8)), []);
    assert.deepEqual(validate("CallLog", { user_id: "alice", session_id: "s-alice", call_id: "call-1", call_time: Timestamp.now() }), []);
    assert.deepEqual(validate("ViewerSignIn", { role: "viewer", created_at: Timestamp.now() }), []);
    assert.deepEqual(validate("AlertDelivery", alertDoc()), []);
  });
});

describe("function-only paths: no client access at all", () => {
  const docs = [
    "callLogs/s-alice",
    "shareSessions/s-alice/viewerSignIns/viewer-1",
    "shareSessions/s-alice/alerts/link_opened",
    "users/alice/trustedContacts/t1",
    "somethingElse/x",
  ];
  const collections = [
    "callLogs", "shareSessions/s-alice/viewerSignIns", "shareSessions/s-alice/alerts", "users/alice/trustedContacts", "somethingElse",
  ];

  for (const [label, who] of EVERYONE) {
    describe(label, () => {
      for (const path of docs) {
        it(`can't read, write or delete ${path}`, async () => {
          await assertFails(get(who, path));
          await assertFails(setDoc(doc(dbOf(who), path), { x: 1 }));
          await assertFails(deleteDoc(doc(dbOf(who), path)));
        });
      }
      it("can't list them", async () => {
        for (const path of collections) await assertFails(list(who, path));
      });
    });
  }
});

describe("users/{userId}: the owner reads; saveProfile writes", () => {
  it("the owner can read their profile", async () => {
    const snap = await assertSucceeds(get(alice, "users/alice"));
    assert.equal(snap.get("name"), "Alex");
  });

  it("nobody else can read it, and nobody can list users", async () => {
    for (const who of [bob, aliceAnonymous, stranger, viewer, watcher, phoneWithViewerClaims]) {
      await assertFails(get(who, "users/alice"));
    }
    await assertFails(list(alice, "users"));
  });

  it("not even the owner can write it from the client", async () => {
    await assertFails(update(alice, "users/alice", { name: "Al", updated_at: serverTimestamp() }));
    await assertFails(update(alice, "users/alice", { active_session_id: null }));
    await assertFails(setDoc(doc(dbOf(alice), "users/alice"), { ...userDoc(), created_at: serverTimestamp(), updated_at: serverTimestamp() }));
    await assertFails(deleteDoc(doc(dbOf(alice), "users/alice")));
    await assertFails(setDoc(doc(dbOf(bob), "users/bob"), { ...userDoc(), active_session_id: null }));
  });
});

describe("users/{userId}/devices/{deviceId}: the owner only", () => {
  const path = "users/alice/devices/d2";

  it("the owner can register an iPhone or an Android phone, refresh it, read it and delete it", async () => {
    await assertSucceeds(setDoc(doc(dbOf(alice), path), device()));
    await assertSucceeds(setDoc(doc(dbOf(alice), "users/alice/devices/d3"), device({ platform: "android", push_token: "fcm-token", live_activity_start_token: null })));
    await assertSucceeds(update(alice, path, { push_token: "apns-token-2", updated_at: serverTimestamp() }));
    await assertSucceeds(get(alice, path));
    await assertSucceeds(deleteDoc(doc(dbOf(alice), path)));
  });

  it("only once the profile exists: a deleted account's token can't bring a device back", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), "users/alice"));
    });
    await assertFails(setDoc(doc(dbOf(alice), path), device()));
    await assertFails(update(alice, "users/alice/devices/d1", { push_token: "apns-token-2", updated_at: serverTimestamp() }));
    // Signing out still removes it, and reading it is harmless.
    await assertSucceeds(get(alice, "users/alice/devices/d1"));
    await assertSucceeds(deleteDoc(doc(dbOf(alice), "users/alice/devices/d1")));
  });

  it("refuses a device that isn't exactly the shared Device", async () => {
    for (const bad of [
      device({ platform: "windows" }),
      device({ push_token: "" }),
      device({ push_token: "x".repeat(4097) }),
      device({ push_token: 7 }),
      device({ platform: "android", live_activity_start_token: "la-start-token" }),
      device({ live_activity_start_token: "" }),
      device({ updated_at: Timestamp.now() }),
      device({ extra: true }),
    ]) {
      await assertFails(setDoc(doc(dbOf(alice), path), bad));
    }
    const { push_token: _, ...noToken } = device();
    await assertFails(setDoc(doc(dbOf(alice), path), noToken));
    await assertFails(update(alice, "users/alice/devices/d1", { push_token: "t", updated_at: Timestamp.now() }));
  });

  it("nobody else can read, write or delete it, and nobody can list devices", async () => {
    for (const who of [bob, aliceAnonymous, stranger, viewer, watcher]) {
      await assertFails(get(who, "users/alice/devices/d1"));
      await assertFails(setDoc(doc(dbOf(who), path), device()));
      await assertFails(deleteDoc(doc(dbOf(who), "users/alice/devices/d1")));
    }
    await assertFails(list(alice, "users/alice/devices"));
  });
});

describe("shareSessions/{sessionId}: reading", () => {
  it("the sharer can read their own session, live or ended", async () => {
    const snap = await assertSucceeds(get(alice, "shareSessions/s-alice"));
    assert.equal(snap.get("status"), "active");
    await patchSession(stoppedSession());
    await assertSucceeds(get(alice, "shareSessions/s-alice"));
  });

  it("the viewer and a watcher can read it while it's live, and after it ends for the ended state", async () => {
    for (const who of [viewer, watcher]) await assertSucceeds(get(who, "shareSessions/s-alice"));
    await patchSession(stoppedSession());
    for (const who of [viewer, watcher]) await assertSucceeds(get(who, "shareSessions/s-alice"));
  });

  it("nobody else can read it", async () => {
    for (const who of [bob, aliceAnonymous, stranger, otherViewer, phoneWithViewerClaims, customWithoutClaims]) {
      await assertFails(get(who, "shareSessions/s-alice"));
    }
  });

  it("a session without meta has no owner", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "shareSessions/s-orphan"), sessionDoc());
    });
    await assertFails(get(alice, "shareSessions/s-orphan"));
  });

  it("nobody can list sessions", async () => {
    for (const [, who] of EVERYONE) await assertFails(list(who, "shareSessions"));
  });
});

describe("shareSessions/{sessionId}: creating and deleting is for functions only", () => {
  it("a sharer can't create a session directly, even with themselves as owner", async () => {
    const db = dbOf(alice);
    const batch = writeBatch(db);
    batch.set(doc(db, "shareSessions/s-new"), { ...sessionDoc(), started_at: serverTimestamp() });
    batch.set(doc(db, "shareSessions/s-new/private/meta"), metaDoc("alice"));
    await assertFails(batch.commit());
    await assertFails(addDoc(collection(db, "shareSessions"), sessionDoc()));
  });

  it("a sharer can't create a session that names someone else as owner", async () => {
    const db = dbOf(bob);
    const batch = writeBatch(db);
    batch.set(doc(db, "shareSessions/s-bob-as-alice"), sessionDoc());
    batch.set(doc(db, "shareSessions/s-bob-as-alice/private/meta"), metaDoc("alice"));
    await assertFails(batch.commit());
  });

  it("nobody can delete a session", async () => {
    for (const [, who] of EVERYONE) await assertFails(deleteDoc(doc(dbOf(who), "shareSessions/s-alice")));
  });
});

describe("shareSessions/{sessionId}: the sharer's updates", () => {
  it("a check-in carries the server's time", async () => {
    await assertSucceeds(updateSession(alice, { last_ping_at: serverTimestamp() }));
    await assertFails(updateSession(alice, { last_ping_at: Timestamp.now() }));
    await assertFails(updateSession(alice, { last_ping_at: at(Date.now() + 10 * MIN) }));
  });

  it("ping_interval_s is the interval in use: above 0, at most 60 seconds", async () => {
    for (const ok of [3.5, 15, 60]) await assertSucceeds(updateSession(alice, { ping_interval_s: ok }));
    for (const bad of [0, -1, 60.5, 61, "5", null]) await assertFails(updateSession(alice, { ping_interval_s: bad }));
  });

  it("precision and precision_next take only the shared values", async () => {
    await assertSucceeds(updateSession(alice, { precision_next: "approximate" }));
    await assertSucceeds(updateSession(alice, { precision: "approximate", precision_next: null }));
    await assertFails(updateSession(alice, { precision: "exact" }));
    await assertFails(updateSession(alice, { precision_next: "rough" }));
    await assertFails(updateSession(alice, { precision: null }));
  });

  describe("the timer sheet", () => {
    it("a timer stops in the future and never after the 1-hour limit", async () => {
      await assertSucceeds(updateSession(alice, { stop_rule: "minutes", stop_minutes: 15, stop_at: at(Date.now() + 15 * MIN) }));
      await assertSucceeds(updateSession(alice, { stop_rule: "minutes", stop_minutes: 60, stop_at: seeded.expires_at }));
      await assertFails(updateSession(alice, { stop_rule: "minutes", stop_minutes: 45, stop_at: at(Date.now() + 45 * MIN) }));
      await assertFails(updateSession(alice, { stop_rule: "minutes", stop_minutes: 60, stop_at: at(seeded.expires_at.toMillis() + 1000) }));
      await assertFails(updateSession(alice, { stop_rule: "minutes", stop_minutes: 15, stop_at: at(Date.now() - 1000) }));
      await assertFails(updateSession(alice, { stop_rule: "minutes", stop_minutes: 15, stop_at: null }));
    });

    it("a timer's stop_at is now plus its minutes, within 60 s, never another time up to the limit", async () => {
      const timer = (minutes: number, stopAtMs: number) => updateSession(alice, { stop_rule: "minutes", stop_minutes: minutes, stop_at: at(stopAtMs) });
      const skew = PING_CLOCK_SKEW_SECONDS * 1000;
      for (const minutes of [15, 30]) {
        const target = Date.now() + minutes * MIN;
        await assertSucceeds(timer(minutes, target - skew + 5_000));
        await assertSucceeds(timer(minutes, target + skew - 5_000));
        await assertFails(timer(minutes, target - skew - 5_000));
        await assertFails(timer(minutes, target + skew + 5_000));
      }
      // "In 15 min" can't carry a later stop_at, even one the limit would allow.
      await assertFails(timer(15, Date.now() + 45 * MIN));
      await assertFails(timer(30, Date.now() + 15 * MIN));
    });

    it("past the limit, a timer is capped at exactly expires_at", async () => {
      // seeded: expires_at is 55 minutes away, so In 1 hour is capped.
      const timer = (stopAtMs: number) => updateSession(alice, { stop_rule: "minutes", stop_minutes: 60, stop_at: at(stopAtMs) });
      await assertSucceeds(timer(seeded.expires_at.toMillis()));
      await assertFails(timer(seeded.expires_at.toMillis() - 30_000));
      await assertFails(timer(seeded.expires_at.toMillis() + 1));
      // A timer whose end lands just past the limit is capped there, or just inside it.
      await patchSession({ expires_at: at(Date.now() + 30 * MIN + 20_000) });
      const expiresAt = Date.now() + 30 * MIN + 20_000;
      await assertSucceeds(updateSession(alice, { stop_rule: "minutes", stop_minutes: 30, stop_at: at(Date.now() + 30 * MIN) }));
      await assertFails(updateSession(alice, { stop_rule: "minutes", stop_minutes: 30, stop_at: at(expiresAt + 10 * MIN) }));
    });

    it("\"At the 1-hour limit\" is exactly expires_at", async () => {
      await assertSucceeds(updateSession(alice, { stop_rule: "limit", stop_minutes: null, stop_at: seeded.expires_at }));
      await assertFails(updateSession(alice, { stop_rule: "limit", stop_minutes: null, stop_at: at(Date.now() + 30 * MIN) }));
      await assertFails(updateSession(alice, { stop_rule: "limit", stop_minutes: 60, stop_at: seeded.expires_at }));
    });

    it("\"When the call ends\" only on a call share whose call hasn't ended", async () => {
      await patchSession({ stop_rule: "minutes", stop_minutes: 30, stop_at: at(Date.now() + 25 * MIN) });
      await assertSucceeds(updateSession(alice, { stop_rule: "call", stop_minutes: null, stop_at: null }));

      await patchSession({ stop_rule: "minutes", stop_minutes: 30, stop_at: at(Date.now() + 25 * MIN), call_active: false, call_ended_at: Timestamp.now() });
      await assertFails(updateSession(alice, { stop_rule: "call", stop_minutes: null, stop_at: null }));

      await patchSession(manualSession());
      await assertFails(updateSession(alice, { stop_rule: "call", stop_minutes: null, stop_at: null }));
      await assertFails(updateSession(alice, { stop_rule: "sometime" }));
    });
  });

  describe("Ask to share", () => {
    const ask = () => updateSession(alice, { share_back_requested_at: serverTimestamp() });

    it("once per call, during the call, after the viewer opened the link", async () => {
      await assertSucceeds(ask());
      await assertFails(ask());
    });

    it("never before the link is opened, without share back, after the call, or with the phone's time", async () => {
      await assertFails(updateSession(alice, { share_back_requested_at: Timestamp.now() }));
      await patchSession({ first_viewed_at: null });
      await assertFails(ask());
      await patchSession({ first_viewed_at: Timestamp.now(), share_back_allowed: false });
      await assertFails(ask());
      await patchSession({ share_back_allowed: true, call_active: false });
      await assertFails(ask());
      await patchSession({ call_ended_at: Timestamp.now() });
      await assertFails(ask());
    });
  });

  it("status, the end, the call state and everything the viewer sees stay with the functions", async () => {
    for (const change of [
      { status: "stopped" },
      { status: "stopped", ended_at: serverTimestamp(), end_reason: "stopped" },
      { ended_at: serverTimestamp() },
      { end_reason: "stopped" },
      { call_active: false },
      { call_ended_at: serverTimestamp() },
      { call_active: false, call_ended_at: serverTimestamp() },
      { viewer_sharing: true },
      { share_back_allowed: false },
      { first_viewed_at: serverTimestamp() },
      { expires_at: at(Date.now() + 2 * 60 * MIN) },
      { started_at: serverTimestamp() },
      { call_id: "call-2" },
      { "sharer.name": "Mallory" },
      { cleaned_at: serverTimestamp() },
    ]) {
      await assertFails(updateSession(alice, change));
    }
    await patchSession({ call_active: false });
    await assertFails(updateSession(alice, { call_active: true }));
  });

  it("nothing changes once the session is over: stopped, past expires_at or past stop_at", async () => {
    for (const over of [stoppedSession(), expiredSession(), pastStopAtSession()]) {
      await patchSession(over);
      await assertFails(updateSession(alice, { last_ping_at: serverTimestamp() }));
    }
  });

  it("only the sharer: not another sharer, a viewer page, or anyone signed out", async () => {
    for (const who of [bob, aliceAnonymous, stranger, viewer, watcher, phoneWithViewerClaims]) {
      await assertFails(updateSession(who, { last_ping_at: serverTimestamp() }));
    }
  });
});

describe("shareSessions/{sessionId}: the viewer's share-back switch", () => {
  const share = (who: Who, on: unknown) => updateSession(who, { viewer_sharing: on });

  it("the viewer can turn it on while share back is open, and off at any time", async () => {
    await assertSucceeds(share(viewer, true));
    await assertSucceeds(share(viewer, false));
    await patchSession(stoppedSession({ viewer_sharing: true }));
    await assertSucceeds(share(viewer, false));
  });

  it("not while share back is closed", async () => {
    for (const closed of [
      { share_back_allowed: false },
      { call_active: false },
      { call_active: false, call_ended_at: Timestamp.now() },
      { last_ping_at: at(Date.now() - 3 * MIN) },
      stoppedSession(),
      expiredSession(),
    ]) {
      await patchSession(closed);
      await assertFails(share(viewer, true));
      await patchSession(sessionDoc());
    }
  });

  it("only viewer_sharing, and only a boolean", async () => {
    await assertFails(updateSession(viewer, { viewer_sharing: true, last_ping_at: serverTimestamp() }));
    await assertFails(updateSession(viewer, { first_viewed_at: serverTimestamp() }));
    await assertFails(share(viewer, "yes"));
  });

  it("only the session's viewer: not a watcher, a page posing as the viewer, another session's viewer, or the sharer", async () => {
    for (const who of [watcher, posingViewer, otherViewer, phoneWithViewerClaims, customWithoutClaims, alice, stranger]) {
      await assertFails(share(who, true));
    }
  });
});

describe("shareSessions/{sessionId}/private/meta: the sharer only", () => {
  const META = "shareSessions/s-alice/private/meta";

  it("the sharer can read it, and nobody else can, not even the viewer", async () => {
    await assertSucceeds(get(alice, META));
    for (const who of [bob, aliceAnonymous, stranger, viewer, watcher, phoneWithViewerClaims]) {
      await assertFails(get(who, META));
    }
  });

  it("the sharer can't read any other doc under private, or list it", async () => {
    await assertFails(get(alice, "shareSessions/s-alice/private/other"));
    await assertFails(list(alice, "shareSessions/s-alice/private"));
  });

  it("the sharer can set this session's Live Activity token while it's live, and nothing else", async () => {
    await assertSucceeds(update(alice, META, { activity_push_token: "la-update-token" }));
    await assertSucceeds(update(alice, META, { activity_push_token: null }));
    await assertFails(update(alice, META, { activity_push_token: "" }));
    await assertFails(update(alice, META, { activity_push_token: 7 }));
    for (const change of [{ user_id: "bob" }, { viewer_uid: "alice" }, { link_token_hash: "1".repeat(64) }, { viewer_name: "Mom" }]) {
      await assertFails(update(alice, META, change));
    }
    await patchSession(stoppedSession());
    await assertFails(update(alice, META, { activity_push_token: "la-update-token" }));
  });

  it("nobody else can change, replace or delete it", async () => {
    for (const who of [bob, viewer, stranger]) await assertFails(update(who, META, { activity_push_token: "x" }));
    await assertFails(setDoc(doc(dbOf(bob), META), metaDoc("bob")));
    await assertFails(setDoc(doc(dbOf(alice), META), metaDoc("alice", "alice")));
    await assertFails(deleteDoc(doc(dbOf(alice), META)));
  });
});

describe("shareSessions/{sessionId}/pings: reading", () => {
  const PINGS = "shareSessions/s-alice/pings";

  it("the sharer can read their pings, live or ended", async () => {
    await assertSucceeds(get(alice, `${PINGS}/p1`));
    await assertSucceeds(list(alice, PINGS));
    await patchSession(stoppedSession());
    await assertSucceeds(list(alice, PINGS));
  });

  it("the viewer and a watcher can read them while the session is live", async () => {
    for (const who of [viewer, watcher]) {
      await assertSucceeds(get(who, `${PINGS}/p1`));
      const snap = await assertSucceeds(list(who, PINGS));
      assert.equal(snap.size, 1);
    }
  });

  it("never once it's over: stopped, past expires_at, or past stop_at", async () => {
    for (const over of [stoppedSession(), expiredSession(), pastStopAtSession()]) {
      await patchSession(over);
      for (const who of [viewer, watcher]) {
        await assertFails(get(who, `${PINGS}/p1`));
        await assertFails(list(who, PINGS));
      }
    }
  });

  it("right up to the end: 5 s before expires_at or stop_at they read, 1 s after they don't", async () => {
    const now = Date.now();
    const cases: [Record<string, unknown>, boolean][] = [
      [{ started_at: at(now - 60 * MIN + 5_000), expires_at: at(now + 5_000) }, true],
      [{ started_at: at(now - 60 * MIN - 1_000), expires_at: at(now - 1_000) }, false],
      [{ stop_rule: "minutes", stop_minutes: 15, stop_at: at(now + 5_000) }, true],
      [{ stop_rule: "minutes", stop_minutes: 15, stop_at: at(now - 1_000) }, false],
    ];
    for (const [change, live] of cases) {
      await patchSession(change);
      for (const who of [viewer, watcher]) {
        await (live ? assertSucceeds : assertFails)(list(who, PINGS));
        // The session doc itself stays readable either way, for the ended state.
        await assertSucceeds(get(who, "shareSessions/s-alice"));
      }
      await patchSession(sessionDoc());
    }
  });

  it("nobody else, and no viewer page of another session", async () => {
    for (const who of [bob, aliceAnonymous, stranger, otherViewer, phoneWithViewerClaims, customWithoutClaims]) {
      await assertFails(get(who, `${PINGS}/p1`));
      await assertFails(list(who, PINGS));
    }
  });
});

/**
 * A ping as the apps write it (x-decisions Q-PING-WRITE): the ping, and in the
 * same batch the session's check-in and last_fix_at = its recorded_at.
 * `session` replaces that session update; null leaves the session alone.
 */
function sendPing(
  sessionId: string,
  data: Record<string, unknown>,
  opts: { who?: Who; session?: Record<string, unknown> | null; id?: string } = {},
) {
  const db = dbOf(opts.who ?? alice);
  const batch = writeBatch(db);
  const pings = `shareSessions/${sessionId}/pings`;
  batch.set(opts.id === undefined ? doc(collection(db, pings)) : doc(db, `${pings}/${opts.id}`), data);
  const session = opts.session === undefined ? { last_ping_at: serverTimestamp(), last_fix_at: data.recorded_at } : opts.session;
  if (session) batch.update(doc(db, `shareSessions/${sessionId}`), session);
  return batch.commit();
}

describe("shareSessions/{sessionId}/pings: writing", () => {
  // Each test's pings, 3 s apart, starting 50 s ago, so they're in order.
  let clock = 0;
  const nextFix = () => at((clock += 3_000));

  beforeEach(() => {
    clock = Date.now() - 50_000;
  });

  it("a ping and its check-in go in one batch", async () => {
    await assertSucceeds(sendPing("s-alice", ping(8, { recorded_at: nextFix() })));
  });

  it("never without the check-in: alone, or with the phone's time as last_ping_at", async () => {
    await assertFails(sendPing("s-alice", ping(8), { session: null }));
    await assertFails(sendPing("s-alice", ping(8), { session: { last_ping_at: Timestamp.now(), last_fix_at: Timestamp.now() } }));
    await assertFails(sendPing("s-alice", ping(8), { session: { ping_interval_s: 5 } }));
  });

  it("a precise session takes the raw accuracy, from 0 up to 100 km", async () => {
    assert.equal(MAX_ACCURACY_METERS, 100_000);
    for (const accuracy of [0, 4.7, MAX_ACCURACY_METERS]) await assertSucceeds(sendPing("s-alice", ping(accuracy, { recorded_at: nextFix() })));
    for (const accuracy of [-1, -0.01, MAX_ACCURACY_METERS + 0.01, Infinity, NaN]) {
      await assertFails(sendPing("s-alice", ping(accuracy, { recorded_at: nextFix() })));
    }
  });

  describe("while the session is Approximate, accuracy_m is at least 500", () => {
    beforeEach(async () => {
      await seedSession("s-approx", "alice", sessionDoc({ precision: "approximate" }));
    });

    it("refuses a ping that is more accurate than the rounded point", async () => {
      for (const accuracy of [4.7, 100, 499, 499.99]) {
        await assertFails(sendPing("s-approx", ping(accuracy, { recorded_at: nextFix() })));
      }
    });

    it("takes max(raw, 500): exactly 500, or a worse raw fix", async () => {
      assert.equal(APPROXIMATE_ROUNDING_METERS, 500);
      await assertSucceeds(sendPing("s-approx", ping(Math.max(12, APPROXIMATE_ROUNDING_METERS), { recorded_at: nextFix() })));
      await assertSucceeds(sendPing("s-approx", ping(Math.max(850, APPROXIMATE_ROUNDING_METERS), { recorded_at: nextFix() })));
    });

    it("applies the floor from the next ping after switching to Approximate", async () => {
      // Precise now: a 12 m ping is fine. Then the switch lands, and the same ping isn't.
      await assertSucceeds(sendPing("s-alice", ping(12, { recorded_at: nextFix() })));
      await patchSession({ precision: "approximate" });
      await assertFails(sendPing("s-alice", ping(12, { recorded_at: nextFix() })));
      await assertSucceeds(sendPing("s-alice", ping(500, { recorded_at: nextFix() })));
    });

    it("the ping that applies precision_next is judged by the precision the batch sets", async () => {
      await patchSession({ precision: "precise", precision_next: "approximate" }, "s-approx");
      const apply = (accuracy: number, recordedAt: Timestamp) => sendPing("s-approx", ping(accuracy, { recorded_at: recordedAt }), {
        session: { precision: "approximate", precision_next: null, last_ping_at: serverTimestamp(), last_fix_at: recordedAt },
      });
      await assertFails(apply(12, nextFix()));
      await assertSucceeds(apply(APPROXIMATE_ROUNDING_METERS, nextFix()));
    });
  });

  it("must be exactly lat, lng, recorded_at and accuracy_m, in range", async () => {
    const { accuracy_m: _, ...noAccuracy } = ping(8, { recorded_at: nextFix() });
    await assertFails(sendPing("s-alice", noAccuracy));
    await assertFails(sendPing("s-alice", ping(8, { speed: 3, recorded_at: nextFix() })));
    for (const lat of [-90.0001, 90.0001, NaN, Infinity, "37.7", null]) await assertFails(sendPing("s-alice", ping(8, { lat, recorded_at: nextFix() })));
    for (const lng of [-180.0001, 180.0001, NaN, -Infinity, "-122"]) await assertFails(sendPing("s-alice", ping(8, { lng, recorded_at: nextFix() })));
    await assertFails(sendPing("s-alice", ping(8, { accuracy_m: "8", recorded_at: nextFix() })));
    await assertFails(sendPing("s-alice", ping(8, { recorded_at: Date.now() })));
    await assertFails(sendPing("s-alice", ping(8, { recorded_at: "now" })));
  });

  it("takes the extremes of each range", async () => {
    for (const [lat, lng] of [[-90, -180], [90, 180], [0, 0]]) {
      await assertSucceeds(sendPing("s-alice", ping(8, { lat, lng, recorded_at: nextFix() })));
    }
  });

  it("recorded_at at most 60 s ahead of the server's clock", async () => {
    assert.equal(PING_CLOCK_SKEW_SECONDS, 60);
    await assertFails(sendPing("s-alice", ping(8, { recorded_at: at(Date.now() + 10 * MIN) })));
    await assertFails(sendPing("s-alice", ping(8, { recorded_at: at(Date.now() + (PING_CLOCK_SKEW_SECONDS + 5) * 1000) })));
    await assertSucceeds(sendPing("s-alice", ping(8, { recorded_at: at(Date.now() + (PING_CLOCK_SKEW_SECONDS - 5) * 1000) })));
  });

  it("doc ids: 1 to 64 characters of [A-Za-z0-9_-], which Firestore's auto ids are", async () => {
    assert.equal(PING_ID_MAX_LENGTH, 64);
    for (const id of ["a", "Z9_-", "x".repeat(PING_ID_MAX_LENGTH)]) {
      await assertSucceeds(sendPing("s-alice", ping(8, { recorded_at: nextFix() }), { id }));
    }
    for (const id of ["x".repeat(PING_ID_MAX_LENGTH + 1), "has space", "dot.dot", "\u00fcn\u00ef", "a+b"]) {
      await assertFails(sendPing("s-alice", ping(8, { recorded_at: nextFix() }), { id }));
    }
  });

  it("only while the session is live: not once stopped, past expires_at, or past stop_at", async () => {
    await seedSession("s-stopped", "alice", stoppedSession());
    await seedSession("s-expired", "alice", expiredSession());
    await seedSession("s-past-stop", "alice", pastStopAtSession());
    for (const id of ["s-stopped", "s-expired", "s-past-stop"]) await assertFails(sendPing(id, ping(8)));
  });

  it("right up to the end: 5 s before expires_at or stop_at it's live, 1 s after it isn't", async () => {
    const now = Date.now();
    await seedSession("s-ending", "alice", sessionDoc({ started_at: at(now - 60 * MIN + 5_000), expires_at: at(now + 5_000) }));
    await seedSession("s-ended", "alice", sessionDoc({ started_at: at(now - 60 * MIN - 1_000), expires_at: at(now - 1_000) }));
    await seedSession("s-timer-ending", "alice", manualSession({ stop_at: at(now + 5_000) }));
    await seedSession("s-timer-ended", "alice", manualSession({ stop_at: at(now - 1_000) }));
    await assertSucceeds(sendPing("s-ending", ping(8)));
    await assertFails(sendPing("s-ended", ping(8)));
    await assertSucceeds(sendPing("s-timer-ending", ping(8)));
    await assertFails(sendPing("s-timer-ended", ping(8)));
  });

  it("only the sharer, and pings never change", async () => {
    for (const who of [bob, aliceAnonymous, stranger, viewer, watcher]) await assertFails(sendPing("s-alice", ping(8), { who }));
    await assertFails(update(alice, "shareSessions/s-alice/pings/p1", { accuracy_m: 1 }));
    await assertFails(deleteDoc(doc(dbOf(alice), "shareSessions/s-alice/pings/p1")));
  });

  describe("in order, and at most one ping per 2 s (x-decisions Q-PING-WRITE)", () => {
    it("needs last_fix_at = its recorded_at in the same batch", async () => {
      assert.equal(MIN_PING_SPACING_SECONDS, 2);
      const t = nextFix();
      await assertFails(sendPing("s-alice", ping(8, { recorded_at: t }), { session: { last_ping_at: serverTimestamp() } }));
      await assertFails(sendPing("s-alice", ping(8, { recorded_at: t }), { session: { last_ping_at: serverTimestamp(), last_fix_at: at(t.toMillis() - 1) } }));
      await assertFails(sendPing("s-alice", ping(8, { recorded_at: t }), { session: { last_ping_at: serverTimestamp(), last_fix_at: at(t.toMillis() + 1) } }));
      await assertSucceeds(sendPing("s-alice", ping(8, { recorded_at: t })));
    });

    it("each recorded_at at least 2 s after the last: equal, earlier or 1.999 s later is refused, exactly 2 s later lands", async () => {
      const t = Date.now() - 30_000;
      await assertSucceeds(sendPing("s-alice", ping(8, { recorded_at: at(t) })));
      for (const bad of [t, t - 1, t - 60_000, t + MIN_PING_SPACING_SECONDS * 1000 - 1]) {
        await assertFails(sendPing("s-alice", ping(8, { recorded_at: at(bad) })));
      }
      await assertSucceeds(sendPing("s-alice", ping(8, { recorded_at: at(t + MIN_PING_SPACING_SECONDS * 1000) })));
    });

    it("a retried batch that already landed is refused, so it can't land twice", async () => {
      const data = ping(8, { recorded_at: nextFix() });
      await assertSucceeds(sendPing("s-alice", data));
      await assertFails(sendPing("s-alice", data));
    });

    it("a backlog queued offline still lands, in order, however fast it's sent", async () => {
      const t = Date.now() - 10 * MIN;
      await patchSession({ last_fix_at: at(t) });
      for (let i = 1; i <= 5; i++) await assertSucceeds(sendPing("s-alice", ping(8, { recorded_at: at(t + i * 3_000) })));
    });

    it("a burst can't outrun the clock: at most 60 s of pings ahead of the server, then it waits", async () => {
      const t = Date.now();
      await patchSession({ last_fix_at: at(t) });
      let landed = 0;
      for (let i = 1; i <= 40; i++) {
        const recordedAt = at(t + i * MIN_PING_SPACING_SECONDS * 1000);
        try {
          await sendPing("s-alice", ping(8, { recorded_at: recordedAt }));
          landed++;
        } catch {
          break;
        }
      }
      // 2 s apart, up to 60 s ahead (plus the few seconds the loop itself takes).
      assert.ok(landed >= 28 && landed <= 33, `landed ${landed}`);
      await assertFails(sendPing("s-alice", ping(8, { recorded_at: at(t + (PING_CLOCK_SKEW_SECONDS + 10) * 1000) })));
    });

    it("the first ping: recorded at most 5 minutes before started_at", async () => {
      assert.equal(FIRST_PING_BEFORE_START_MINUTES, 5);
      const startedAt = Date.now() - MIN;
      const fresh = () => patchSession({ started_at: at(startedAt), last_fix_at: null });
      await fresh();
      await assertFails(sendPing("s-alice", ping(8, { recorded_at: at(startedAt - FIRST_PING_BEFORE_START_MINUTES * MIN - 1) })));
      await assertSucceeds(sendPing("s-alice", ping(8, { recorded_at: at(startedAt - FIRST_PING_BEFORE_START_MINUTES * MIN) })));
      // A session backdated by the Admin SDK (QA's --end-in, --limit-in) only lowers that floor.
      await patchSession({ started_at: at(Date.now() - 55 * MIN), expires_at: at(Date.now() + 5 * MIN), last_fix_at: null });
      await assertSucceeds(sendPing("s-alice", ping(8)));
    });

    it("a session from before last_fix_at existed takes its first ping by the same floor", async () => {
      const { last_fix_at: _, ...old } = sessionDoc();
      await seedSession("s-old", "alice", old);
      await assertFails(sendPing("s-old", ping(8, { recorded_at: at(old.started_at.toMillis() - FIRST_PING_BEFORE_START_MINUTES * MIN - 1) })));
      await assertSucceeds(sendPing("s-old", ping(8)));
    });
  });
});

describe("shareSessions/{sessionId}.last_fix_at: the newest ping's recorded_at", () => {
  it("moves forward only, as a timestamp, at most 60 s ahead of the server", async () => {
    const t = Date.now() - 60_000;
    await assertSucceeds(updateSession(alice, { last_fix_at: at(t) }));
    await assertSucceeds(updateSession(alice, { last_fix_at: at(t + 1) }));
    // Writing the value it already has changes nothing, so it stands.
    await assertSucceeds(updateSession(alice, { last_fix_at: at(t + 1) }));
    for (const bad of [at(t), at(t - 60_000), null, "now", t + 10_000, at(Date.now() + (PING_CLOCK_SKEW_SECONDS + 5) * 1000)]) {
      await assertFails(updateSession(alice, { last_fix_at: bad }));
    }
  });

  it("a session from before the field existed takes its first one", async () => {
    const { last_fix_at: _, ...old } = sessionDoc();
    await seedSession("s-old", "alice", old);
    await assertSucceeds(update(alice, "shareSessions/s-old", { last_ping_at: serverTimestamp(), last_fix_at: Timestamp.now() }));
  });

  it("only the sharer, only while live", async () => {
    for (const who of [bob, aliceAnonymous, stranger, viewer, watcher]) {
      await assertFails(updateSession(who, { last_fix_at: Timestamp.now() }));
    }
    for (const over of [stoppedSession(), expiredSession(), pastStopAtSession()]) {
      await patchSession(over);
      await assertFails(updateSession(alice, { last_fix_at: Timestamp.now() }));
    }
  });
});

// ---- place: where the sharer is, in words (x-decisions Q-PLACE) ---------------

const cp = (...points: number[]) => String.fromCodePoint(...points);

/** A place as the apps write it for a precise session: every part set. */
function placeAt(fix: Timestamp, parts: Record<string, unknown> = {}) {
  return { name: "Ferry Building", street: "The Embarcadero", area: "Financial District", city: "San Francisco", at: fix, ...parts };
}
/** What an approximate session may say: the area and the city. */
const areaOnly = (fix: Timestamp) => placeAt(fix, { name: null, street: null });

describe("shareSessions/{sessionId}.place: where the sharer is, in words (x-decisions Q-PLACE)", () => {
  // The session's newest fix is 20 s old; each test's pings come 3 s apart after it.
  let lastFix: Timestamp;
  let clock = 0;
  const nextFix = () => at((clock += 3_000));

  beforeEach(async () => {
    lastFix = at(Date.now() - 20_000);
    clock = lastFix.toMillis();
    await patchSession({ last_fix_at: lastFix });
  });

  const setPlace = (place: unknown, who: Who = alice) => updateSession(who, { place });
  const placeOf = async (who: Who = alice) => (await get(who, "shareSessions/s-alice")).get("place");
  /** A ping as the apps write it, with `place(fix)` in the same batch, plus any other session fields. */
  const pingWithPlace = (place: (fix: Timestamp) => unknown, extra: Record<string, unknown> = {}, accuracy = 8) => {
    const fix = nextFix();
    return sendPing("s-alice", ping(accuracy, { recorded_at: fix }), {
      session: { last_ping_at: serverTimestamp(), last_fix_at: fix, place: place(fix), ...extra },
    });
  };

  it("the seeds match the shared schema", () => {
    const t = Timestamp.now();
    for (const p of [placeAt(t), areaOnly(t)]) assert.deepEqual(validate("Place", p), []);
    for (const place of [placeAt(t), null]) assert.deepEqual(validate("ShareSession", sessionDoc({ place })), []);
  });

  describe("when it's written", () => {
    it("with a ping, in the same batch, at = that ping's recorded_at", async () => {
      await assertSucceeds(pingWithPlace((fix) => placeAt(fix)));
      const place = await placeOf();
      assert.equal(place.at.toMillis(), clock);
      assert.equal(place.street, "The Embarcadero");
    });

    it("in a ping's batch, at may be an earlier fix (a slow lookup) but never later than the ping", async () => {
      await assertFails(pingWithPlace((fix) => placeAt(at(fix.toMillis() + 1))));
      await assertSucceeds(pingWithPlace((fix) => placeAt(at(fix.toMillis() - 3_000))));
    });

    it("on its own, at no later than last_fix_at", async () => {
      await assertSucceeds(setPlace(placeAt(lastFix)));
      await assertSucceeds(setPlace(placeAt(at(lastFix.toMillis() - MIN), { name: "Pier 1" })));
      await assertFails(setPlace(placeAt(at(lastFix.toMillis() + 1), { name: "Pier 3" })));
    });

    it("never before the first ping: last_fix_at null, or a session from before last_fix_at existed", async () => {
      await patchSession({ last_fix_at: null });
      await assertFails(setPlace(placeAt(at(Date.now() - MIN))));
      const { last_fix_at: _, ...old } = sessionDoc();
      await seedSession("s-old", "alice", old);
      await assertFails(update(alice, "shareSessions/s-old", { place: placeAt(at(Date.now() - MIN)) }));
    });

    it("at most PING_CLOCK_SKEW_SECONDS ahead of the server, even when last_fix_at is further ahead", async () => {
      // Only the Admin SDK can put last_fix_at this far ahead; the rules still hold place to the server's clock.
      await patchSession({ last_fix_at: at(Date.now() + 10 * MIN) });
      await assertFails(setPlace(placeAt(at(Date.now() + (PING_CLOCK_SKEW_SECONDS + 5) * 1000))));
      await assertSucceeds(setPlace(placeAt(at(Date.now() + 30_000))));
    });

    it("at is a timestamp", async () => {
      const seconds = Math.floor(lastFix.toMillis() / 1000);
      for (const bad of [null, "now", lastFix.toMillis(), { seconds, nanoseconds: 0 }]) {
        await assertFails(setPlace(placeAt(lastFix, { at: bad })));
      }
    });

    it("null clears it, from a place or from a session from before place existed", async () => {
      await assertSucceeds(setPlace(placeAt(lastFix)));
      await assertSucceeds(setPlace(null));
      assert.equal(await placeOf(), null);
      const { place: _, ...old } = sessionDoc({ last_fix_at: lastFix });
      await seedSession("s-old", "alice", old);
      await assertSucceeds(update(alice, "shareSessions/s-old", { place: null }));
      await assertSucceeds(update(alice, "shareSessions/s-old", { place: placeAt(lastFix) }));
    });

    it("a ping or a check-in without it leaves it as it is", async () => {
      await assertSucceeds(setPlace(placeAt(lastFix)));
      await assertSucceeds(sendPing("s-alice", ping(8, { recorded_at: nextFix() })));
      await assertSucceeds(updateSession(alice, { last_ping_at: serverTimestamp() }));
      assert.equal((await placeOf()).name, "Ferry Building");
    });
  });

  describe("its shape", () => {
    it("exactly name, street, area, city and at", async () => {
      for (const key of ["name", "street", "area", "city", "at"]) {
        const missing: Record<string, unknown> = placeAt(lastFix);
        delete missing[key];
        await assertFails(setPlace(missing));
      }
      await assertFails(setPlace(placeAt(lastFix, { house_number: "1" })));
      await assertFails(setPlace("Ferry Building"));
      await assertFails(setPlace([placeAt(lastFix)]));
    });

    it("at least one of the four parts", async () => {
      await assertFails(setPlace(placeAt(lastFix, { name: null, street: null, area: null, city: null })));
      for (const key of ["name", "street", "area", "city"]) {
        const only = { name: null, street: null, area: null, city: null, [key]: "Somewhere" };
        await assertSucceeds(setPlace({ ...only, at: lastFix }));
      }
    });

    it("each part null or a string", async () => {
      for (const key of ["name", "street", "area", "city"]) {
        for (const bad of [42, true, ["Ferry Building"], { en: "Ferry Building" }, lastFix]) {
          await assertFails(setPlace(placeAt(lastFix, { [key]: bad })));
        }
      }
    });

    it("1 to PLACE_PART_MAX_LENGTH (80) UTF-16 code units", async () => {
      assert.equal(PLACE_PART_MAX_LENGTH, 80);
      // 40 emoji are 80 UTF-16 code units; the rules' size() counts those.
      const bridges = cp(0x1f309).repeat(40);
      for (const ok of ["x", "x".repeat(80), bridges]) {
        await assertSucceeds(setPlace(placeAt(lastFix, { name: ok })));
      }
      for (const bad of ["", "x".repeat(81), bridges + "x"]) {
        await assertFails(setPlace(placeAt(lastFix, { name: bad })));
      }
    });

    it("trimmed: no space at either end, or a part of only spaces", async () => {
      for (const bad of [" Ferry Building", "Ferry Building ", " ", "   "]) {
        await assertFails(setPlace(placeAt(lastFix, { name: bad })));
      }
      await assertSucceeds(setPlace(placeAt(lastFix, { name: "Pier 39  Fisherman's Wharf" })));
    });

    it("no control character, and no bidi override or isolate, anywhere", async () => {
      for (const c of [0x09, 0x0a, 0x0d, 0x1f, 0x7f, 0x85, 0x9f, 0x202a, 0x202d, 0x202e, 0x2066, 0x2068, 0x2069]) {
        for (const bad of [`Ferry${cp(c)}Building`, `${cp(c)}Ferry`, `Ferry${cp(c)}`]) {
          await assertFails(setPlace(placeAt(lastFix, { street: bad })));
        }
      }
    });

    it("any language: accents, CJK, right-to-left text and its marks", async () => {
      const names = [
        `Caf${cp(0xe9)} de la Presse`,
        cp(0x91d1, 0x9580, 0x5927, 0x6a4b),
        cp(0x645, 0x62a, 0x62d, 0x641),
        `Ferry${cp(0x200e)} Building`,
      ];
      for (const ok of names) await assertSucceeds(setPlace(placeAt(lastFix, { name: ok })));
    });

    it("the shared schema takes every part the rules take, and refuses what they refuse but for length", async () => {
      const taken = ["x", "x".repeat(80), cp(0x1f309).repeat(40), "Pier 39", `Caf${cp(0xe9)}`, `a${cp(0x200e)}b`, `${cp(0xa0)}Mission`];
      for (const part of taken) {
        await assertSucceeds(setPlace(placeAt(lastFix, { area: part })));
        assert.deepEqual(validate("PlacePart", part), [], JSON.stringify(part));
      }
      const refused = ["", " x", "x ", `a${cp(0x0a)}b`, `a${cp(0x7f)}b`, `a${cp(0x202e)}b`, `a${cp(0x2069)}b`];
      for (const part of refused) {
        await assertFails(setPlace(placeAt(lastFix, { area: part })));
        assert.notDeepEqual(validate("PlacePart", part), [], JSON.stringify(part));
      }
      // The schema counts code points, so it is never the stricter of the two.
      assert.deepEqual(validate("PlacePart", cp(0x1f309).repeat(80)), []);
    });
  });

  describe("while Approximate, the area only", () => {
    it("an approximate session takes area and city, never name or street", async () => {
      await patchSession({ precision: "approximate" });
      await assertSucceeds(setPlace(areaOnly(lastFix)));
      await assertSucceeds(setPlace({ name: null, street: null, area: null, city: "San Francisco", at: lastFix }));
      await assertFails(setPlace(placeAt(lastFix, { street: null })));
      await assertFails(setPlace(placeAt(lastFix, { name: null })));
    });

    it("a pending switch to Approximate counts: precision_next", async () => {
      await assertFails(updateSession(alice, { precision_next: "approximate", place: placeAt(lastFix) }));
      await assertSucceeds(updateSession(alice, { precision_next: "approximate", place: areaOnly(lastFix) }));
    });

    it("turning Approximate on must drop name and street from the place the session holds, in the same write", async () => {
      await assertSucceeds(setPlace(placeAt(lastFix)));
      await assertFails(updateSession(alice, { precision_next: "approximate" }));
      await assertFails(pingWithPlace((fix) => placeAt(fix), { precision: "approximate", precision_next: null }, APPROXIMATE_ROUNDING_METERS));
      await assertSucceeds(updateSession(alice, { precision_next: "approximate", place: areaOnly(lastFix) }));
      await assertSucceeds(updateSession(alice, { precision_next: null, place: placeAt(lastFix) }));
      await assertSucceeds(updateSession(alice, { precision_next: "approximate", place: null }));
    });

    it("the ping that applies Approximate can carry the new place", async () => {
      await assertSucceeds(setPlace(placeAt(lastFix)));
      await assertSucceeds(pingWithPlace(areaOnly, { precision: "approximate", precision_next: null }, APPROXIMATE_ROUNDING_METERS));
      assert.equal((await placeOf()).street, null);
    });

    it("a pending switch to Precise lets name and street in at once; cancelling it drops them again", async () => {
      await patchSession({ precision: "approximate", precision_next: "precise" });
      await assertSucceeds(setPlace(placeAt(lastFix)));
      await assertFails(updateSession(alice, { precision_next: null }));
      await assertSucceeds(updateSession(alice, { precision_next: null, place: areaOnly(lastFix) }));
    });
  });

  describe("who, and when", () => {
    it("only the sharer: not the viewer, a watcher, another sharer or anyone else, not even null", async () => {
      await assertSucceeds(setPlace(placeAt(lastFix)));
      for (const who of [viewer, watcher, otherViewer, bob, aliceAnonymous, stranger]) {
        await assertFails(setPlace(placeAt(lastFix, { name: "Pier 1" }), who));
        await assertFails(setPlace(null, who));
      }
      assert.equal((await placeOf()).name, "Ferry Building");
      await assertFails(updateSession(viewer, { viewer_sharing: true, place: null }));
    });

    it("only while live: never once it's over (stopped, past expires_at, past stop_at), not even null", async () => {
      // Past stop_at or expires_at, before the stop job runs, the doc may still hold the last place.
      for (const over of [stoppedSession(), expiredSession(), pastStopAtSession()]) {
        await patchSession({ ...over, last_fix_at: lastFix, place: placeAt(lastFix) });
        await assertFails(setPlace(placeAt(lastFix, { name: "Pier 1" })));
        await assertFails(setPlace(null));
      }
    });

    it("the viewer and a watcher read it with the session while it's live", async () => {
      await assertSucceeds(setPlace(placeAt(lastFix)));
      for (const who of [viewer, watcher]) assert.equal((await placeOf(who)).name, "Ferry Building");
    });

    it("after the end the doc the viewer still reads holds none, and no client can put one back", async () => {
      // Every end writes place null (functions sessions/end.ts endFields; the functions' tests cover each path).
      await patchSession(stoppedSession({ last_fix_at: lastFix, place: null }));
      for (const who of [viewer, watcher]) assert.equal(await placeOf(who), null);
      await assertFails(setPlace(placeAt(lastFix)));
    });
  });
});

describe("shareSessions/{sessionId}/viewerPings", () => {
  const VIEWER_PINGS = "shareSessions/s-alice/viewerPings";
  const add = (who: Who, data: Record<string, unknown> = ping(15)) => addDoc(collection(dbOf(who), VIEWER_PINGS), data);

  /** Share my location: viewer_sharing on and the first ping, in one batch. */
  function startSharing(who: Who, accuracy = 15) {
    const db = dbOf(who);
    const batch = writeBatch(db);
    batch.update(doc(db, "shareSessions/s-alice"), { viewer_sharing: true });
    batch.set(doc(collection(db, VIEWER_PINGS)), ping(accuracy));
    return batch.commit();
  }

  describe("writing: the viewer, while share back is open and viewer_sharing is on", () => {
    it("turning share back on with the first ping in one batch, then pinging", async () => {
      await assertSucceeds(startSharing(viewer));
      await assertSucceeds(add(viewer));
    });

    it("needs viewer_sharing on", async () => {
      await assertFails(add(viewer));
    });

    it("stops when share back closes: the call ends, the watchdog clears call_active, the switch is off, the sharer goes quiet, or the session ends", async () => {
      for (const closed of [
        { call_active: false, call_ended_at: Timestamp.now() },
        { call_active: false },
        { share_back_allowed: false },
        { last_ping_at: at(Date.now() - 3 * MIN) },
        stoppedSession(),
        expiredSession(),
      ]) {
        await patchSession({ ...closed, viewer_sharing: true });
        await assertFails(add(viewer));
        await patchSession(sessionDoc());
      }
    });

    it("takes exactly a ping, in range", async () => {
      await patchSession({ viewer_sharing: true });
      await assertSucceeds(add(viewer, ping(0)));
      await assertSucceeds(add(viewer, ping(MAX_ACCURACY_METERS)));
      await assertFails(add(viewer, ping(15, { speed: 1 })));
      await assertFails(add(viewer, ping(15, { lat: -91 })));
      await assertFails(add(viewer, ping(-1)));
      await assertFails(add(viewer, ping(MAX_ACCURACY_METERS + 1)));
      await assertFails(add(viewer, ping(15, { recorded_at: at(Date.now() + (PING_CLOCK_SKEW_SECONDS + 5) * 1000) })));
    });

    it("doc ids: 1 to 64 characters of [A-Za-z0-9_-]", async () => {
      await patchSession({ viewer_sharing: true });
      const put = (id: string) => setDoc(doc(dbOf(viewer), `${VIEWER_PINGS}/${id}`), ping(15));
      await assertSucceeds(put("x".repeat(PING_ID_MAX_LENGTH)));
      await assertFails(put("x".repeat(PING_ID_MAX_LENGTH + 1)));
      await assertFails(put("no spaces"));
    });

    it("never from a watcher, a page posing as the viewer, another session's viewer, or the sharer", async () => {
      await patchSession({ viewer_sharing: true });
      for (const who of [watcher, posingViewer, otherViewer, phoneWithViewerClaims, customWithoutClaims, alice, bob, stranger]) {
        await assertFails(add(who));
      }
      await assertFails(startSharing(watcher));
    });

    it("viewer pings never change", async () => {
      await assertFails(update(viewer, `${VIEWER_PINGS}/v1`, { accuracy_m: 1 }));
      await assertFails(deleteDoc(doc(dbOf(viewer), `${VIEWER_PINGS}/v1`)));
      await assertFails(deleteDoc(doc(dbOf(alice), `${VIEWER_PINGS}/v1`)));
    });
  });

  describe("reading: the sharer only", () => {
    it("the sharer can read the viewer's pings", async () => {
      await assertSucceeds(get(alice, `${VIEWER_PINGS}/v1`));
      const snap = await assertSucceeds(list(alice, VIEWER_PINGS));
      assert.equal(snap.size, 1);
    });

    it("nobody else, not even the viewer", async () => {
      for (const who of [viewer, watcher, bob, aliceAnonymous, stranger, otherViewer]) {
        await assertFails(get(who, `${VIEWER_PINGS}/v1`));
        await assertFails(list(who, VIEWER_PINGS));
      }
    });
  });
});

describe("mascots/{mascotId}: public read", () => {
  it("anyone can read the library, signed in or not", async () => {
    for (const [, who] of EVERYONE) {
      const snap = await assertSucceeds(get(who, "mascots/fox"));
      assert.equal(snap.get("set"), "classics");
      await assertSucceeds(list(who, "mascots"));
    }
  });

  it("nobody writes it from a client: it's seeded from the shared catalog", async () => {
    for (const [, who] of EVERYONE) {
      await assertFails(setDoc(doc(dbOf(who), "mascots/ghost"), { character: "ghost", set: "classics", default_color: "original", accessories: [] }));
      await assertFails(update(who, "mascots/fox", { accessories: [] }));
      await assertFails(deleteDoc(doc(dbOf(who), "mascots/fox")));
    }
  });
});
