/**
 * The Auth emulator's REST API, one step at a time: the same calls the iOS,
 * Android and web SDKs make. emulators.ts has the one-call signInWithPhone the
 * other tests use. This file splits that flow into its steps, so auth.test.ts
 * can check each one and its failures, and it adds custom-token sign-in for the
 * viewer's browser.
 */
import { AUTH, PROJECT_ID, type SignedIn } from "./emulators.ts";

const authBase = `http://${AUTH.host}:${AUTH.port}`;
const identityToolkit = `${authBase}/identitytoolkit.googleapis.com/v1`;
// The Auth emulator accepts any API key.
const KEY = "demo-api-key";

/** An Identity Toolkit reply: the fields asked for, or an error such as INVALID_CODE. */
export type AuthReply<T> = { ok: true; body: T } | { ok: false; status: number; error: string };

async function post<T>(method: string, body: unknown): Promise<AuthReply<T>> {
  const res = await fetch(`${identityToolkit}/${method}?key=${KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok || json.error) return { ok: false, status: res.status, error: json.error?.message ?? `HTTP ${res.status}` };
  return { ok: true, body: json };
}

/** Step 1: "Send code". The emulator sends no text; it keeps the code for step 2. */
export function sendVerificationCode(phoneNumber: string): Promise<AuthReply<{ sessionInfo: string }>> {
  return post("accounts:sendVerificationCode", { phoneNumber });
}

export interface VerificationCode {
  phoneNumber: string;
  sessionInfo: string;
  code: string;
}

/** Step 2: the code the emulator "texted", from its REST API (what the apps' tests read). */
export async function verificationCodeFor(sessionInfo: string): Promise<VerificationCode | undefined> {
  const res = await fetch(`${authBase}/emulator/v1/projects/${PROJECT_ID}/verificationCodes`);
  const { verificationCodes } = (await res.json()) as { verificationCodes: VerificationCode[] };
  return verificationCodes.find((c) => c.sessionInfo === sessionInfo);
}

export interface PhoneSignIn {
  idToken: string;
  refreshToken: string;
  localId: string;
  phoneNumber: string;
  isNewUser: boolean;
}

/** Step 3: the code goes back with the session info, and the reply is the sign-in. */
export function signInWithPhoneNumber(sessionInfo: string, code: string): Promise<AuthReply<PhoneSignIn>> {
  return post("accounts:signInWithPhoneNumber", { sessionInfo, code });
}

/** A browser trading redeemLinkToken's custom token for a sign-in, as signInWithCustomToken does. */
export async function signInWithCustomToken(token: string): Promise<SignedIn> {
  const r = await post<{ idToken: string }>("accounts:signInWithCustomToken", { token, returnSecureToken: true });
  if (!r.ok) throw new Error(`signInWithCustomToken failed: ${r.error}`);
  const uid = claimsOf(r.body.idToken).sub;
  if (typeof uid !== "string") throw new Error("ID token has no sub");
  return { uid, idToken: r.body.idToken };
}

/** The claims in an ID token. The emulator's tokens are unsigned JWTs, so this just decodes the payload. */
export function claimsOf(idToken: string): Record<string, unknown> {
  const payload = idToken.split(".")[1];
  if (!payload) throw new Error("not a JWT");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** The sign-in provider an ID token names: phone, custom, anonymous… */
export function providerOf(idToken: string): unknown {
  const firebase = claimsOf(idToken).firebase as { sign_in_provider?: unknown } | undefined;
  return firebase?.sign_in_provider;
}
