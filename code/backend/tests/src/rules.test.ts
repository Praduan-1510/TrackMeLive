/**
 * Firestore rules, Sprint 0: deny by default; a sharer can reach only their own
 * session; and a sharer's pings are well formed and, while the session is
 * Approximate, never more accurate than 500 m.
 *
 * Sessions are created by the createSession function, never by a client, so
 * these tests also prove a client can't create a session directly, not even its
 * own. createSession.test.ts proves the function side: the session it creates
 * always belongs to the caller.
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
  type Precision,
} from "../../../shared/schema/generated/ts/schema.ts";
import { FIRESTORE, PROJECT_ID } from "./emulators.ts";

const RULES_PATH = new URL("../../firestore.rules", import.meta.url);

let env: RulesTestEnvironment;

// Every denied write is expected here; don't let the SDK log each one as a warning.
setLogLevel("error");

// Sharers sign in with a phone number; the token says so.
const sharer = (uid: string, phone: string): RulesTestContext =>
  env.authenticatedContext(uid, { phone_number: phone, firebase: { sign_in_provider: "phone" } });

const alice = () => sharer("alice", "+15555550101");
const bob = () => sharer("bob", "+15555550102");
// Same uid as Alice, but an anonymous sign-in: never a sharer.
const aliceAnonymous = () => env.authenticatedContext("alice", { firebase: { sign_in_provider: "anonymous" } });
// A viewer's custom one-session sign-in (claims {sid, role}); no client access in Sprint 0.
const viewer = () => env.authenticatedContext("viewer-1", { sid: "s-alice", role: "viewer", firebase: { sign_in_provider: "custom" } });
const stranger = () => env.unauthenticatedContext();

const MIN = 60_000;

/** A session as createSession writes it (shared ShareSession). */
function sessionDoc(opts: { precision?: Precision; status?: "active" | "stopped"; startedAt?: number } = {}) {
  const now = opts.startedAt ?? Date.now();
  const stopped = opts.status === "stopped";
  return {
    status: opts.status ?? "active",
    started_at: Timestamp.fromMillis(now),
    expires_at: Timestamp.fromMillis(now + 60 * MIN),
    stop_rule: "minutes",
    stop_minutes: 30,
    stop_at: Timestamp.fromMillis(now + 30 * MIN),
    ended_at: stopped ? Timestamp.fromMillis(now + MIN) : null,
    end_reason: stopped ? "stopped" : null,
    call_id: null,
    call_active: false,
    call_ended_at: null,
    share_back_allowed: false,
    last_ping_at: Timestamp.fromMillis(now),
    ping_interval_s: 5,
    precision: opts.precision ?? "precise",
    precision_next: null,
    sharer: { name: "Alex", mascot_id: "fox", mascot_color: "original", mascot_accessory: null },
    first_viewed_at: null,
    viewer_sharing: false,
    share_back_requested_at: null,
  };
}

function metaDoc(userId: string) {
  return { user_id: userId, link_token_hash: "0".repeat(64), viewer_uid: null, viewer_name: null, activity_push_token: null };
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

/** Seeds a session the way createSession does, with rules off. */
async function seedSession(sessionId: string, ownerUid: string, session = sessionDoc()): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `shareSessions/${sessionId}`), session);
    await setDoc(doc(db, `shareSessions/${sessionId}/private/meta`), metaDoc(ownerUid));
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
  await seedSession("s-alice", "alice");
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "shareSessions/s-alice/pings/p1"), ping(8));
    await setDoc(doc(db, "users/alice"), userDoc());
    await setDoc(doc(db, "mascots/fox"), { character: "fox", set: "classics", default_color: "original", accessories: ["headphones", "glasses", "headlamp"] });
    await setDoc(doc(db, "callLogs/c1"), { user_id: "alice", session_id: "s-alice", call_id: "x", call_time: Timestamp.now() });
  });
});

after(async () => {
  await env?.cleanup();
});

describe("the seed docs match the shared schema", () => {
  it("session, meta, user and ping", () => {
    assert.deepEqual(validate("ShareSession", sessionDoc()), []);
    assert.deepEqual(validate("ShareSession", sessionDoc({ status: "stopped", precision: "approximate" })), []);
    assert.deepEqual(validate("SessionPrivateMeta", metaDoc("alice")), []);
    assert.deepEqual(validate("User", userDoc()), []);
    assert.deepEqual(validate("Ping", ping(8)), []);
  });
});

describe("deny by default", () => {
  const paths = [
    "users/alice",
    "users/alice/devices/d1",
    "users/alice/trustedContacts/t1",
    "shareSessions/s-alice/pings/p1",
    "shareSessions/s-alice/viewerPings/v1",
    "mascots/fox",
    "callLogs/c1",
    "somethingElse/x",
  ];

  for (const who of [
    { label: "signed out", ctx: stranger },
    { label: "a signed-in sharer", ctx: alice },
    { label: "a viewer sign-in", ctx: viewer },
  ]) {
    describe(who.label, () => {
      for (const path of paths) {
        it(`can't read ${path}`, async () => {
          await assertFails(getDoc(doc(who.ctx().firestore(), path)));
        });
        it(`can't write junk to ${path}`, async () => {
          await assertFails(setDoc(doc(who.ctx().firestore(), path), { x: 1 }));
        });
      }
    });
  }

  it("a signed-out client or a viewer can't read a session or its meta (Sprint 0)", async () => {
    for (const ctx of [stranger(), viewer()]) {
      await assertFails(getDoc(doc(ctx.firestore(), "shareSessions/s-alice")));
      await assertFails(getDoc(doc(ctx.firestore(), "shareSessions/s-alice/private/meta")));
    }
  });

  it("nobody can list sessions", async () => {
    await assertFails(getDocs(collection(alice().firestore(), "shareSessions")));
    await assertFails(getDocs(collection(stranger().firestore(), "shareSessions")));
  });

  it("nobody can list another collection, either", async () => {
    await assertFails(getDocs(collection(alice().firestore(), "users")));
    await assertFails(getDocs(collection(alice().firestore(), "callLogs")));
  });
});

describe("a sharer and their own session", () => {
  it("can read their own session", async () => {
    const snap = await assertSucceeds(getDoc(doc(alice().firestore(), "shareSessions/s-alice")));
    assert.equal(snap.get("status"), "active");
  });

  it("can read their own private/meta", async () => {
    await assertSucceeds(getDoc(doc(alice().firestore(), "shareSessions/s-alice/private/meta")));
  });

  it("can't read any other doc under private", async () => {
    await assertFails(getDoc(doc(alice().firestore(), "shareSessions/s-alice/private/other")));
  });

  it("can't create a session directly, even with themselves as owner", async () => {
    const db = alice().firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, "shareSessions/s-new"), { ...sessionDoc(), started_at: serverTimestamp() });
    batch.set(doc(db, "shareSessions/s-new/private/meta"), metaDoc("alice"));
    await assertFails(batch.commit());
    await assertFails(addDoc(collection(db, "shareSessions"), sessionDoc()));
  });

  it("can't change or delete their own session from the client in Sprint 0", async () => {
    const db = alice().firestore();
    await assertFails(updateDoc(doc(db, "shareSessions/s-alice"), { status: "stopped" }));
    await assertFails(updateDoc(doc(db, "shareSessions/s-alice/private/meta"), { user_id: "bob" }));
    await assertFails(deleteDoc(doc(db, "shareSessions/s-alice")));
  });

  it("an anonymous sign-in with the same uid isn't a sharer", async () => {
    const db = aliceAnonymous().firestore();
    await assertFails(getDoc(doc(db, "shareSessions/s-alice")));
    await assertFails(getDoc(doc(db, "shareSessions/s-alice/private/meta")));
  });
});

describe("a sharer and someone else's session", () => {
  it("can't read it or its meta", async () => {
    const db = bob().firestore();
    await assertFails(getDoc(doc(db, "shareSessions/s-alice")));
    await assertFails(getDoc(doc(db, "shareSessions/s-alice/private/meta")));
  });

  it("can't create a session that names someone else as owner", async () => {
    const db = bob().firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, "shareSessions/s-bob-as-alice"), sessionDoc());
    batch.set(doc(db, "shareSessions/s-bob-as-alice/private/meta"), metaDoc("alice"));
    await assertFails(batch.commit());
  });

  it("can't take over a session by rewriting its meta", async () => {
    const db = bob().firestore();
    await assertFails(setDoc(doc(db, "shareSessions/s-alice/private/meta"), metaDoc("bob")));
  });

  it("can't read a session that has no meta", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "shareSessions/s-orphan"), sessionDoc());
    });
    await assertFails(getDoc(doc(alice().firestore(), "shareSessions/s-orphan")));
    await assertFails(getDoc(doc(bob().firestore(), "shareSessions/s-orphan")));
  });

  it("can't write pings to it", async () => {
    await assertFails(addDoc(collection(bob().firestore(), "shareSessions/s-alice/pings"), ping(8)));
  });
});

describe("pings", () => {
  const add = (sessionId: string, data: Record<string, unknown>, ctx = alice()) =>
    addDoc(collection(ctx.firestore(), `shareSessions/${sessionId}/pings`), data);

  it("a precise session takes the raw accuracy", async () => {
    await assertSucceeds(add("s-alice", ping(4.7)));
    await assertSucceeds(add("s-alice", ping(0)));
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
      await env.withSecurityRulesDisabled(async (ctx) => {
        await updateDoc(doc(ctx.firestore(), "shareSessions/s-alice"), { precision: "approximate" });
      });
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
    await assertFails(add("s-alice", ping(8, { recorded_at: Timestamp.fromMillis(Date.now() + 10 * MIN) })));
  });

  it("only while the session is live", async () => {
    await seedSession("s-stopped", "alice", sessionDoc({ status: "stopped" }));
    await seedSession("s-expired", "alice", sessionDoc({ startedAt: Date.now() - 61 * MIN }));
    await assertFails(add("s-stopped", ping(8)));
    await assertFails(add("s-expired", ping(8)));
  });

  it("can't be changed or deleted, or written by a viewer or a stranger", async () => {
    const db = alice().firestore();
    await assertFails(updateDoc(doc(db, "shareSessions/s-alice/pings/p1"), { accuracy_m: 1 }));
    await assertFails(deleteDoc(doc(db, "shareSessions/s-alice/pings/p1")));
    await assertFails(add("s-alice", ping(8), viewer()));
    await assertFails(add("s-alice", ping(8), stranger()));
    await assertFails(add("s-alice", ping(8), aliceAnonymous()));
  });
});
