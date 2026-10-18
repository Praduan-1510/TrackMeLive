/**
 * The simulated routes and their tools, without any emulator: the route files are valid, current and
 * realistic for their mode; positions interpolate; GPX and the player's commands come out right.
 *   node --test code/qa/routes/routes.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { buildRoute, serializeRoute, SPECS } from './build-routes.ts';
import { geoFixArgs, mockFixArgs, play, simctlFixArgs, type SentFix } from './play.ts';
import { ROUTES_DIR, distanceMeters, loadRoute, positionAt, routeIds, validateRoute, type Route } from './route.ts';
import { toGpx } from './to-gpx.ts';

const routes = routeIds().map(loadRoute);

/** Stretches of standing still (speed 0), in seconds. */
function stops(r: Route): number[] {
  const out: number[] = [];
  let run = 0;
  for (const p of r.points) {
    if (p.speed_mps === 0) run += 1;
    else if (run > 0) {
      out.push(run);
      run = 0;
    }
  }
  if (run > 0) out.push(run);
  return out;
}

describe('route files', () => {
  test('there are a walk, a drive and a stop-and-go route', () => {
    assert.deepEqual(routes.map((r) => r.mode).sort(), ['drive', 'stop-and-go', 'walk']);
  });

  test('each file is exactly what build-routes.ts makes (run it after changing a spec)', () => {
    for (const spec of SPECS) {
      assert.equal(readFileSync(join(ROUTES_DIR, `${spec.id}.json`), 'utf8'), serializeRoute(buildRoute(spec)), `${spec.id}.json is stale`);
    }
  });

  for (const r of routes) {
    test(`${r.id}: a fix every second, at realistic speeds, around the Ferry Building`, () => {
      r.points.forEach((p, i) => assert.equal(p.t_s, i, `fix ${String(i)} is at ${String(p.t_s)} s`));
      const top = Math.max(...r.points.map((p) => p.speed_mps));
      const limit = { walk: 2, drive: 15, 'stop-and-go': 10 }[r.mode];
      assert.ok(top <= limit, `${r.id} reaches ${String(top)} m/s; a ${r.mode} stays under ${String(limit)}`);
      for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1];
        const b = r.points[i];
        if (!a || !b) continue;
        // Noise included, no fix jumps further than the top speed plus GPS wander allows.
        assert.ok(distanceMeters(a, b) <= limit + 15, `${r.id} jumps ${distanceMeters(a, b).toFixed(1)} m at ${String(b.t_s)} s`);
      }
      for (const p of r.points) {
        assert.ok(distanceMeters(p, { lat: 37.79432, lng: -122.39468 }) < 3000, `${r.id} strays from San Francisco's waterfront at ${String(p.t_s)} s`);
        assert.ok(p.accuracy_m >= 3 && p.accuracy_m <= 40, `${r.id} accuracy ${String(p.accuracy_m)} m at ${String(p.t_s)} s`);
      }
      assert.equal(r.points[0]?.speed_mps, 0, 'starts standing');
      assert.equal(r.points.at(-1)?.speed_mps, 0, 'ends standing');
    });
  }

  test('the stop-and-go route stops often, and the drive waits at lights', () => {
    const stopgo = routes.find((r) => r.mode === 'stop-and-go');
    const drive = routes.find((r) => r.mode === 'drive');
    assert.ok(stopgo && drive);
    assert.ok(stops(stopgo).filter((s) => s >= 15).length >= 6, `stop-and-go stops: ${stops(stopgo).join(', ')}`);
    assert.ok(stops(drive).filter((s) => s >= 15).length >= 3, `drive stops: ${stops(drive).join(', ')}`);
  });

  test('a broken route says what is wrong', () => {
    assert.throws(() => validateRoute({ format: 'tml-route/1', id: 'x', title: 't', summary: '', mode: 'walk', duration_s: 1, distance_m: 0, points: [{ t_s: 0, lat: 91, lng: 0, accuracy_m: 5, speed_mps: 0, course_deg: 0 }, { t_s: 0, lat: 0, lng: 0, accuracy_m: 0, speed_mps: 0, course_deg: 0 }] }), /lat out of range[\s\S]*is not after[\s\S]*accuracy_m/);
    assert.throws(() => loadRoute('no-such-route'), /No route "no-such-route".*walk-ferry-building/);
  });
});

describe('positionAt', () => {
  const r = loadRoute('drive-embarcadero-south');
  test('interpolates between fixes and clamps to the ends', () => {
    const a = r.points[10];
    const b = r.points[11];
    assert.ok(a && b);
    const mid = positionAt(r, 10.5);
    assert.ok(Math.abs(mid.lat - (a.lat + b.lat) / 2) < 1e-9 && Math.abs(mid.lng - (a.lng + b.lng) / 2) < 1e-9);
    assert.deepEqual(positionAt(r, -5), r.points[0]);
    assert.deepEqual(positionAt(r, 1e9), r.points.at(-1));
  });
});

describe('GPX for the iOS Simulator', () => {
  const r = loadRoute('walk-ferry-building');
  test('one waypoint per second at the speed factor, with times Xcode reads', () => {
    const gpx = toGpx(r, { speed: 10, start: '2026-01-01T09:00:00Z' });
    const wpts = [...gpx.matchAll(/<wpt lat="(-?[\d.]+)" lon="(-?[\d.]+)"><time>([^<]+)<\/time><\/wpt>/g)];
    assert.equal(wpts.length, Math.ceil(r.duration_s / 10) + 1);
    wpts.forEach((m, i) => assert.equal(m[3], new Date(Date.parse('2026-01-01T09:00:00Z') + i * 1000).toISOString().replace('.000Z', 'Z')));
    const last = wpts.at(-1);
    const end = r.points.at(-1);
    assert.ok(last && end);
    assert.equal(Number(last[1]), end.lat);
    assert.equal(Number(last[2]), end.lng);
    assert.match(gpx, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<gpx version="1.1" /);
  });
});

describe('the player', () => {
  const p = { t_s: 0, lat: 37.7947, lng: -122.3933, accuracy_m: 7, speed_mps: 10, course_deg: 90 };
  test('geo fix takes the longitude first, and speed in knots', () => {
    assert.deepEqual(geoFixArgs(p), ['emu', 'geo', 'fix', '-122.393300', '37.794700', '10', '8', '19.44']);
  });
  test('the mock provider and simctl take latitude first', () => {
    assert.deepEqual(mockFixArgs(p).slice(-4), ['--location', '37.794700,-122.393300', '--accuracy', '7.0']);
    assert.deepEqual(simctlFixArgs('booted', p), ['simctl', 'location', 'booted', 'set', '37.794700,-122.393300']);
  });
  test('a dry run covers the route at the speed factor, ends on the last fix, and sets up and removes the mock provider', async () => {
    const r = loadRoute('stopgo-market-street');
    const fixes: SentFix[] = [];
    const lines: string[] = [];
    const result = await play({ route: r, via: 'mock', speed: 60, accuracy: 30, dryRun: true, log: (l) => lines.push(l), onFix: (f) => fixes.push(f) });
    assert.equal(result.stopped, 'end');
    assert.equal(fixes.length, Math.ceil(r.duration_s / 60) + 1);
    assert.equal(fixes.at(-1)?.route_t_s, r.duration_s);
    assert.ok(fixes.every((f) => f.accuracy_m === 30));
    assert.match(lines[0] ?? '', /appops set com\.android\.shell android:mock_location allow$/);
    assert.match(lines.at(-1) ?? '', /appops set com\.android\.shell android:mock_location default$/);
    assert.ok(lines.every((l) => l.includes('with-lock.sh emulator')), 'every adb command takes the emulator lock');
  });
});
