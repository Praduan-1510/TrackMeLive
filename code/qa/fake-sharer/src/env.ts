/**
 * Which Firebase emulator set the fake sharer talks to. The dev set (code/backend/run.sh) by default;
 * code/backend/scripts/with-test-emulators.sh exports the test set's project and hosts, which win:
 *
 *   GCLOUD_PROJECT                demo-trackmelive        (test set: demo-trackmelive-test)
 *   FIREBASE_AUTH_EMULATOR_HOST   127.0.0.1:9099          (9199)
 *   FIRESTORE_EMULATOR_HOST       127.0.0.1:8080          (8180)
 *   FUNCTIONS_EMULATOR_HOST       127.0.0.1:5001          (5101)
 *
 * Only demo-* projects on this machine's loopback are ever used: a demo project can't reach real
 * Firebase resources, and nothing here can be pointed at production.
 */

export interface HostPort {
  readonly host: string;
  readonly port: number;
}

export interface EmulatorSet {
  readonly projectId: string;
  readonly auth: HostPort;
  readonly firestore: HostPort;
  readonly functions: HostPort;
  readonly region: string;
}

function hostPort(raw: string, name: string): HostPort {
  const i = raw.lastIndexOf(':');
  const host = raw.slice(0, i);
  const port = Number(raw.slice(i + 1));
  if (i < 1 || !Number.isInteger(port) || port <= 0) throw new Error(`${name} must be host:port, got "${raw}"`);
  return { host, port };
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function emulatorSet(env: NodeJS.ProcessEnv = process.env): EmulatorSet {
  const set: EmulatorSet = {
    projectId: env.GCLOUD_PROJECT ?? 'demo-trackmelive',
    auth: hostPort(env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099', 'FIREBASE_AUTH_EMULATOR_HOST'),
    firestore: hostPort(env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080', 'FIRESTORE_EMULATOR_HOST'),
    functions: hostPort(env.FUNCTIONS_EMULATOR_HOST ?? '127.0.0.1:5001', 'FUNCTIONS_EMULATOR_HOST'),
    region: 'us-central1',
  };
  if (!set.projectId.startsWith('demo-')) {
    throw new Error(`Refusing project "${set.projectId}": the fake sharer only runs against demo-* emulator projects.`);
  }
  for (const [name, hp] of [['Auth', set.auth], ['Firestore', set.firestore], ['Functions', set.functions]] as const) {
    if (!LOOPBACK.has(hp.host)) throw new Error(`Refusing the ${name} emulator at ${hp.host}: only this machine's loopback is allowed.`);
  }
  return set;
}

export const authBase = (s: EmulatorSet): string => `http://${s.auth.host}:${String(s.auth.port)}`;
export const firestoreBase = (s: EmulatorSet): string => `http://${s.firestore.host}:${String(s.firestore.port)}`;
export const functionsBase = (s: EmulatorSet): string => `http://${s.functions.host}:${String(s.functions.port)}`;

/** Fails with one clear line per emulator that doesn't answer. */
export async function checkEmulators(s: EmulatorSet): Promise<void> {
  const probes: readonly [string, string][] = [
    ['Auth', `${authBase(s)}/emulator/v1/projects/${s.projectId}/config`],
    ['Firestore', `${firestoreBase(s)}/`],
    ['Functions', `${functionsBase(s)}/`],
  ];
  const down: string[] = [];
  await Promise.all(
    probes.map(async ([name, url]) => {
      try {
        await fetch(url, { signal: AbortSignal.timeout(3000) });
      } catch {
        down.push(`${name} (${url})`);
      }
    }),
  );
  if (down.length > 0) {
    throw new Error(
      `The Firebase emulators for ${s.projectId} aren't answering: ${down.sort().join(', ')}.\n` +
        '  Dev set: code/scripts/with-lock.sh firebase code/backend/run.sh\n' +
        '  Test set: code/backend/scripts/with-test-emulators.sh <command>',
    );
  }
}
