/**
 * Phone sign-in on the Auth emulator, step by step, as the apps do it
 * (FSD §4 "Sign up"): send a code to the number, read the 6-digit code the
 * emulator "texted" from its REST API, and sign in with it. Then: the same
 * number signs back in as the same account (a new phone), and a wrong code,
 * a used code or a bad number is refused.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { OTP_LENGTH } from "../../../shared/schema/generated/ts/schema.ts";
import {
  claimsOf,
  providerOf,
  sendVerificationCode,
  signInWithPhoneNumber,
  verificationCodeFor,
  type AuthReply,
} from "./authEmulator.ts";
import { PROJECT_ID, clearAuth } from "./emulators.ts";

const NUMBER = "+15555550131";

let app: App;

function ok<T>(r: AuthReply<T>): T {
  assert.ok(r.ok, JSON.stringify(r));
  return r.body;
}

/** Steps 1 and 2: send a code, then read it from the emulator. */
async function codeFor(phoneNumber: string): Promise<{ sessionInfo: string; code: string }> {
  const { sessionInfo } = ok(await sendVerificationCode(phoneNumber));
  const sent = await verificationCodeFor(sessionInfo);
  assert.ok(sent, "the emulator keeps the code it would have texted");
  return { sessionInfo, code: sent.code };
}

before(async () => {
  await clearAuth();
  app = initializeApp({ projectId: PROJECT_ID }, "auth-test");
});

after(async () => {
  if (app) await deleteApp(app);
});

describe("phone sign-in on the Auth emulator", () => {
  let firstUid = "";

  it("sends a 6-digit code to the number and signs in with it", async () => {
    const { sessionInfo } = ok(await sendVerificationCode(NUMBER));
    const sent = await verificationCodeFor(sessionInfo);
    assert.equal(sent?.phoneNumber, NUMBER);
    assert.match(sent?.code ?? "", new RegExp(`^\\d{${OTP_LENGTH}}$`));

    const signIn = ok(await signInWithPhoneNumber(sessionInfo, sent!.code));
    assert.equal(signIn.phoneNumber, NUMBER);
    assert.equal(signIn.isNewUser, true);
    assert.ok(signIn.refreshToken.length > 0);
    firstUid = signIn.localId;

    // The ID token is what the callables and the rules check.
    const claims = claimsOf(signIn.idToken);
    assert.equal(providerOf(signIn.idToken), "phone");
    assert.equal(claims.phone_number, NUMBER);
    assert.equal(claims.sub, signIn.localId);

    // Firebase Authentication holds the number, in E.164 (FSD §8 "Phone number").
    const user = await getAuth(app).getUser(signIn.localId);
    assert.equal(user.phoneNumber, NUMBER);
    assert.deepEqual(user.providerData.map((p) => p.providerId), ["phone"]);
  });

  it("signs the same number back in as the same account, as on a new phone", async () => {
    const { sessionInfo, code } = await codeFor(NUMBER);
    const again = ok(await signInWithPhoneNumber(sessionInfo, code));
    assert.equal(again.localId, firstUid);
    assert.equal(again.isNewUser, false);
  });

  it("gives a different number its own account", async () => {
    const { sessionInfo, code } = await codeFor("+15555550132");
    const other = ok(await signInWithPhoneNumber(sessionInfo, code));
    assert.notEqual(other.localId, firstUid);
  });

  it("refuses a wrong code", async () => {
    const { sessionInfo, code } = await codeFor(NUMBER);
    const wrong = String((Number(code) + 1) % 10 ** OTP_LENGTH).padStart(OTP_LENGTH, "0");
    const r = await signInWithPhoneNumber(sessionInfo, wrong);
    assert.equal(!r.ok && r.error, "INVALID_CODE");
  });

  it("refuses a code that was already used", async () => {
    const { sessionInfo, code } = await codeFor(NUMBER);
    ok(await signInWithPhoneNumber(sessionInfo, code));
    const reused = await signInWithPhoneNumber(sessionInfo, code);
    assert.equal(reused.ok, false);
  });

  it("refuses a number that isn't E.164", async () => {
    for (const bad of ["5555550131", ""]) {
      const r = await sendVerificationCode(bad);
      assert.equal(r.ok, false, bad);
    }
  });
});
