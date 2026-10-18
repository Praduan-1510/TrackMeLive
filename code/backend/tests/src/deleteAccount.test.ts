/**
 * deleteAccount against the emulators (FSD §8 "Deletion"). The accounts are
 * built the way the apps build them: phone sign-in, saveProfile, createSession,
 * stopSession, and viewer browsers that redeem the link and sign in. Then the
 * test checks that everything of the caller's is gone, a live share was stopped
 * first, someone else's data is untouched, and a repeat call or a retry after a
 * partial run finishes cleanly.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, Timestamp, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import {
  DEFAULT_USER_SETTINGS,
  validate,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type DeleteAccountResponse,
  type RedeemLinkTokenResponse,
} from "../../../shared/schema/generated/ts/schema.ts";
import { signInWithCustomToken } from "./authEmulator.ts";
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

let app: App;
let db: Firestore;
let auth: Auth;
let phoneCounter = 0;

const callShare: CreateSessionRequest = {
  stop_rule: "call", stop_minutes: null, call_id: "call-1", share_back_allowed: true, precision: "precise",
};
const manualShare: CreateSessionRequest = {
  stop_rule: "minutes", stop_minutes: 30, call_id: null, share_back_allowed: false, precision: "approximate",
};

function ok<T>(r: CallableResult<T>): T {
  assert.ok(r.ok, JSON.stringify(r));
  return r.data;
}

const deleteAccount = (who: SignedIn | null, data: unknown = null) =>
  callFunction<DeleteAccountResponse>("deleteAccount", data, who?.idToken);

/** A sharer with a saved profile and two devices. */
async function newSharer(name: string): Promise<SignedIn> {
  const sharer = await signInWithPhone(`+155555504${String(++phoneCounter).padStart(2, "0")}`);
  ok(await callFunction("saveProfile", { name, mascot_id: "fox", mascot_color: "moss", mascot_accessory: "headlamp", settings: DEFAULT_USER_SETTINGS }, sharer.idToken));
  for (const [id, platform] of [["d-ios", "ios"], ["d-android", "android"]] as const) {
    await db.doc(`users/${sharer.uid}/devices/${id}`).set({
      platform, push_token: `token-${id}`, live_activity_start_token: null, updated_at: Timestamp.now(),
    });
  }
  return sharer;
}

/** A share with a viewer and a watcher signed in, and pings both ways. */
async function shareWithViewers(sharer: SignedIn, request: CreateSessionRequest): Promise<{ session: DocumentReference; viewerUids: string[] }> {
  const created = ok(await callFunction<CreateSessionResponse>("createSession", request, sharer.idToken));
  const viewerUids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const res = ok(await callFunction<RedeemLinkTokenResponse>("redeemLinkToken", { link_token: created.link_token }));
    viewerUids.push((await signInWithCustomToken(res.custom_token)).uid);
  }
  const session = db.doc(`shareSessions/${created.session_id}`);
  const ping = { lat: 51.5, lng: -0.12, accuracy_m: 600, recorded_at: Timestamp.now() };
  await session.collection("pings").add(ping);
  await session.collection("pings").add(ping);
  await session.collection("viewerPings").add({ ...ping, accuracy_m: 9 });
  return { session, viewerUids };
}

/** An account with one stopped share and one live call share, as an app would leave it. */
async function fullAccount(name: string) {
  const sharer = await newSharer(name);
  const earlier = await shareWithViewers(sharer, manualShare);
  ok(await callFunction("stopSession", { session_id: earlier.session.id }, sharer.idToken));
  const live = await shareWithViewers(sharer, callShare);
  return { sharer, earlier, live, sessions: [earlier.session, live.session], viewerUids: [...earlier.viewerUids, ...live.viewerUids] };
}

async function authUserExists(uid: string): Promise<boolean> {
  try {
    await auth.getUser(uid);
    return true;
  } catch (error) {
    assert.equal((error as { code?: unknown }).code, "auth/user-not-found");
    return false;
  }
}

/** Nothing of the account is left: Firestore and Auth. */
async function assertAllGone(uid: string, sessions: readonly DocumentReference[], viewerUids: readonly string[]) {
  assert.equal((await db.doc(`users/${uid}`).get()).exists, false, "users doc");
  assert.deepEqual((await db.doc(`users/${uid}`).listCollections()).map((c) => c.id), [], "devices");
  for (const session of sessions) {
    assert.equal((await session.get()).exists, false, `session ${session.id}`);
    assert.deepEqual((await session.listCollections()).map((c) => c.id), [], `under session ${session.id}`);
    assert.equal((await db.doc(`callLogs/${session.id}`).get()).exists, false, `callLogs/${session.id}`);
  }
  assert.equal((await db.collectionGroup("private").where("user_id", "==", uid).get()).size, 0, "owned private/meta");
  assert.equal((await db.collection("callLogs").where("user_id", "==", uid).get()).size, 0, "callLogs");
  for (const viewerUid of viewerUids) assert.equal(await authUserExists(viewerUid), false, `viewer ${viewerUid}`);
  assert.equal(await authUserExists(uid), false, "the sharer's Auth user");
}

/** Records each state of a doc as a listener sees it, until it's deleted. */
function watch(ref: DocumentReference) {
  const states: string[] = [];
  let first: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => { first = resolve; });
  const stop = ref.onSnapshot((snap) => {
    states.push(snap.exists ? `${String(snap.get("status"))}:${String(snap.get("end_reason"))}` : "deleted");
    first();
  });
  return {
    states,
    ready,
    async untilDeleted() {
      for (let i = 0; i < 100 && !states.includes("deleted"); i++) await new Promise((r) => setTimeout(r, 50));
      stop();
    },
  };
}

let bob: Awaited<ReturnType<typeof fullAccount>>;

before(async () => {
  await clearFirestore();
  await clearAuth();
  app = initializeApp({ projectId: PROJECT_ID }, "deleteAccount-test");
  db = getFirestore(app);
  auth = getAuth(app);
  // Someone else's account, which no call here may touch.
  bob = await fullAccount("Bob");
});

after(async () => {
  if (app) await deleteApp(app);
});

/** Bob's account is exactly as it was. */
async function assertBobIntact() {
  assert.equal((await db.doc(`users/${bob.sharer.uid}`).get()).exists, true);
  assert.equal((await db.collection(`users/${bob.sharer.uid}/devices`).get()).size, 2);
  for (const session of bob.sessions) {
    assert.equal((await session.get()).exists, true);
    assert.equal((await session.collection("private").doc("meta").get()).get("user_id"), bob.sharer.uid);
    assert.equal((await session.collection("pings").get()).size, 2);
    assert.equal((await session.collection("viewerSignIns").get()).size, 2);
  }
  assert.equal((await bob.live.session.get()).get("status"), "active");
  assert.equal((await db.doc(`callLogs/${bob.live.session.id}`).get()).exists, true);
  for (const uid of [bob.sharer.uid, ...bob.viewerUids]) assert.equal(await authUserExists(uid), true, uid);
}

describe("deleteAccount: who may call it", () => {
  it("refuses a signed-out caller", async () => {
    const r = await deleteAccount(null);
    assert.equal(!r.ok && r.code, "UNAUTHENTICATED");
  });

  it("refuses an anonymous sign-in", async () => {
    const r = await deleteAccount(await signInAnonymously());
    assert.equal(!r.ok && r.code, "PERMISSION_DENIED");
  });

  it("refuses a viewer's sign-in, even on the session it may read", async () => {
    const viewer = await signInWithCustomToken(await auth.createCustomToken(bob.live.viewerUids[0]!, { sid: bob.live.session.id, role: "viewer" }));
    const r = await deleteAccount(viewer);
    assert.equal(!r.ok && r.code, "PERMISSION_DENIED");
    await assertBobIntact();
  });

  it("refuses a request with any field in it, and deletes nothing", async () => {
    for (const [data, fields] of [
      [{ uid: bob.sharer.uid }, ["uid"]],
      [{ confirm: true }, ["confirm"]],
      ["yes", ["(root)"]],
      [[], ["(root)"]],
    ] as const) {
      const r = await deleteAccount(bob.sharer, data);
      assert.equal(!r.ok && r.code, "INVALID_ARGUMENT", JSON.stringify(data));
      assert.deepEqual(!r.ok && (r.details as { errors: { field: string }[] }).errors.map((e) => e.field), fields);
    }
    await assertBobIntact();
  });
});

describe("deleteAccount: a full account", () => {
  it("stops the live share first, then deletes everything of the caller's and nothing of anyone else's", async () => {
    const alex = await fullAccount("Alex");
    assert.equal((await db.doc(`callLogs/${alex.live.session.id}`).get()).get("user_id"), alex.sharer.uid);
    // A call log whose id isn't a session id is found through user_id.
    await db.doc("callLogs/stray").set({ user_id: alex.sharer.uid, session_id: "gone", call_id: "c", call_time: Timestamp.now() });

    const live = watch(alex.live.session);
    await live.ready;
    const res = ok(await deleteAccount(alex.sharer));
    await live.untilDeleted();

    assert.deepEqual(validate("DeleteAccountResponse", res), []);
    assert.deepEqual(res, { sessions_deleted: 2 });
    // An open viewer page sees the share end (as Stop ends it) before it disappears.
    assert.deepEqual(live.states, ["active:null", "stopped:stopped", "deleted"]);
    await assertAllGone(alex.sharer.uid, alex.sessions, alex.viewerUids);
    assert.equal((await db.doc("callLogs/stray").get()).exists, false);
    await assertBobIntact();
  });

  it("does nothing more, and still succeeds, when called again", async () => {
    const sam = await fullAccount("Sam");
    ok(await deleteAccount(sam.sharer));
    // The ID token outlives the Auth user for up to an hour, so the app may retry with it.
    assert.deepEqual(ok(await deleteAccount(sam.sharer, {})), { sessions_deleted: 0 });
    await assertAllGone(sam.sharer.uid, sam.sessions, sam.viewerUids);
    await assertBobIntact();
  });

  it("finishes what a failed run left behind", async () => {
    const kai = await fullAccount("Kai");
    const [earlier, live] = kai.sessions as [DocumentReference, DocumentReference];
    // As a run that failed partway might leave it: the account locked out
    // (disabled, tokens revoked), the profile gone, one session doc gone but its
    // private/meta and pings still there, and a viewer's Auth user gone while
    // its viewerSignIns record stays.
    await auth.updateUser(kai.sharer.uid, { disabled: true });
    await auth.revokeRefreshTokens(kai.sharer.uid);
    await db.recursiveDelete(db.doc(`users/${kai.sharer.uid}`));
    await earlier.delete();
    await auth.deleteUser(kai.viewerUids[0]!);
    assert.equal((await earlier.collection("pings").get()).size, 2);

    assert.deepEqual(ok(await deleteAccount(kai.sharer)), { sessions_deleted: 2 });
    await assertAllGone(kai.sharer.uid, [earlier, live], kai.viewerUids);
    await assertBobIntact();
  });
});

describe("deleteAccount: the old sign-in can't write afterwards", () => {
  it("refuses every sharer callable that writes, so nothing of the account comes back", async () => {
    const zoe = await fullAccount("Zoe");
    ok(await deleteAccount(zoe.sharer));
    // The ID token still verifies for up to an hour; requireCurrentSharer reads the Auth user.
    const sessionId = zoe.live.session.id;
    const calls: [string, unknown][] = [
      ["saveProfile", { name: "Zoe", mascot_id: "fox", mascot_color: "original", mascot_accessory: null }],
      ["createSession", manualShare],
      ["stopSession", { session_id: sessionId }],
      ["reportCallEnded", { session_id: sessionId, call_id: "call-1" }],
      ["reportCallActive", { session_id: sessionId, call_id: "call-1" }],
      ["discardSession", { session_id: sessionId }],
    ];
    for (const [name, data] of calls) {
      const r = await callFunction(name, data, zoe.sharer.idToken);
      assert.equal(!r.ok && r.code, "UNAUTHENTICATED", `${name}: ${JSON.stringify(r)}`);
    }
    await assertAllGone(zoe.sharer.uid, zoe.sessions, zoe.viewerUids);
    await assertBobIntact();
  });
});

describe("deleteAccount: a save racing the deletion", () => {
  const profile = { name: "Again", mascot_id: "ghost", mascot_color: "dusk", mascot_accessory: null };
  const save = (who: SignedIn) => callFunction("saveProfile", profile, who.idToken);

  it("refuses a save once the account is locked out, and the profile stays gone", async () => {
    const ivy = await fullAccount("Ivy");
    // What step 0 does before anything is deleted.
    await auth.updateUser(ivy.sharer.uid, { disabled: true });
    await auth.revokeRefreshTokens(ivy.sharer.uid);
    const r = await save(ivy.sharer);
    assert.equal(!r.ok && r.code, "UNAUTHENTICATED", JSON.stringify(r));
    // The same token still finishes the deletion: deleteAccount's own check doesn't read the Auth user.
    assert.deepEqual(ok(await deleteAccount(ivy.sharer)), { sessions_deleted: 2 });
    await assertAllGone(ivy.sharer.uid, ivy.sessions, ivy.viewerUids);
  });

  it("sweeps up a profile written after it was deleted, twice if it comes back again", async () => {
    const una = await fullAccount("Una");
    const ref = db.doc(`users/${una.sharer.uid}`);
    const now = Timestamp.now();
    const late = {
      name: "Late", mascot_id: "fox", mascot_color: "original", mascot_accessory: null, last_viewer_name: null,
      settings: DEFAULT_USER_SETTINGS, active_session_id: null, created_at: now, updated_at: now,
    };
    // A save in flight at the lock-out, committing late: each time the profile
    // disappears (step 2, then the first re-sweep), write it back with a device.
    const writes: Promise<unknown>[] = [];
    let present = true;
    const stop = ref.onSnapshot((snap) => {
      if (snap.exists) { present = true; return; }
      if (!present || writes.length === 4) return;
      present = false;
      writes.push(ref.set(late), ref.collection("devices").doc("late").set({
        platform: "ios", push_token: "late", live_activity_start_token: null, updated_at: now,
      }));
    });
    assert.deepEqual(ok(await deleteAccount(una.sharer)), { sessions_deleted: 2 });
    stop();
    await Promise.all(writes);
    assert.equal(writes.length, 4, "written back after step 2 and after the first re-sweep");
    await assertAllGone(una.sharer.uid, una.sessions, una.viewerUids);
  });

  it("leaves no profile behind when saves from a second phone land during the deletion", async () => {
    const jo = await fullAccount("Jo");
    const saves = Array.from({ length: 8 }, (_, i) =>
      new Promise((resolve) => setTimeout(resolve, i * 40)).then(() => save(jo.sharer)));
    const [deleted, ...saved] = await Promise.all([deleteAccount(jo.sharer), ...saves]);
    assert.deepEqual(ok(deleted), { sessions_deleted: 2 });
    // A save either landed before the lock-out (and was deleted with the rest) or was refused.
    for (const r of saved) assert.ok(r.ok || r.code === "UNAUTHENTICATED", JSON.stringify(r));
    await assertAllGone(jo.sharer.uid, jo.sessions, jo.viewerUids);
  });
});

describe("deleteAccount: smaller accounts", () => {
  it("deletes a sign-in that never saved a profile", async () => {
    const lee = await signInWithPhone("+15555504990");
    assert.deepEqual(ok(await deleteAccount(lee)), { sessions_deleted: 0 });
    assert.equal(await authUserExists(lee.uid), false);
  });

  it("deletes a profile that never shared, with its devices", async () => {
    const mo = await newSharer("Mo");
    assert.deepEqual(ok(await deleteAccount(mo)), { sessions_deleted: 0 });
    await assertAllGone(mo.uid, [], []);
  });

  it("deletes a share no one opened", async () => {
    const ana = await newSharer("Ana");
    const created = ok(await callFunction<CreateSessionResponse>("createSession", manualShare, ana.idToken));
    const session = db.doc(`shareSessions/${created.session_id}`);
    const watched = watch(session);
    await watched.ready;
    assert.deepEqual(ok(await deleteAccount(ana)), { sessions_deleted: 1 });
    await watched.untilDeleted();
    assert.deepEqual(watched.states, ["active:null", "stopped:stopped", "deleted"]);
    await assertAllGone(ana.uid, [session], []);
  });
});
