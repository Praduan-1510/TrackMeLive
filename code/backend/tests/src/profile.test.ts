/**
 * saveProfile against the emulators: a real phone sign-in (Auth), the callable
 * over HTTP (Functions), and the users doc read back with the Admin SDK
 * (Firestore). Every doc and response is checked with the shared validate().
 * profileRequest.test.ts covers the validation edge cases one by one; this
 * file proves they reach the caller as invalid-argument and write nothing.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  DEFAULT_USER_SETTINGS,
  validate,
  type CreateSessionResponse,
  type SaveProfileResponse,
  type UserSettings,
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
let phoneCounter = 0;

/** A new phone-number account each time: +1 555 555 02xx. */
const newSharer = () => signInWithPhone(`+155555502${String(++phoneCounter).padStart(2, "0")}`);

const fox = { name: "Alex", mascot_id: "fox", mascot_color: "original", mascot_accessory: null };
const customSettings: UserSettings = {
  offer_on_call: false,
  precision: "approximate",
  default_stop: 15,
  share_back: false,
  alert_link_opened: true,
  alert_call_ended: false,
  alert_expiry: true,
};

const save = (who: SignedIn | null, data: unknown) => callFunction<SaveProfileResponse>("saveProfile", data, who?.idToken);

function ok<T>(r: CallableResult<T>): T {
  assert.ok(r.ok, JSON.stringify(r));
  return r.data;
}

function invalidFields(r: CallableResult<unknown>): string[] {
  assert.equal(!r.ok && r.code, "INVALID_ARGUMENT", JSON.stringify(r));
  return !r.ok ? (r.details as { errors: { field: string }[] }).errors.map((e) => e.field) : [];
}

const userDoc = (uid: string) => db.doc(`users/${uid}`);
const stored = async (uid: string) => (await userDoc(uid).get()).data();

/** The response is the stored doc, field for field, with times in epoch ms. */
function assertMatchesStored(res: SaveProfileResponse, doc: Record<string, unknown>) {
  assert.deepEqual(validate("SaveProfileResponse", res), []);
  assert.deepEqual(validate("User", doc), []);
  const { created_at, updated_at, ...rest } = doc;
  assert.ok(created_at instanceof Timestamp && updated_at instanceof Timestamp);
  assert.deepEqual(res, { ...rest, created_at: created_at.toMillis(), updated_at: updated_at.toMillis() });
}

before(async () => {
  await clearFirestore();
  await clearAuth();
  app = initializeApp({ projectId: PROJECT_ID }, "saveProfile-test");
  db = getFirestore(app);
});

after(async () => {
  if (app) await deleteApp(app);
});

describe("saveProfile: who may call it", () => {
  it("refuses a signed-out caller", async () => {
    const r = await save(null, fox);
    assert.equal(!r.ok && r.code, "UNAUTHENTICATED");
  });

  it("refuses an anonymous sign-in and writes nothing", async () => {
    const anon = await signInAnonymously();
    const r = await save(anon, fox);
    assert.equal(!r.ok && r.code, "PERMISSION_DENIED");
    assert.equal((await userDoc(anon.uid).get()).exists, false);
  });

  it("refuses a disabled account's sign-in and writes nothing", async () => {
    const dee = await newSharer();
    await getAuth(app).updateUser(dee.uid, { disabled: true });
    const r = await save(dee, fox);
    assert.equal(!r.ok && r.code, "UNAUTHENTICATED", JSON.stringify(r));
    assert.equal((await userDoc(dee.uid).get()).exists, false);
  });

  it("refuses a sign-in revoked everywhere and writes nothing", async () => {
    const rex = await newSharer();
    // Revocation counts in whole seconds: let the sign-in's second pass first.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await getAuth(app).revokeRefreshTokens(rex.uid);
    const r = await save(rex, fox);
    assert.equal(!r.ok && r.code, "UNAUTHENTICATED", JSON.stringify(r));
    assert.equal((await userDoc(rex.uid).get()).exists, false);
  });

  it("refuses a viewer's custom sign-in and writes nothing", async () => {
    const token = await getAuth(app).createCustomToken("v_session_browser", { sid: "session", role: "viewer" });
    const viewer = await signInWithCustomToken(token);
    const r = await save(viewer, fox);
    assert.equal(!r.ok && r.code, "PERMISSION_DENIED");
    assert.equal((await userDoc(viewer.uid).get()).exists, false);
  });
});

describe("saveProfile: a new profile", () => {
  it("creates users/{uid} with every field, default settings and server times", async () => {
    const alex = await newSharer();
    const t0 = Date.now();
    const res = ok(await save(alex, { ...fox, name: "  Alex  " }));

    const doc = (await stored(alex.uid))!;
    assertMatchesStored(res, doc);
    assert.equal(res.name, "Alex");
    assert.equal(res.mascot_id, "fox");
    assert.equal(res.mascot_color, "original");
    assert.equal(res.mascot_accessory, null);
    assert.deepEqual(res.settings, DEFAULT_USER_SETTINGS);
    assert.equal(res.last_viewer_name, null);
    assert.equal(res.active_session_id, null);
    assert.equal(res.created_at, res.updated_at);
    assert.ok(Math.abs(res.created_at - t0) < 10_000, "a server timestamp from now");
  });

  it("stores the settings when the first save sends them", async () => {
    const res = ok(await save(await newSharer(), { ...fox, settings: customSettings }));
    assert.deepEqual(res.settings, customSettings);
  });

  it("takes the Android SDK's wire form, where a Kotlin Long arrives wrapped as an Int64Value", async () => {
    // TmlSchema.kt's DefaultStop numbers are Longs (15L), which the Android callable SDK sends this way.
    const int64 = (n: number) => ({ "@type": "type.googleapis.com/google.protobuf.Int64Value", value: String(n) });
    const res = ok(await save(await newSharer(), { ...fox, settings: { ...customSettings, default_stop: int64(60) } }));
    assert.equal(res.settings.default_stop, 60);
  });

  it("never writes the phone number to Firestore (FSD §8)", async () => {
    const sam = await signInWithPhone("+15555550299");
    ok(await save(sam, { ...fox, name: "Sam", mascot_id: "ninja", mascot_color: "dusk", mascot_accessory: "headphones" }));
    const json = JSON.stringify(await stored(sam.uid));
    for (const form of ["+15555550299", "15555550299", "5555550299"]) assert.ok(!json.includes(form), form);
  });

  it("creates one profile when two first saves race", async () => {
    const kai = await newSharer();
    const [a, b] = await Promise.all([
      save(kai, { ...fox, name: "Kai" }),
      save(kai, { ...fox, name: "Kai", mascot_id: "ghost" }),
    ]);
    const first = ok(a);
    const second = ok(b);
    assert.equal(first.created_at, second.created_at, "created once");
    assertMatchesStored(ok(await save(kai, { ...fox, name: "Kai" })), (await stored(kai.uid))!);
  });
});

describe("saveProfile: updating a profile", () => {
  it("replaces the profile fields, keeps the settings when none are sent, and never touches created_at", async () => {
    const alex = await newSharer();
    const first = ok(await save(alex, { ...fox, settings: customSettings }));

    const second = ok(await save(alex, { name: "Alexandra", mascot_id: "robot", mascot_color: "lagoon", mascot_accessory: "headlamp" }));
    assertMatchesStored(second, (await stored(alex.uid))!);
    assert.equal(second.name, "Alexandra");
    assert.equal(second.mascot_id, "robot");
    assert.equal(second.mascot_color, "lagoon");
    assert.equal(second.mascot_accessory, "headlamp");
    assert.deepEqual(second.settings, customSettings);
    assert.equal(second.created_at, first.created_at);
    assert.ok(second.updated_at > first.updated_at);

    // Sending settings replaces the whole object.
    const third = ok(await save(alex, { ...fox, settings: DEFAULT_USER_SETTINGS }));
    assert.deepEqual(third.settings, DEFAULT_USER_SETTINGS);
    assert.equal(third.created_at, first.created_at);
    assert.ok(third.updated_at > second.updated_at);
  });

  it("keeps the function-owned fields: last_viewer_name and active_session_id", async () => {
    const alex = await newSharer();
    ok(await save(alex, fox));
    await userDoc(alex.uid).update({ last_viewer_name: "Mom", active_session_id: "s-live" });

    const res = ok(await save(alex, { ...fox, name: "Al" }));
    assert.equal(res.last_viewer_name, "Mom");
    assert.equal(res.active_session_id, "s-live");
    assertMatchesStored(res, (await stored(alex.uid))!);
  });

  it("feeds the sharer snapshot of the next share", async () => {
    const alex = await newSharer();
    ok(await save(alex, { name: "Alex", mascot_id: "neko", mascot_color: "rose", mascot_accessory: "glasses" }));
    const share = await callFunction<CreateSessionResponse>(
      "createSession",
      { stop_rule: "limit", stop_minutes: null, call_id: null, share_back_allowed: false, precision: "precise" },
      alex.idToken,
    );
    const session = (await db.doc(`shareSessions/${ok(share).session_id}`).get()).data();
    assert.deepEqual(session?.sharer, { name: "Alex", mascot_id: "neko", mascot_color: "rose", mascot_accessory: "glasses" });
  });

  it("fails loudly, without returning it, when the stored profile isn't a valid User", async () => {
    const alex = await newSharer();
    // Missing created_at and the rest: nothing saveProfile wrote, but it must not hand it back as a profile.
    await userDoc(alex.uid).set({ name: "Alex", updated_at: Timestamp.now() });
    const r = await save(alex, fox);
    assert.equal(!r.ok && r.code, "INTERNAL");
  });
});

describe("saveProfile: invalid input reaches the caller and writes nothing", () => {
  let alex: SignedIn;
  let saved: SaveProfileResponse;

  before(async () => {
    alex = await newSharer();
    saved = ok(await save(alex, { ...fox, settings: customSettings }));
  });

  const cases: [string, Record<string, unknown>, string[]][] = [
    ["a 25-character emoji name", { ...fox, name: "\u{1F98A}".repeat(25) }, ["name"]],
    ["a blank name", { ...fox, name: "   " }, ["name"]],
    ["an accessory the mascot doesn't take", { ...fox, mascot_id: "astronaut", mascot_accessory: "headphones" }, ["mascot_accessory"]],
    ["an unknown mascot", { ...fox, mascot_id: "pikachu" }, ["mascot_id"]],
    ["partial settings", { ...fox, settings: { precision: "approximate" } }, [
      "settings.offer_on_call", "settings.default_stop", "settings.share_back",
      "settings.alert_link_opened", "settings.alert_call_ended", "settings.alert_expiry",
    ]],
    ["a function-owned field", { ...fox, active_session_id: null }, ["active_session_id"]],
    ["last_viewer_name", { ...fox, last_viewer_name: "Mom" }, ["last_viewer_name"]],
  ];
  for (const [label, data, fields] of cases) {
    it(`refuses ${label}`, async () => {
      assert.deepEqual(invalidFields(await save(alex, data)).sort(), [...fields].sort());
      assertMatchesStored(saved, (await stored(alex.uid))!);
    });
  }

  it("takes a 24-character emoji name", async () => {
    const name = "\u{1F98A}".repeat(23) + "\u{1F469}\u{1F3FD}\u200D\u{1F9B1}";
    const res = ok(await save(alex, { ...fox, name: ` ${name} ` }));
    assert.equal(res.name, name);
    assertMatchesStored(res, (await stored(alex.uid))!);
  });
});
