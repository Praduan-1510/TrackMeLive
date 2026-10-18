/**
 * Where the emulators are, plus small REST helpers for the Auth emulator and the
 * callable protocol. The tests run on the test emulator set: project
 * demo-trackmelive-test on its own ports (firebase.test.json). test.sh sets the
 * *_EMULATOR_HOST variables and GCLOUD_PROJECT; the defaults here match
 * firebase.test.json, so a test started by hand lands on the test set too.
 */

export const PROJECT_ID = process.env.GCLOUD_PROJECT ?? process.env.PROJECT_ID ?? "demo-trackmelive-test";
export const REGION = "us-central1";

// The tests wipe Auth and Firestore. The dev set's project (run.sh) holds the data
// the apps, the viewer and QA are using, so never run against it, and never off a
// demo- project, which is what keeps every SDK off real resources.
if (PROJECT_ID === "demo-trackmelive" || !PROJECT_ID.startsWith("demo-")) {
  throw new Error(`the backend tests refuse project "${PROJECT_ID}": run them with ./test.sh, on demo-trackmelive-test`);
}

function hostPort(envVar: string, fallback: string): { host: string; port: number } {
  const raw = process.env[envVar] ?? fallback;
  const i = raw.lastIndexOf(":");
  return { host: raw.slice(0, i), port: Number(raw.slice(i + 1)) };
}

export const FIRESTORE = hostPort("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8180");
export const AUTH = hostPort("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9199");
export const FUNCTIONS = hostPort("FUNCTIONS_EMULATOR_HOST", "127.0.0.1:5101");

// The Admin SDK in the tests finds the emulators through these. GCLOUD_PROJECT
// is for the functions' own default app, which the lifecycle tests load.
process.env.GCLOUD_PROJECT ??= PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST ??= `${FIRESTORE.host}:${FIRESTORE.port}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `${AUTH.host}:${AUTH.port}`;
// Offline: don't let google-auth-library probe for a GCP metadata server (a ~5 s stall).
process.env.METADATA_SERVER_DETECTION ??= "none";

const authBase = `http://${AUTH.host}:${AUTH.port}`;
// The Auth emulator accepts any API key.
const KEY = "demo-api-key";

async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: T }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as T };
}

export interface SignedIn {
  uid: string;
  idToken: string;
}

/** Signs in the way the app does: phone number, then the 6-digit text code. */
export async function signInWithPhone(phoneNumber: string): Promise<SignedIn> {
  const send = await postJson<{ sessionInfo?: string; error?: unknown }>(
    `${authBase}/identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${KEY}`,
    { phoneNumber },
  );
  if (!send.json.sessionInfo) throw new Error(`sendVerificationCode failed: ${JSON.stringify(send.json)}`);

  const codesRes = await fetch(`${authBase}/emulator/v1/projects/${PROJECT_ID}/verificationCodes`);
  const codes = (await codesRes.json()) as { verificationCodes: { sessionInfo: string; code: string }[] };
  const code = codes.verificationCodes.find((c) => c.sessionInfo === send.json.sessionInfo)?.code;
  if (!code) throw new Error("no verification code in the Auth emulator");

  const signIn = await postJson<{ idToken?: string; localId?: string; error?: unknown }>(
    `${authBase}/identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=${KEY}`,
    { sessionInfo: send.json.sessionInfo, code },
  );
  if (!signIn.json.idToken || !signIn.json.localId) throw new Error(`signInWithPhoneNumber failed: ${JSON.stringify(signIn.json)}`);
  return { uid: signIn.json.localId, idToken: signIn.json.idToken };
}

/** An anonymous sign-in, like a viewer's browser before it trades a link token. */
export async function signInAnonymously(): Promise<SignedIn> {
  const r = await postJson<{ idToken?: string; localId?: string }>(
    `${authBase}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`,
    { returnSecureToken: true },
  );
  if (!r.json.idToken || !r.json.localId) throw new Error(`anonymous signUp failed: ${JSON.stringify(r.json)}`);
  return { uid: r.json.localId, idToken: r.json.idToken };
}

export type CallableResult<T> =
  | { ok: true; httpStatus: number; data: T }
  | { ok: false; httpStatus: number; code: string; message: string; details?: unknown };

/** Calls an onCall function over the callable HTTP protocol. */
export async function callFunction<T>(name: string, data: unknown, idToken?: string): Promise<CallableResult<T>> {
  const url = `http://${FUNCTIONS.host}:${FUNCTIONS.port}/${PROJECT_ID}/${REGION}/${name}`;
  const headers: Record<string, string> = idToken ? { authorization: `Bearer ${idToken}` } : {};
  const { status, json } = await postJson<{ result?: T; error?: { status: string; message: string; details?: unknown } }>(
    url,
    { data },
    headers,
  );
  if (json.error) {
    return { ok: false, httpStatus: status, code: json.error.status, message: json.error.message, details: json.error.details };
  }
  return { ok: true, httpStatus: status, data: json.result as T };
}

export async function clearAuth(): Promise<void> {
  await fetch(`${authBase}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });
}

export async function clearFirestore(): Promise<void> {
  await fetch(
    `http://${FIRESTORE.host}:${FIRESTORE.port}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
}
