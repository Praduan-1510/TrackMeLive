/**
 * A fake sharer: a phone-signed-in Track Me Live account that shares through the same client path the
 * apps use, so the backend can't tell it from a phone:
 *
 *   - phone sign-in on the Auth emulator (the code read from its REST API, as the apps' tests do),
 *     then the Firebase JS SDK's signInWithCredential, so every later call carries a phone ID token;
 *   - the profile through the saveProfile callable when the account is new;
 *   - the session through the real createSession callable;
 *   - each ping as one batch, exactly as FSD §6, the schema's x-decisions Q-PING-WRITE and
 *     firestore.rules expect: a `pings` doc {lat, lng, recorded_at, accuracy_m} plus the session's
 *     check-in (`last_ping_at` = server time, `last_fix_at` = that same recorded_at, and
 *     `ping_interval_s` when it changes), and the session's `place` when the caller passes one
 *     (x-decisions Q-PLACE; place.ts decides when). The security rules judge every write;
 *   - Stop through the stopSession callable.
 *
 * One test-only shortcut, on demo-* emulators only: backdate() moves a session's started_at,
 * expires_at and stop_at back by the same amount right after createSession, so its timer or its 1-hour
 * limit lands seconds from now instead of minutes. The server's clock is never faked: the rules,
 * redeemLinkToken, the stop job and the viewer all run on real time.
 */

import { randomInt, randomUUID } from 'node:crypto';
import { FirebaseError, deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { PhoneAuthCredential, connectAuthEmulator, initializeAuth, inMemoryPersistence, signInWithCredential, type Auth } from 'firebase/auth';
import {
  Timestamp,
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  initializeFirestore,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setLogLevel,
  terminate,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import {
  APPROXIMATE_ROUNDING_METERS,
  MAX_PING_INTERVAL_SECONDS,
  MIN_PING_SPACING_SECONDS,
  SESSION_LIMIT_MINUTES,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type EndReason,
  type MascotAccessory,
  type MascotColor,
  type MascotId,
  type Precision,
  type SaveProfileRequest,
  type ShareSession,
  type StopMinutes,
  type StopRule,
  type StopSessionResponse,
} from '../../../shared/schema/generated/ts/schema.ts';
import { authBase, checkEmulators, emulatorSet, firestoreBase, type EmulatorSet } from './env.ts';
import type { PlaceParts } from './place.ts';

const MIN = 60_000;

// A refused write is an expected outcome here (the session is over), reported as an event; keep the
// SDK's own warning about it off the console.
setLogLevel('error');
/** The Auth emulator takes any key; Firebase checks only the shape (backend README). */
const API_KEY = `AIzaSy${'0'.repeat(33)}`;

export interface Profile {
  readonly name: string;
  readonly mascot_id: MascotId;
  readonly mascot_color: MascotColor;
  readonly mascot_accessory: MascotAccessory | null;
}

export const DEFAULT_PROFILE: Profile = { name: 'Alex', mascot_id: 'fox', mascot_color: 'original', mascot_accessory: null };

export interface ShareOptions {
  readonly stop_rule?: StopRule;
  readonly stop_minutes?: StopMinutes | null;
  readonly precision?: Precision;
  readonly viewer_name?: string | null;
  /** A call share: a per-device call id, and share back allowed. Off: a manual share. */
  readonly call?: boolean;
  /** Test-only: backdate so the stop timer ends this many seconds from now. */
  readonly end_in_s?: number;
  /** Test-only: backdate so the 1-hour limit lands this many seconds from now. */
  readonly limit_in_s?: number;
  /** If the account already has a live session (a fixed --phone), stop it first. Default true. */
  readonly replace?: boolean;
}

export interface Session {
  readonly id: string;
  readonly linkToken: string;
  /** As createSession built it: <VIEWER_ORIGIN>/s/<token>. */
  readonly linkUrl: string;
  readonly precision: Precision;
  readonly startedAt: Date;
  readonly expiresAt: Date;
  /** Null for the call rule. */
  readonly stopAt: Date | null;
  /** How far started_at, expires_at and stop_at were moved back (test-only), ms. */
  readonly backdatedMs: number;
}

export interface Fix {
  readonly lat: number;
  readonly lng: number;
  readonly accuracy_m: number;
}

export interface WrittenPing extends Fix {
  readonly id: string;
  readonly recorded_at: Date;
  /** The place written in the same batch (at = recorded_at), null when it cleared it; absent when untouched. */
  readonly place?: PlaceParts | null;
}

/** The server refused a write. `over` is true when the session was due to end (timer or limit). */
export class WriteRefused extends Error {
  readonly over: boolean;
  readonly code: string;
  constructor(message: string, code: string, over: boolean) {
    super(message);
    this.name = 'WriteRefused';
    this.code = code;
    this.over = over;
  }
}

export interface SessionState {
  readonly status: ShareSession['status'];
  readonly end_reason: EndReason | null;
  readonly ended_at: Date | null;
  readonly stop_at: Date | null;
  readonly expires_at: Date;
  readonly last_ping_at: Date;
  /** recorded_at of the newest ping; null until the first. */
  readonly last_fix_at: Date | null;
  readonly ping_interval_s: number;
  readonly first_viewed_at: Date | null;
}

const toDate = (t: unknown): Date | null => (t instanceof Timestamp ? t.toDate() : null);

function stateOf(data: Record<string, unknown>): SessionState {
  const need = (k: string): Date => {
    const d = toDate(data[k]);
    if (!d) throw new Error(`session field ${k} isn't a timestamp`);
    return d;
  };
  return {
    status: data.status as ShareSession['status'],
    end_reason: (data.end_reason ?? null) as EndReason | null,
    ended_at: toDate(data.ended_at),
    stop_at: toDate(data.stop_at),
    expires_at: need('expires_at'),
    last_ping_at: need('last_ping_at'),
    last_fix_at: toDate(data.last_fix_at),
    ping_interval_s: data.ping_interval_s as number,
    first_viewed_at: toDate(data.first_viewed_at),
  };
}

/** When the session is due to end: the earlier of its timer and its 1-hour limit. */
export const dueAt = (s: { stop_at: Date | null; expires_at: Date }): Date => (s.stop_at !== null && s.stop_at < s.expires_at ? s.stop_at : s.expires_at);

/** Approximate shares round each point to about 500 m on the phone, before it's written (FSD §4). */
export function approximate(fix: Fix): Fix {
  const latStep = APPROXIMATE_ROUNDING_METERS / 111_320;
  const lat = Math.round(fix.lat / latStep) * latStep;
  const lngStep = APPROXIMATE_ROUNDING_METERS / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lat, lng: Math.round(fix.lng / lngStep) * lngStep, accuracy_m: Math.max(fix.accuracy_m, APPROXIMATE_ROUNDING_METERS) };
}

/**
 * PhoneAuthProvider.credential(verificationId, code), which the SDK's Node build leaves out (its
 * PhoneAuthProvider is a stub there, because reCAPTCHA needs a browser). That method is one line,
 * `PhoneAuthCredential._fromVerification(verificationId, code)`, and the Node build does ship that
 * class, so this makes the same call. Pinned with firebase 12.19.0; checked when signing in.
 */
function phoneCredential(verificationId: string, code: string): PhoneAuthCredential {
  const make = (PhoneAuthCredential as unknown as { _fromVerification?: (id: string, code: string) => PhoneAuthCredential })._fromVerification;
  if (typeof make !== 'function') throw new Error('this firebase version has no PhoneAuthCredential._fromVerification; update phoneCredential()');
  return make.call(PhoneAuthCredential, verificationId, code);
}

/** A random number in 415 555 xxxx: QA's own range, apart from the Android sign-in script's 650. */
export const randomPhone = (): string => `+1415555${String(randomInt(0, 10_000)).padStart(4, '0')}`;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok || json.error) throw new Error(`${url.replace(/\?.*/, '')} failed: ${json.error?.message ?? `HTTP ${String(res.status)}`}`);
  return json;
}

function describe(e: unknown): string {
  if (e instanceof FirebaseError) {
    const details = (e as FirebaseError & { details?: unknown }).details;
    return `${e.code}: ${e.message}${details === undefined ? '' : ` ${JSON.stringify(details)}`}`;
  }
  return e instanceof Error ? e.message : String(e);
}

export class FakeSharer {
  readonly set: EmulatorSet;
  readonly uid: string;
  readonly phone: string;
  readonly profile: Profile;
  private readonly app: FirebaseApp;
  private readonly auth: Auth;
  private readonly db: Firestore;
  private readonly functions: Functions;
  /** The ping_interval_s this sharer last wrote, per session. */
  private readonly intervals = new Map<string, number>();
  /** The recorded_at (epoch ms) of the newest ping this sharer wrote, per session. */
  private readonly lastRecorded = new Map<string, number>();

  private constructor(set: EmulatorSet, app: FirebaseApp, auth: Auth, db: Firestore, functions: Functions, uid: string, phone: string, profile: Profile) {
    this.set = set;
    this.app = app;
    this.auth = auth;
    this.db = db;
    this.functions = functions;
    this.uid = uid;
    this.phone = phone;
    this.profile = profile;
  }

  /** Signs in by phone (a new random QA number unless one is given) and makes sure the profile exists. */
  static async signIn(o: { phone?: string; profile?: Partial<Profile>; set?: EmulatorSet } = {}): Promise<FakeSharer> {
    const set = o.set ?? emulatorSet();
    await checkEmulators(set);
    const phone = o.phone ?? randomPhone();
    // One app per sharer, so a test can run several side by side.
    const app = initializeApp(
      { apiKey: API_KEY, projectId: set.projectId, appId: '1:000000000000:web:0000000000000000', messagingSenderId: '000000000000' },
      `fake-sharer-${randomUUID()}`,
    );
    const auth = initializeAuth(app, { persistence: inMemoryPersistence });
    connectAuthEmulator(auth, authBase(set), { disableWarnings: true });
    const db = initializeFirestore(app, {});
    connectFirestoreEmulator(db, set.firestore.host, set.firestore.port);
    const functions = getFunctions(app, set.region);
    connectFunctionsEmulator(functions, set.functions.host, set.functions.port);
    try {
      // The Identity Toolkit calls the apps make; the emulator keeps the code instead of texting it.
      const idt = `${authBase(set)}/identitytoolkit.googleapis.com/v1`;
      const { sessionInfo } = await postJson<{ sessionInfo: string }>(`${idt}/accounts:sendVerificationCode?key=${API_KEY}`, { phoneNumber: phone });
      const codes = (await (await fetch(`${authBase(set)}/emulator/v1/projects/${set.projectId}/verificationCodes`)).json()) as {
        verificationCodes: { sessionInfo: string; code: string }[];
      };
      const code = codes.verificationCodes.find((c) => c.sessionInfo === sessionInfo)?.code;
      if (!code) throw new Error(`the Auth emulator has no code for ${phone}`);
      const cred = await signInWithCredential(auth, phoneCredential(sessionInfo, code));
      const uid = cred.user.uid;

      const wanted: Profile = { ...DEFAULT_PROFILE, ...o.profile };
      const existing = await getDoc(doc(db, 'users', uid));
      let profile = wanted;
      const stored = existing.data() as Partial<Profile> | undefined;
      const differs = !stored || (Object.keys(wanted) as (keyof Profile)[]).some((k) => stored[k] !== wanted[k]);
      if (differs) {
        const save = httpsCallable<SaveProfileRequest, Profile>(functions, 'saveProfile');
        profile = (await save({ ...wanted })).data;
      }
      return new FakeSharer(set, app, auth, db, functions, uid, phone, profile);
    } catch (e) {
      await deleteApp(app).catch(() => undefined);
      throw new Error(`Signing in ${phone} failed: ${describe(e)}`);
    }
  }

  private callable<Req, Res>(name: string): (req: Req) => Promise<Res> {
    const fn = httpsCallable<Req, Res>(this.functions, name);
    return async (req) => (await fn(req)).data;
  }

  /** Starts a session through createSession, as the share sheet does. */
  async share(o: ShareOptions = {}): Promise<Session> {
    if (o.end_in_s !== undefined && o.limit_in_s !== undefined) throw new Error('Pick one of end_in_s and limit_in_s.');
    const stopRule: StopRule = o.stop_rule ?? (o.limit_in_s !== undefined ? 'limit' : 'minutes');
    const stopMinutes = stopRule === 'minutes' ? (o.stop_minutes ?? 30) : null;
    const call = o.call ?? stopRule === 'call';
    const precision = o.precision ?? 'precise';
    if (o.limit_in_s !== undefined && !(stopRule === 'limit' || stopMinutes === SESSION_LIMIT_MINUTES)) {
      throw new Error('limit_in_s needs a session that runs to its limit: stop_rule "limit" (or minutes 60).');
    }
    if (o.end_in_s !== undefined && stopRule !== 'minutes') throw new Error('end_in_s needs stop_rule "minutes".');
    const req: CreateSessionRequest = {
      stop_rule: stopRule,
      stop_minutes: stopMinutes,
      call_id: call ? randomUUID() : null,
      share_back_allowed: call,
      precision,
      viewer_name: o.viewer_name ?? null,
    };
    const create = this.callable<CreateSessionRequest, CreateSessionResponse>('createSession');
    let res: CreateSessionResponse;
    try {
      res = await create(req);
    } catch (e) {
      const details = (e as { details?: { reason?: string; session_id?: string } }).details;
      if (e instanceof FirebaseError && e.code === 'functions/already-exists' && details?.session_id && (o.replace ?? true)) {
        // This test account is still sharing from an earlier run: stop that one, as Stop would.
        await this.stop(details.session_id);
        res = await create(req);
      } else {
        throw new Error(`createSession failed: ${describe(e)}`);
      }
    }
    let session: Session = {
      id: res.session_id,
      linkToken: res.link_token,
      linkUrl: res.link_url,
      precision,
      startedAt: new Date(res.started_at),
      expiresAt: new Date(res.expires_at),
      stopAt: null,
      backdatedMs: 0,
    };
    const state = await this.read(session.id);
    session = { ...session, stopAt: state.stop_at };
    if (o.end_in_s !== undefined) {
      if (!session.stopAt) throw new Error('the session has no stop_at to move');
      session = await this.backdate(session, session.stopAt.getTime() - (Date.now() + o.end_in_s * 1000));
    } else if (o.limit_in_s !== undefined) {
      session = await this.backdate(session, session.expiresAt.getTime() - (Date.now() + o.limit_in_s * 1000));
    }
    return session;
  }

  /**
   * TEST-ONLY SHORTCUT (demo-* emulators only). Moves started_at, expires_at and stop_at back by
   * `ms`, keeping the session's 1-hour shape, so its end comes sooner. It writes with the Firestore
   * emulator's owner access (what the Admin SDK has), right after createSession and before any ping
   * or open; nothing in production can do this.
   */
  async backdate(session: Session, ms: number): Promise<Session> {
    if (!this.set.projectId.startsWith('demo-')) throw new Error('backdate() runs only against demo-* emulators');
    if (!(ms >= 0) || ms > SESSION_LIMIT_MINUTES * MIN) throw new Error(`can't backdate by ${String(ms)} ms (0 to 60 minutes)`);
    const shift = (d: Date): Date => new Date(d.getTime() - ms);
    const fields: Record<string, { timestampValue: string } | { nullValue: null }> = {
      started_at: { timestampValue: shift(session.startedAt).toISOString() },
      expires_at: { timestampValue: shift(session.expiresAt).toISOString() },
      stop_at: session.stopAt ? { timestampValue: shift(session.stopAt).toISOString() } : { nullValue: null },
    };
    const mask = Object.keys(fields).map((f) => `updateMask.fieldPaths=${f}`).join('&');
    const url = `${firestoreBase(this.set)}/v1/projects/${this.set.projectId}/databases/(default)/documents/shareSessions/${session.id}?${mask}&currentDocument.exists=true`;
    const res = await fetch(url, { method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields }) });
    if (!res.ok) throw new Error(`backdating session ${session.id} failed: HTTP ${String(res.status)} ${await res.text()}`);
    const after = await this.read(session.id);
    const moved: Session = { ...session, startedAt: shift(session.startedAt), expiresAt: after.expires_at, stopAt: after.stop_at, backdatedMs: session.backdatedMs + ms };
    if (after.expires_at.getTime() !== shift(session.expiresAt).getTime()) throw new Error('backdate: expires_at did not change');
    return moved;
  }

  /** The session as its owner reads it. */
  async read(sessionId: string): Promise<SessionState> {
    const snap = await getDoc(doc(this.db, 'shareSessions', sessionId));
    // A check-in this client just wrote reads as its local estimate until the server confirms it.
    const data = snap.data({ serverTimestamps: 'estimate' });
    if (!data) throw new Error(`session ${sessionId} doesn't exist`);
    return stateOf(data);
  }

  /** Follows the session doc as its owner. Returns a function that stops. */
  watch(sessionId: string, next: (state: SessionState) => void, error: (message: string) => void): () => void {
    return onSnapshot(
      doc(this.db, 'shareSessions', sessionId),
      (snap) => {
        // A check-in this client just wrote reads as its local estimate until the server confirms it.
    const data = snap.data({ serverTimestamps: 'estimate' });
        if (data) next(stateOf(data));
      },
      (e) => {
        error(describe(e));
      },
    );
  }

  /**
   * Writes one ping and the check-in that goes with it, in one batch. While approximate, the point is
   * rounded to about 500 m and the accuracy floored at 500, as the phone does. `place` also sets the
   * session's place in that batch, with this ping's recorded_at as its at (null clears it). Throws
   * WriteRefused when the rules say no.
   */
  async ping(session: Session, fix: Fix, o: { recordedAt?: Date; interval_s?: number; id?: string; place?: PlaceParts | null } = {}): Promise<WrittenPing> {
    const written = session.precision === 'approximate' ? approximate(fix) : fix;
    // A phone takes fixes on a timer, never two within MIN_PING_SPACING_SECONDS, and the rules refuse
    // a ping that close (Q-PING-WRITE). A fix taken "now" waits out the spacing, so a caller's timing
    // can't trip it by accident; only an explicit recordedAt (the rule tests) can.
    const previous = this.lastRecorded.get(session.id);
    if (o.recordedAt === undefined && previous !== undefined) {
      const ready = previous + MIN_PING_SPACING_SECONDS * 1000 + 1;
      if (Date.now() < ready) await new Promise((r) => setTimeout(r, ready - Date.now()));
    }
    const recordedAt = o.recordedAt ?? new Date();
    const recorded = Timestamp.fromDate(recordedAt);
    const pings = collection(this.db, 'shareSessions', session.id, 'pings');
    const ref = o.id === undefined ? doc(pings) : doc(pings, o.id);
    const batch = writeBatch(this.db);
    batch.set(ref, { lat: written.lat, lng: written.lng, recorded_at: recorded, accuracy_m: written.accuracy_m });
    const checkIn: Record<string, unknown> = { last_ping_at: serverTimestamp(), last_fix_at: recorded };
    if (o.interval_s !== undefined && this.intervals.get(session.id) !== o.interval_s) checkIn.ping_interval_s = o.interval_s;
    if (o.place !== undefined) checkIn.place = o.place === null ? null : { ...o.place, at: recorded };
    batch.update(doc(this.db, 'shareSessions', session.id), checkIn);
    await this.commit(batch, session, recordedAt);
    this.lastRecorded.set(session.id, Math.max(recordedAt.getTime(), this.lastRecorded.get(session.id) ?? -Infinity));
    if (checkIn.ping_interval_s !== undefined) this.intervals.set(session.id, o.interval_s as number);
    return { id: ref.id, ...written, recorded_at: recordedAt, ...(o.place !== undefined ? { place: o.place } : {}) };
  }

  /** Whether the session holds a ping recorded at exactly this time (the owner may read pings). */
  private async hasPingAt(sessionId: string, recordedAt: Date): Promise<boolean> {
    const q = query(collection(this.db, 'shareSessions', sessionId, 'pings'), where('recorded_at', '==', Timestamp.fromDate(recordedAt)), limit(1));
    return !(await getDocs(q)).empty;
  }

  /** A check-in without a fix (no GPS): last_ping_at only, as the app does every 30 s. */
  async checkIn(session: Session): Promise<void> {
    const batch = writeBatch(this.db);
    batch.update(doc(this.db, 'shareSessions', session.id), { last_ping_at: serverTimestamp() });
    await this.commit(batch, session);
  }

  /**
   * Commits a batch. A refused ping batch whose fix the session already holds (last_fix_at at or after
   * its recorded_at) is one that landed and was retried after a lost reply: it counts as written
   * (x-decisions Q-PING-WRITE).
   */
  private async commit(batch: ReturnType<typeof writeBatch>, session: Session, recordedAt?: Date): Promise<void> {
    try {
      await batch.commit();
    } catch (e) {
      if (e instanceof FirebaseError && e.code === 'permission-denied') {
        if (recordedAt !== undefined) {
          const lastFix = (await this.read(session.id).catch(() => null))?.last_fix_at ?? null;
          if (lastFix !== null && lastFix.getTime() >= recordedAt.getTime() && (await this.hasPingAt(session.id, recordedAt))) return;
        }
        const over = Date.now() >= dueAt({ stop_at: session.stopAt, expires_at: session.expiresAt }).getTime();
        throw new WriteRefused(over ? 'the session is over (its timer or 1-hour limit passed)' : describe(e), e.code, over);
      }
      throw e;
    }
  }

  /** Stop, through stopSession. Idempotent. */
  stop(session: Session | string): Promise<StopSessionResponse> {
    const id = typeof session === 'string' ? session : session.id;
    return this.callable<{ session_id: string }, StopSessionResponse>('stopSession')({ session_id: id });
  }

  /** The ID token, for direct REST checks in tests. */
  idToken(): Promise<string> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('not signed in');
    return user.getIdToken();
  }

  async close(): Promise<void> {
    await terminate(this.db).catch(() => undefined);
    await deleteApp(this.app).catch(() => undefined);
  }
}

/** FSD §4/§7: every 3-5 s above 20% battery, 15 s from 20% to 10%, 60 s under 10%. */
export function intervalForBattery(percent: number): number {
  if (percent > 20) return 4;
  if (percent >= 10) return 15;
  return 60;
}

/** The rules keep pings at least MIN_PING_SPACING_SECONDS apart, and never fewer than one a minute. */
export function checkInterval(seconds: number): number {
  if (!(seconds >= MIN_PING_SPACING_SECONDS) || seconds > MAX_PING_INTERVAL_SECONDS) {
    throw new Error(`the ping interval must be from ${String(MIN_PING_SPACING_SECONDS)} to ${String(MAX_PING_INTERVAL_SECONDS)} s, got ${String(seconds)}`);
  }
  return seconds;
}
