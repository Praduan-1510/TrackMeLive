/**
 * Which Firebase the page talks to, from Vite's env (import.meta.env), checked before anything
 * connects. Pure, so every rule is unit-tested (config.test.ts).
 *
 *   production build   the real project, from VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID and
 *                      VITE_FIREBASE_APP_ID (plus VITE_FIREBASE_AUTH_DOMAIN), set where it's built.
 *                      Never the emulators, whatever else is set. Without them, a share link says it
 *                      can't be opened right now.
 *   any other mode     the local emulators (`npm run dev`, the live e2e's 'emulator' build):
 *     VITE_TML_PROJECT_ID       demo-trackmelive   must start with demo-, so it can never reach a real project
 *     VITE_TML_EMULATOR_HOST    127.0.0.1
 *     VITE_TML_AUTH_PORT        9099
 *     VITE_TML_FIRESTORE_PORT   8080
 *     VITE_TML_FUNCTIONS_PORT   5001
 *
 * No keys live in the repo: the real values come from the build's environment (a git-ignored
 * .env.production.local, or CI), and the emulators accept any key.
 */

export type Env = Readonly<Record<string, string | boolean | undefined>>;

export interface Emulators {
  readonly host: string;
  readonly auth: number;
  readonly firestore: number;
  readonly functions: number;
}

export interface FirebaseTarget {
  readonly options: { readonly apiKey: string; readonly projectId: string; readonly appId: string; readonly authDomain?: string };
  /** The functions' region (code/backend/functions/src/index.ts). */
  readonly region: string;
  /** Null for the real project. */
  readonly emulators: Emulators | null;
}

export const DEV_EMULATORS = { projectId: 'demo-trackmelive', host: '127.0.0.1', auth: 9099, firestore: 8080, functions: 5001 } as const;
const REGION = 'us-central1';

export class ConfigError extends Error {
  constructor(message: string) {
    super(`Track Me Live viewer config: ${message}`);
    this.name = 'ConfigError';
  }
}

const str = (env: Env, name: string): string | undefined => {
  const v = env[name];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
};

function port(env: Env, name: string, fallback: number): number {
  const raw = str(env, name);
  if (raw === undefined) return fallback;
  const n = /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 65_535) throw new ConfigError(`${name} must be a port from 1 to 65535, not "${raw}"`);
  return n;
}

function host(env: Env, name: string, fallback: string): string {
  const raw = str(env, name) ?? fallback;
  // A host name or IPv4 address only: no scheme, port, path or spaces.
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(raw)) throw new ConfigError(`${name} must be a host name or IPv4 address, not "${raw}"`);
  return raw;
}

function demoProject(env: Env, name: string, fallback: string): string {
  const raw = str(env, name) ?? fallback;
  if (!/^demo-[a-z0-9-]{1,24}$/.test(raw)) throw new ConfigError(`${name} must be a demo- project id (the emulators only), not "${raw}"`);
  return raw;
}

/**
 * The target for a build in `mode` with `env`, or null when a production build has no project
 * configured. Throws ConfigError for a value that can't be right.
 */
export function firebaseTarget(mode: string, env: Env): FirebaseTarget | null {
  if (mode === 'production') {
    const apiKey = str(env, 'VITE_FIREBASE_API_KEY');
    const projectId = str(env, 'VITE_FIREBASE_PROJECT_ID');
    const appId = str(env, 'VITE_FIREBASE_APP_ID');
    if (!apiKey || !projectId || !appId) return null;
    if (projectId.startsWith('demo-')) throw new ConfigError('a production build can’t use a demo- project (those exist only in the emulators)');
    const authDomain = str(env, 'VITE_FIREBASE_AUTH_DOMAIN');
    return { options: { apiKey, projectId, appId, ...(authDomain ? { authDomain } : {}) }, region: REGION, emulators: null };
  }
  const projectId = demoProject(env, 'VITE_TML_PROJECT_ID', DEV_EMULATORS.projectId);
  return {
    // The emulators accept any key; the SDK only needs one to be there.
    options: { apiKey: 'emulator-only', projectId, appId: '1:000000000000:web:0000000000000000' },
    region: REGION,
    emulators: {
      host: host(env, 'VITE_TML_EMULATOR_HOST', DEV_EMULATORS.host),
      auth: port(env, 'VITE_TML_AUTH_PORT', DEV_EMULATORS.auth),
      firestore: port(env, 'VITE_TML_FIRESTORE_PORT', DEV_EMULATORS.firestore),
      functions: port(env, 'VITE_TML_FUNCTIONS_PORT', DEV_EMULATORS.functions),
    },
  };
}

/**
 * For tests and tools that start the page next to an emulator set: the VITE_TML_* values for the
 * set that code/backend/scripts/with-test-emulators.sh (or `firebase emulators:exec`) describes in
 * FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, FUNCTIONS_EMULATOR_HOST and GCLOUD_PROJECT.
 * Throws, naming what's missing, when any of them isn't set: an emulator test never runs half set up.
 */
export function viteEnvForEmulators(env: Env): Record<string, string> {
  const need = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FUNCTIONS_EMULATOR_HOST', 'GCLOUD_PROJECT'] as const;
  const missing = need.filter((n) => str(env, n) === undefined);
  if (missing.length > 0) {
    throw new ConfigError(
      `${missing.join(', ')} not set. Run this under code/backend/scripts/with-test-emulators.sh, or set them for a running emulator set (host:port each, and the project id).`,
    );
  }
  const split = (name: (typeof need)[number]): { host: string; port: string } => {
    const raw = str(env, name) ?? '';
    const m = /^([^:]+):(\d+)$/.exec(raw);
    if (!m?.[1] || !m[2]) throw new ConfigError(`${name} must be host:port, not "${raw}"`);
    return { host: m[1], port: m[2] };
  };
  const firestore = split('FIRESTORE_EMULATOR_HOST');
  const auth = split('FIREBASE_AUTH_EMULATOR_HOST');
  const functions = split('FUNCTIONS_EMULATOR_HOST');
  if (auth.host !== firestore.host || functions.host !== firestore.host) {
    throw new ConfigError('the Auth, Firestore and Functions emulators must share one host');
  }
  const vite = {
    VITE_TML_PROJECT_ID: str(env, 'GCLOUD_PROJECT') ?? '',
    VITE_TML_EMULATOR_HOST: firestore.host,
    VITE_TML_AUTH_PORT: auth.port,
    VITE_TML_FIRESTORE_PORT: firestore.port,
    VITE_TML_FUNCTIONS_PORT: functions.port,
  };
  // The same checks the page makes, now rather than in the browser.
  firebaseTarget('emulator', vite);
  return vite;
}
