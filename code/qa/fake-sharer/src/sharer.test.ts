/**
 * The fake sharer's rules that need no emulator: which emulators it will talk to, approximate
 * rounding, the FSD cadence, and the viewer link. The rest runs against the emulators in
 * code/qa/e2e-sharing.
 *   node --test code/qa/fake-sharer/src/sharer.test.ts
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { distanceMeters } from '../../routes/route.ts';
import { viewerUrl } from './cli.ts';
import { emulatorSet } from './env.ts';
import { approximate, checkInterval, dueAt, intervalForBattery, randomPhone } from './sharer.ts';

describe('emulatorSet', () => {
  test('defaults to the dev set, and takes the test set from with-test-emulators.sh', () => {
    assert.deepEqual(emulatorSet({}), {
      projectId: 'demo-trackmelive',
      auth: { host: '127.0.0.1', port: 9099 },
      firestore: { host: '127.0.0.1', port: 8080 },
      functions: { host: '127.0.0.1', port: 5001 },
      region: 'us-central1',
    });
    const test = emulatorSet({
      GCLOUD_PROJECT: 'demo-trackmelive-test',
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9199',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180',
      FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5101',
    });
    assert.equal(test.projectId, 'demo-trackmelive-test');
    assert.equal(test.firestore.port, 8180);
  });
  test('refuses anything but a demo- project on this machine', () => {
    assert.throws(() => emulatorSet({ GCLOUD_PROJECT: 'trackme-prod' }), /only runs against demo-\*/);
    assert.throws(() => emulatorSet({ FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' }), /only this machine's loopback/);
    assert.throws(() => emulatorSet({ FIREBASE_AUTH_EMULATOR_HOST: 'nonsense' }), /host:port/);
  });
});

describe('approximate', () => {
  test('rounds to about 500 m and floors the accuracy at 500 m (FSD §4 Location detail)', () => {
    const here = { lat: 37.79475, lng: -122.3959, accuracy_m: 6 };
    const a = approximate(here);
    assert.equal(a.accuracy_m, 500);
    assert.ok(distanceMeters(a, here) <= 250 * Math.SQRT2 + 1, `moved ${distanceMeters(a, here).toFixed(0)} m`);
    // Points in the same cell land on the same rounded point.
    assert.deepEqual(approximate({ ...here, lat: here.lat + 0.0001 }), a);
    assert.equal(approximate({ ...here, accuracy_m: 800 }).accuracy_m, 800);
  });
});

describe('cadence', () => {
  test('FSD §4/§7 battery steps: 3-5 s above 20%, 15 s to 10%, 60 s under', () => {
    assert.equal(intervalForBattery(80), 4);
    assert.equal(intervalForBattery(20), 15);
    assert.equal(intervalForBattery(10), 15);
    assert.equal(intervalForBattery(9), 60);
  });
  test('the rules allow 2 to 60 s between pings', () => {
    assert.equal(checkInterval(2), 2);
    assert.equal(checkInterval(60), 60);
    assert.throws(() => checkInterval(1.5), /from 2 to 60 s/);
    assert.throws(() => checkInterval(61), /from 2 to 60 s/);
  });
});

describe('small things', () => {
  test('a session is due at the earlier of its timer and its limit', () => {
    const limit = new Date(2_000);
    assert.equal(dueAt({ stop_at: new Date(1_000), expires_at: limit }).getTime(), 1_000);
    assert.equal(dueAt({ stop_at: null, expires_at: limit }), limit);
  });
  test('QA numbers are in 415 555, away from the Android script’s 650', () => {
    for (let i = 0; i < 20; i++) assert.match(randomPhone(), /^\+1415555\d{4}$/);
  });
  test('the viewer link is built from the token, whatever origin createSession used', () => {
    assert.equal(viewerUrl('http://localhost:5173/', 'abcDEF123_-abcDEF123_-'), 'http://localhost:5173/s/abcDEF123_-abcDEF123_-');
  });
});
