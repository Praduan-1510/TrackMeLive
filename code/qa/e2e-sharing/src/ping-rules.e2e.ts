/**
 * Gate G2, the server's side of "no location after the end", and the ping write contract
 * (x-decisions Q-PING-WRITE): the fake sharer writes through the real client path, and the security
 * rules on the emulator decide. No browser.
 *
 *   code/backend/scripts/with-test-emulators.sh npm --prefix code/qa/e2e-sharing run test:rules
 *
 * Step B (pings at least 2 s apart; a first ping at most 5 min before started_at) has been
 * unconditional in firestore.rules since every ping writer sends last_fix_at.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { FIRST_PING_BEFORE_START_MINUTES, MAX_ACCURACY_METERS, MIN_PING_SPACING_SECONDS, PING_CLOCK_SKEW_SECONDS, PING_ID_MAX_LENGTH } from '../../../shared/schema/generated/ts/schema.ts';
import { FakeSharer, WriteRefused, type Fix } from '../../fake-sharer/src/sharer.ts';
import { setName } from './harness.ts';

const HERE: Fix = { lat: 37.79475, lng: -122.3959, accuracy_m: 6 };
const S = 1000;

let sharer: FakeSharer;

before(async () => {
  sharer = await FakeSharer.signIn({ profile: { name: 'Alex' } });
  console.log(`# emulator set: ${setName()} (${sharer.set.projectId})`);
});
after(async () => {
  await sharer?.close();
});

/** A fresh 30-minute share. The account has one session at a time, so each test starts its own in turn. */
const share = () => sharer.share({ stop_rule: 'minutes', stop_minutes: 30 });

describe('ping writes: the rules keep the contract', () => {
  test('a ping with its check-in and last_fix_at is accepted, and last_fix_at follows it', async () => {
    const s = await share();
    const p = await sharer.ping(s, HERE, { interval_s: 3 });
    const state = await sharer.read(s.id);
    assert.equal(state.last_fix_at?.getTime(), p.recorded_at.getTime());
    assert.equal(state.ping_interval_s, 3);
    await sharer.stop(s);
  });

  test(`a ping recorded more than ${String(PING_CLOCK_SKEW_SECONDS)} s ahead of server time is refused`, async () => {
    const s = await share();
    await assert.rejects(sharer.ping(s, HERE, { recordedAt: new Date(Date.now() + (PING_CLOCK_SKEW_SECONDS + 60) * S) }), WriteRefused);
    await sharer.ping(s, HERE, { recordedAt: new Date(Date.now() + 10 * S) });
    await sharer.stop(s);
  });

  test(`accuracy over ${String(MAX_ACCURACY_METERS / 1000)} km is refused`, async () => {
    const s = await share();
    await assert.rejects(sharer.ping(s, { ...HERE, accuracy_m: MAX_ACCURACY_METERS + 1 }), WriteRefused);
    await sharer.ping(s, { ...HERE, accuracy_m: MAX_ACCURACY_METERS });
    await sharer.stop(s);
  });

  test(`a ping id must be 1 to ${String(PING_ID_MAX_LENGTH)} characters of [A-Za-z0-9_-]`, async () => {
    const s = await share();
    await assert.rejects(sharer.ping(s, HERE, { id: 'x'.repeat(PING_ID_MAX_LENGTH + 1) }), WriteRefused);
    await assert.rejects(sharer.ping(s, HERE, { id: 'not.allowed' }), WriteRefused);
    await sharer.ping(s, HERE, { id: `qa_${'y'.repeat(PING_ID_MAX_LENGTH - 3)}` });
    await sharer.stop(s);
  });

  test('a ping older than the newest one is refused (last_fix_at only moves forward)', async () => {
    const s = await share();
    const first = await sharer.ping(s, HERE);
    await assert.rejects(sharer.ping(s, HERE, { recordedAt: new Date(first.recorded_at.getTime() - 5 * S) }), WriteRefused);
    await sharer.stop(s);
  });

  test('a retried batch that already landed counts as written', async () => {
    const s = await share();
    const p = await sharer.ping(s, HERE, { id: 'qa-retry' });
    // The same batch again, as an SDK retry after a lost reply: the rules refuse it, and the sharer treats it as written.
    const again = await sharer.ping(s, HERE, { id: 'qa-retry', recordedAt: p.recorded_at });
    assert.equal(again.id, 'qa-retry');
    await sharer.stop(s);
  });

  test('after Stop, neither a ping nor a check-in is accepted', async () => {
    const s = await share();
    await sharer.ping(s, HERE);
    await sharer.stop(s);
    await assert.rejects(sharer.ping(s, HERE), WriteRefused);
    await assert.rejects(sharer.checkIn(s), WriteRefused);
  });

  test('two fixes asked for back to back both land, spaced as the rules need (the fake sharer waits)', async () => {
    const s = await share();
    try {
      const a = await sharer.ping(s, HERE);
      const b = await sharer.ping(s, HERE);
      assert.ok(b.recorded_at.getTime() - a.recorded_at.getTime() >= MIN_PING_SPACING_SECONDS * S, 'the second fix waited out the spacing');
    } finally {
      await sharer.stop(s);
    }
  });

  test(`pings closer than ${String(MIN_PING_SPACING_SECONDS)} s apart are refused`, async () => {
    const s = await share();
    try {
      const first = await sharer.ping(s, HERE);
      await assert.rejects(sharer.ping(s, HERE, { recordedAt: new Date(first.recorded_at.getTime() + 1 * S) }), WriteRefused, 'a ping 1 s after the last one');
      await sharer.ping(s, HERE, { recordedAt: new Date(first.recorded_at.getTime() + MIN_PING_SPACING_SECONDS * S) });
    } finally {
      await sharer.stop(s);
    }
  });

  test(`a first ping more than ${String(FIRST_PING_BEFORE_START_MINUTES)} min before the start is refused`, async () => {
    const s = await share();
    try {
      const start = s.startedAt.getTime();
      await assert.rejects(sharer.ping(s, HERE, { recordedAt: new Date(start - (FIRST_PING_BEFORE_START_MINUTES + 1) * 60 * S) }), WriteRefused);
      await sharer.ping(s, HERE, { recordedAt: new Date(start - (FIRST_PING_BEFORE_START_MINUTES - 1) * 60 * S) });
    } finally {
      await sharer.stop(s);
    }
  });
});
