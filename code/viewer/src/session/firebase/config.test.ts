import { describe, expect, it } from 'vitest';
import { ConfigError, DEV_EMULATORS, firebaseTarget, viteEnvForEmulators } from './config';

const REAL = { VITE_FIREBASE_API_KEY: 'key-from-the-build', VITE_FIREBASE_PROJECT_ID: 'trackmelive', VITE_FIREBASE_APP_ID: '1:1:web:1' };
const TEST_SET = {
  GCLOUD_PROJECT: 'demo-trackmelive-test',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9199',
  FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5101',
};

describe('firebaseTarget', () => {
  it('points every other mode at the dev emulator set by default', () => {
    for (const mode of ['development', 'emulator', 'test']) {
      expect(firebaseTarget(mode, {})).toEqual({
        options: { apiKey: 'emulator-only', projectId: 'demo-trackmelive', appId: '1:000000000000:web:0000000000000000' },
        region: 'us-central1',
        emulators: { host: DEV_EMULATORS.host, auth: 9099, firestore: 8080, functions: 5001 },
      });
    }
  });

  it('takes another emulator set from VITE_TML_*', () => {
    const t = firebaseTarget('development', {
      VITE_TML_PROJECT_ID: 'demo-trackmelive-test',
      VITE_TML_EMULATOR_HOST: 'localhost',
      VITE_TML_AUTH_PORT: '9199',
      VITE_TML_FIRESTORE_PORT: '8180',
      VITE_TML_FUNCTIONS_PORT: ' 5101 ',
    });
    expect(t?.options.projectId).toBe('demo-trackmelive-test');
    expect(t?.emulators).toEqual({ host: 'localhost', auth: 9199, firestore: 8180, functions: 5101 });
    // Blank means unset.
    expect(firebaseTarget('development', { VITE_TML_AUTH_PORT: '' })?.emulators?.auth).toBe(9099);
  });

  it('refuses a port that isn’t a whole number from 1 to 65535', () => {
    for (const bad of ['0', '65536', '80.5', '-1', '1e3', '99999', 'http', '8080x', '123456']) {
      expect(() => firebaseTarget('development', { VITE_TML_FIRESTORE_PORT: bad })).toThrow(ConfigError);
    }
    expect(() => firebaseTarget('development', { VITE_TML_AUTH_PORT: '0' })).toThrow(/VITE_TML_AUTH_PORT must be a port/);
    expect(firebaseTarget('development', { VITE_TML_FUNCTIONS_PORT: '65535' })?.emulators?.functions).toBe(65_535);
  });

  it('refuses a host with a scheme, a port or a path, and a project that isn’t a demo one', () => {
    for (const bad of ['http://127.0.0.1', '127.0.0.1:8080', 'host/path', 'a b', '-host']) {
      expect(() => firebaseTarget('development', { VITE_TML_EMULATOR_HOST: bad })).toThrow(ConfigError);
    }
    for (const bad of ['trackmelive', 'demo-', 'Demo-x', 'demo-UPPER']) {
      expect(() => firebaseTarget('development', { VITE_TML_PROJECT_ID: bad })).toThrow(/demo- project id/);
    }
  });

  it('never connects a production build to the emulators, whatever is set', () => {
    const emulatorVars = { VITE_TML_PROJECT_ID: 'demo-trackmelive', VITE_TML_EMULATOR_HOST: '127.0.0.1', VITE_TML_AUTH_PORT: '9099' };
    expect(firebaseTarget('production', emulatorVars)).toBeNull();
    const t = firebaseTarget('production', { ...REAL, ...emulatorVars, VITE_FIREBASE_AUTH_DOMAIN: 'trackme.live' });
    expect(t).toEqual({
      options: { apiKey: 'key-from-the-build', projectId: 'trackmelive', appId: '1:1:web:1', authDomain: 'trackme.live' },
      region: 'us-central1',
      emulators: null,
    });
    expect(() => firebaseTarget('production', { ...REAL, VITE_FIREBASE_PROJECT_ID: 'demo-trackmelive' })).toThrow(ConfigError);
  });

  it('has no real project until the build is given one', () => {
    expect(firebaseTarget('production', {})).toBeNull();
    expect(firebaseTarget('production', { ...REAL, VITE_FIREBASE_APP_ID: ' ' })).toBeNull();
  });
});

describe('viteEnvForEmulators', () => {
  it('maps the emulator wrapper’s variables onto the page’s', () => {
    expect(viteEnvForEmulators({ ...TEST_SET, TML_TEST_EMULATORS: '1' })).toEqual({
      VITE_TML_PROJECT_ID: 'demo-trackmelive-test',
      VITE_TML_EMULATOR_HOST: '127.0.0.1',
      VITE_TML_AUTH_PORT: '9199',
      VITE_TML_FIRESTORE_PORT: '8180',
      VITE_TML_FUNCTIONS_PORT: '5101',
    });
  });

  it('fails loudly, naming what’s missing, when it isn’t run beside an emulator set', () => {
    expect(() => viteEnvForEmulators({})).toThrow(/FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, FUNCTIONS_EMULATOR_HOST, GCLOUD_PROJECT not set/);
    expect(() => viteEnvForEmulators({ ...TEST_SET, GCLOUD_PROJECT: '' })).toThrow(/GCLOUD_PROJECT not set/);
  });

  it('refuses hosts without a port, hosts that differ, and a project that isn’t a demo one', () => {
    expect(() => viteEnvForEmulators({ ...TEST_SET, FIRESTORE_EMULATOR_HOST: '127.0.0.1' })).toThrow(/host:port/);
    expect(() => viteEnvForEmulators({ ...TEST_SET, FUNCTIONS_EMULATOR_HOST: 'localhost:5101' })).toThrow(/one host/);
    expect(() => viteEnvForEmulators({ ...TEST_SET, GCLOUD_PROJECT: 'trackmelive' })).toThrow(/demo- project id/);
    expect(() => viteEnvForEmulators({ ...TEST_SET, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:99999' })).toThrow(/must be a port/);
  });
});
