/**
 * The live e2e's side of the backend, over the emulators' REST APIs: a sharer signs in with a phone
 * number and starts a share through the real callables (saveProfile, createSession, stopSession);
 * pings and test-only changes (an earlier limit, say) are written as the emulator's owner, the way
 * the sharer's app batches them (the ping, last_ping_at and last_fix_at together). Every test makes
 * its own sharer and session, so tests never share data with each other or with backend tests on
 * the same emulator set. The set comes from the emulator wrapper's environment, through the same
 * helper the page's build uses (viteEnvForEmulators), and nothing here runs without it.
 */

import { randomInt, randomUUID } from 'node:crypto';
import { viteEnvForEmulators } from '../../src/session/firebase/config';

const env = viteEnvForEmulators(process.env);
export const PROJECT = env.VITE_TML_PROJECT_ID ?? '';
const HOST = env.VITE_TML_EMULATOR_HOST ?? '';
const AUTH = `http://${HOST}:${env.VITE_TML_AUTH_PORT ?? ''}`;
const FUNCTIONS = `http://${HOST}:${env.VITE_TML_FUNCTIONS_PORT ?? ''}/${PROJECT}/us-central1`;
const DB = `projects/${PROJECT}/databases/(default)/documents`;
const FIRESTORE = `http://${HOST}:${env.VITE_TML_FIRESTORE_PORT ?? ''}/v1/${DB}`;
/** The Auth emulator takes any key. */
const KEY = 'emulator-only';

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

async function json<T>(res: Response, what: string): Promise<T> {
  const body = (await res.json()) as T & { error?: unknown };
  if (!res.ok || body.error) throw new Error(`${what}: HTTP ${String(res.status)} ${JSON.stringify(body.error ?? body)}`);
  return body;
}

// ---------- Auth and callables ----------

export interface Sharer {
  readonly uid: string;
  readonly idToken: string;
  readonly name: string;
}

export class CallableError extends Error {
  constructor(
    readonly status: string,
    message: string,
    readonly details: unknown,
  ) {
    super(message);
  }
}

/**
 * Calls a callable the way the SDKs do; resolves with its result, or rejects with a CallableError.
 * INTERNAL (a transaction the emulator timed out) is asked again, as the page does.
 */
export async function call<T>(name: string, data: unknown, idToken?: string, tries = 3): Promise<T> {
  try {
    return await callOnce<T>(name, data, idToken);
  } catch (err) {
    if (!(err instanceof CallableError) || err.status !== 'INTERNAL' || tries <= 1) throw err;
    await new Promise((r) => setTimeout(r, 1000));
    return call<T>(name, data, idToken, tries - 1);
  }
}

async function callOnce<T>(name: string, data: unknown, idToken?: string): Promise<T> {
  const res = await fetch(`${FUNCTIONS}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(idToken ? { authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ data }),
  });
  const body = (await res.json()) as { result?: T; error?: { status: string; message: string; details?: unknown } };
  if (body.error) throw new CallableError(body.error.status, body.error.message, body.error.details);
  if (!res.ok || body.result === undefined) throw new Error(`${name}: HTTP ${String(res.status)}`);
  return body.result;
}

async function identity<T>(method: string, body: unknown): Promise<T> {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/${method}?key=${KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return json<T>(res, method);
}

/** A new sharer: a phone sign-in with a number no other test uses, and a profile. */
export async function newSharer(name = 'Alex'): Promise<Sharer> {
  const phoneNumber = `+1555${String(randomInt(1_000_000, 9_999_999))}`;
  const { sessionInfo } = await identity<{ sessionInfo: string }>('accounts:sendVerificationCode', { phoneNumber });
  const codes = await json<{ verificationCodes: { sessionInfo: string; code: string }[] }>(
    await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/verificationCodes`),
    'verificationCodes',
  );
  const code = codes.verificationCodes.find((c) => c.sessionInfo === sessionInfo)?.code;
  if (!code) throw new Error('The Auth emulator kept no code for this sign-in');
  const signedIn = await identity<{ idToken: string; localId: string }>('accounts:signInWithPhoneNumber', { sessionInfo, code });
  await call('saveProfile', { name, mascot_id: 'fox', mascot_color: 'original', mascot_accessory: null }, signedIn.idToken);
  return { uid: signedIn.localId, idToken: signedIn.idToken, name };
}

export interface Share {
  readonly sharer: Sharer;
  readonly sessionId: string;
  readonly token: string;
  /** The page's path for this share. */
  readonly path: string;
}

export interface ShareOptions {
  readonly name?: string;
  /** A share started during a call: share back allowed, stop when the call ends. */
  readonly call?: boolean;
  readonly precision?: 'precise' | 'approximate';
}

/** A sharer and a live session, through createSession. */
export async function newShare(o: ShareOptions = {}): Promise<Share> {
  const sharer = await newSharer(o.name);
  const r = await call<{ session_id: string; link_token: string }>(
    'createSession',
    {
      stop_rule: o.call ? 'call' : 'minutes',
      stop_minutes: o.call ? null : 30,
      call_id: o.call ? randomUUID() : null,
      share_back_allowed: Boolean(o.call),
      precision: o.precision ?? 'precise',
    },
    sharer.idToken,
  );
  // Built from the token, never from link_url (it names the Hosting emulator's origin).
  return { sharer, sessionId: r.session_id, token: r.link_token, path: `/s/${r.link_token}` };
}

export const stopShare = (share: Share): Promise<unknown> => call('stopSession', { session_id: share.sessionId }, share.sharer.idToken);

// ---------- Firestore, as the emulator's owner ----------

type Value = string | number | boolean | Date | null;

function encode(v: Value): Record<string, unknown> {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'number') return { doubleValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  return { stringValue: v };
}
const fieldsOf = (o: Readonly<Record<string, Value>>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, encode(v)]));

async function owner(method: string, url: string, body?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return json<unknown>(res, `${method} ${url}`);
}

export interface PingOptions {
  /** When the fix was taken (default now). Each ping's must be later than the last one's. */
  readonly at?: Date;
  readonly accuracy?: number;
}

/** One ping, batched with the session's check-in and last_fix_at, as the sharer's app writes it. */
export async function ping(share: Share, where: LatLng, o: PingOptions = {}): Promise<void> {
  const recordedAt = o.at ?? new Date();
  const session = `${DB}/shareSessions/${share.sessionId}`;
  await owner('POST', `${FIRESTORE}:commit`, {
    writes: [
      {
        update: { name: `${session}/pings/${randomUUID().replaceAll('-', '')}`, fields: fieldsOf({ ...where, accuracy_m: o.accuracy ?? 8, recorded_at: recordedAt }) },
        currentDocument: { exists: false },
      },
      {
        update: { name: session, fields: fieldsOf({ last_fix_at: recordedAt }) },
        updateMask: { fieldPaths: ['last_fix_at'] },
        updateTransforms: [{ fieldPath: 'last_ping_at', setToServerValue: 'REQUEST_TIME' }],
      },
    ],
  });
}

/** Test-only changes to the session document (an earlier limit, a timer): what the app or a job would set. */
export async function patchSession(share: Share, fields: Readonly<Record<string, Value>>): Promise<void> {
  const mask = Object.keys(fields).map((f) => `updateMask.fieldPaths=${f}`).join('&');
  await owner('PATCH', `${FIRESTORE}/shareSessions/${share.sessionId}?${mask}`, { fields: fieldsOf(fields) });
}

interface Doc {
  readonly fields?: Record<string, Record<string, unknown>>;
}

/** One field of the session document, as the backend holds it now. */
export async function sessionField(share: Share, field: string): Promise<unknown> {
  const doc = (await owner('GET', `${FIRESTORE}/shareSessions/${share.sessionId}`)) as Doc;
  const v = doc.fields?.[field];
  return v ? Object.values(v)[0] : undefined;
}

/** How many viewer pings the session has. */
export async function viewerPingCount(share: Share): Promise<number> {
  const list = (await owner('GET', `${FIRESTORE}/shareSessions/${share.sessionId}/viewerPings`)) as { documents?: unknown[] };
  return list.documents?.length ?? 0;
}

/** Moves a point north by `meters`. */
export const north = (p: LatLng, meters: number): LatLng => ({ lat: p.lat + meters / 111_320, lng: p.lng });

export interface Walker {
  /** Where the next pings are. */
  moveTo(where: LatLng): void;
  /** Stops pinging; resolves once the last write has finished. */
  stop(): Promise<void>;
}

/**
 * Pings every `everyMs` from `where`, as the sharer's app does while it shares, until stopped: the
 * page stays live however long a cold emulator takes to answer.
 */
export function walk(share: Share, where: LatLng, o: { readonly accuracy?: number; readonly everyMs?: number } = {}): Walker {
  let at = where;
  let stopped = false;
  const accuracy = o.accuracy === undefined ? {} : { accuracy: o.accuracy };
  // A write the emulator turns away (a lock timeout while redeemLinkToken holds the session) is
  // skipped, as the app's next ping would follow it; the walk goes on.
  const once = (): Promise<void> => ping(share, at, accuracy).catch((err: unknown) => {
    console.warn('walk: a ping was turned away', err);
  });
  let last: Promise<void> = once();
  const timer = setInterval(() => {
    last = last.then(() => (stopped ? undefined : once()));
  }, o.everyMs ?? 4000);
  return {
    moveTo(next) {
      at = next;
      last = last.then(once);
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      await last;
    },
  };
}

/** Wakes the functions the page calls, so the first test isn't the one that waits for a cold start. */
export async function warmUp(): Promise<void> {
  await call('redeemLinkToken', { link_token: 'AAAAAAAAAAAAAAAAAAAAAA' }).catch(() => undefined);
  await newShare().then(stopShare);
}

/**
 * What the page's own run may log that isn't the page going wrong: a redeemLinkToken the backend
 * answered with a transient 500 (its transaction timed out on a lock while the sharer's ping batch
 * held the session; the page asks again, and the test still has to reach its state).
 */
export const realProblems = (problems: readonly string[]): string[] =>
  problems.filter(
    (p) => !/^HTTP 500: \S+\/redeemLinkToken$/.test(p) && p !== 'console error: Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
  );
