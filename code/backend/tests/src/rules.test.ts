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
  it("sessions, meta, user, device, ping, call log and sign-in", () => {
    for (const s of [sessionDoc(), manualSession(), stoppedSession(), expiredSession(), pastStopAtSession()]) {
      assert.deepEqual(validate("ShareSession", s), []);
    }
    assert.deepEqual(validate("SessionPrivateMeta", metaDoc("alice")), []);
    assert.deepEqual(validate("User", userDoc()), []);
    assert.deepEqual(validate("Device", { ...device(), updated_at: Timestamp.now() }), []);
    assert.deepEqual(validate("Ping", ping(8)), []);
    assert.deepEqual(validate("CallLog", { user_id: "alice", session_id: "s-alice", call_id: "call-1", call_time: Timestamp.now() }), []);
    assert.deepEqual(validate("ViewerSignIn", { role: "viewer", created_at: Timestamp.now() }), []);
  });
});

describe("function-only paths: no client access at all", () => {
  const docs = [
    "callLogs/s-alice",
    "shareSessions/s-alice/viewerSignIns/viewer-1",
    "users/alice/trustedContacts/t1",
    "somethingElse/x",
  ];
  const collections = ["callLogs", "shareSessions/s-alice/viewerSignIns", "users/alice/trustedContacts", "somethingElse"];

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

  it("the next ping applies precision_next in the same batch, and is judged by the precision it sets", async () => {
    await patchSession({ precision_next: "approximate" });
    const db = dbOf(alice);
    const apply = (accuracy: number) => {
      const batch = writeBatch(db);
      batch.update(doc(db, "shareSessions/s-alice"), { precision: "approximate", precision_next: null, last_ping_at: serverTimestamp() });
      batch.set(doc(collection(db, "shareSessions/s-alice/pings")), ping(accuracy));
      return batch.commit();
    };
    await assertFails(apply(12));
    await assertSucceeds(apply(APPROXIMATE_ROUNDING_METERS));
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

  it("nobody else, and no viewer page of another session", async () => {
    for (const who of [bob, aliceAnonymous, stranger, otherViewer, phoneWithViewerClaims, customWithoutClaims]) {
      await assertFails(get(who, `${PINGS}/p1`));
      await assertFails(list(who, PINGS));
    }
  });
});

describe("shareSessions/{sessionId}/pings: writing", () => {
  const add = (sessionId: string, data: Record<string, unknown>, who: Who = alice) =>
    addDoc(collection(dbOf(who), `shareSessions/${sessionId}/pings`), data);

  it("a precise session takes the raw accuracy", async () => {
    await assertSucceeds(add("s-alice", ping(4.7)));
    await assertSucceeds(add("s-alice", ping(0)));
  });

  it("a ping and its check-in go in one batch", async () => {
    const db = dbOf(alice);
    const batch = writeBatch(db);
    batch.set(doc(collection(db, "shareSessions/s-alice/pings")), ping(8));
    batch.update(doc(db, "shareSessions/s-alice"), { last_ping_at: serverTimestamp() });
    await assertSucceeds(batch.commit());
  });

  describe("while the session is Approximate, accuracy_m is at least 500", () => {
    beforeEach(async () => {
      await seedSession("s-approx", "alice", sessionDoc({ precision: "approximate" }));
    });

    it("refuses a ping that is more accurate than the rounded point", async () => {
      for (const accuracy of [4.7, 100, 499, 499.99]) {
        await assertFails(add("s-approx", ping(accuracy)));
      }
    });

    it("takes max(raw, 500): exactly 500, or a worse raw fix", async () => {
      assert.equal(APPROXIMATE_ROUNDING_METERS, 500);
      await assertSucceeds(add("s-approx", ping(Math.max(12, APPROXIMATE_ROUNDING_METERS))));
      await assertSucceeds(add("s-approx", ping(Math.max(850, APPROXIMATE_ROUNDING_METERS))));
    });

    it("applies the floor from the next ping after switching to Approximate", async () => {
      // Precise now: a 12 m ping is fine. Then the switch lands, and the same ping isn't.
      await assertSucceeds(add("s-alice", ping(12)));
      await patchSession({ precision: "approximate" });
      await assertFails(add("s-alice", ping(12)));
      await assertSucceeds(add("s-alice", ping(500)));
    });
  });

  it("must be exactly lat, lng, recorded_at and accuracy_m, in range", async () => {
    const { accuracy_m: _, ...noAccuracy } = ping(8);
    await assertFails(add("s-alice", noAccuracy));
    await assertFails(add("s-alice", ping(-1)));
    await assertFails(add("s-alice", ping(8, { speed: 3 })));
    await assertFails(add("s-alice", ping(8, { lat: 91 })));
    await assertFails(add("s-alice", ping(8, { lng: -181 })));
    await assertFails(add("s-alice", ping(8, { lat: "37.7" })));
    await assertFails(add("s-alice", ping(8, { accuracy_m: "8" })));
    await assertFails(add("s-alice", ping(8, { recorded_at: at(Date.now() + 10 * MIN) })));
  });

  it("only while the session is live: not once stopped, past expires_at, or past stop_at", async () => {
    await seedSession("s-stopped", "alice", stoppedSession());
    await seedSession("s-expired", "alice", expiredSession());
    await seedSession("s-past-stop", "alice", pastStopAtSession());
    for (const id of ["s-stopped", "s-expired", "s-past-stop"]) await assertFails(add(id, ping(8)));
  });

  it("only the sharer, and pings never change", async () => {
    for (const who of [bob, aliceAnonymous, stranger, viewer, watcher]) await assertFails(add("s-alice", ping(8), who));
    await assertFails(update(alice, "shareSessions/s-alice/pings/p1", { accuracy_m: 1 }));
    await assertFails(deleteDoc(doc(dbOf(alice), "shareSessions/s-alice/pings/p1")));
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
      await assertFails(add(viewer, ping(15, { speed: 1 })));
      await assertFails(add(viewer, ping(15, { lat: -91 })));
      await assertFails(add(viewer, ping(-1)));
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
