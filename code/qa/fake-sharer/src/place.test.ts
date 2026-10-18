/**
 * The fake sharer's "Where Alex is" writes (x-decisions Q-PLACE), without an emulator: how a part is
 * cleaned, what Approximate may say, and the lookup cadence, alone and along the real routes. The
 * rules' side runs in code/backend/tests (rules.test.ts).
 *   node --test code/qa/fake-sharer/src/place.test.ts
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PLACE_LOOKUP_MIN_METERS, PLACE_LOOKUP_MIN_SECONDS, PLACE_PART_MAX_LENGTH, validate } from '../../../shared/schema/generated/ts/schema.ts';
import { distanceMeters, loadRoute, placeLabelAt, positionAt, routeIds, type PlaceLabel } from '../../routes/route.ts';
import { PlaceTracker, cleanPart, placeFor, samePlace, type PlaceParts, type PlaceWrite } from './place.ts';

const cp = (...points: number[]): string => String.fromCodePoint(...points);
const sf = (name: string | null, street: string | null, area: string | null): PlaceLabel => ({ name, street, area, city: 'San Francisco' });
const FERRY = sf('Ferry Building', 'The Embarcadero', 'Financial District');
const PIER = sf('Pier 3', 'The Embarcadero', 'Northeast Waterfront');
const HERE = { lat: 37.7955, lng: -122.3937 };
/** `m` meters north of HERE. */
const north = (m: number) => ({ lat: HERE.lat + m / 111_320, lng: HERE.lng });

describe('cleanPart: what the apps do to each part before writing it', () => {
  test('trims Unicode whitespace and keeps the inside', () => {
    assert.equal(cleanPart('  Ferry Building  '), 'Ferry Building');
    assert.equal(cleanPart(`${cp(0xa0)}Pier 39${cp(0x2003)}`), 'Pier 39');
    assert.equal(cleanPart("Pier 39  Fisherman's Wharf"), "Pier 39  Fisherman's Wharf");
  });
  test('removes control characters and bidi overrides and isolates, keeps marks like LRM', () => {
    assert.equal(cleanPart(`Ferry${cp(0x0a)}Building${cp(0x09)}`), 'FerryBuilding');
    assert.equal(cleanPart(`${cp(0x202e)}Ferry${cp(0x2066)} Building${cp(0x2069)}`), 'Ferry Building');
    assert.equal(cleanPart(`a${cp(0x200e)}b`), `a${cp(0x200e)}b`);
  });
  test('cuts to 80 UTF-16 code units, never inside a surrogate pair', () => {
    assert.equal(PLACE_PART_MAX_LENGTH, 80);
    assert.equal(cleanPart('x'.repeat(81)), 'x'.repeat(80));
    const emoji = cp(0x1f309);
    assert.equal(cleanPart(emoji.repeat(41)), emoji.repeat(40));
    const odd = cleanPart(`x${emoji.repeat(40)}`);
    assert.equal(odd, `x${emoji.repeat(39)}`);
    assert.ok((odd ?? '').length <= 80);
    // A cut that ends on a space is trimmed again.
    assert.equal(cleanPart(`${'x'.repeat(79)} y`), 'x'.repeat(79));
  });
  test('null when nothing is left', () => {
    for (const empty of [null, undefined, '', '   ', cp(0x0a, 0x202e)]) assert.equal(cleanPart(empty), null);
  });
  test('whatever it returns, the shared schema takes', () => {
    const raws = [' Ferry Building ', `${cp(0x202e)}x`, 'x'.repeat(200), cp(0x1f309).repeat(60), `${cp(0xa0)}a${cp(0x85)}b `, `Caf${cp(0xe9)}`];
    for (const raw of raws) {
      const part = cleanPart(raw);
      assert.ok(part !== null);
      assert.deepEqual(validate('PlacePart', part), [], JSON.stringify(raw));
    }
  });
});

describe('placeFor: what a lookup may say', () => {
  test('precise: every part', () => {
    assert.deepEqual(placeFor(FERRY, 'precise'), FERRY);
  });
  test('approximate: the area and the city only', () => {
    assert.deepEqual(placeFor(FERRY, 'approximate'), sf(null, null, 'Financial District'));
  });
  test('null when nothing is left to say', () => {
    assert.equal(placeFor(null, 'precise'), null);
    assert.equal(placeFor({ name: 'Ferry Building', street: null, area: null, city: null }, 'approximate'), null);
    assert.equal(placeFor({ name: ' ', street: '', area: null, city: null }, 'precise'), null);
  });
  test('samePlace compares the parts', () => {
    assert.ok(samePlace(FERRY, { ...FERRY }));
    assert.ok(samePlace(null, null));
    assert.ok(!samePlace(FERRY, PIER));
    assert.ok(!samePlace(FERRY, null));
  });
});

describe('PlaceTracker: when the phone looks up, and what it writes', () => {
  /** A geocoder that counts its calls. */
  function geocoder(answer: () => PlaceLabel | null): { lookup: () => PlaceLabel | null; calls: () => number } {
    let n = 0;
    return {
      lookup: () => {
        n += 1;
        return answer();
      },
      calls: () => n,
    };
  }
  const S = 1000;

  test('the first fix looks up and writes', () => {
    const t = new PlaceTracker();
    const g = geocoder(() => FERRY);
    assert.deepEqual(t.next(HERE, 'precise', 0, g.lookup), { place: FERRY });
    assert.equal(g.calls(), 1);
  });

  test(`at most once per ${String(PLACE_LOOKUP_MIN_SECONDS)} s, and only after moving ${String(PLACE_LOOKUP_MIN_METERS)} m`, () => {
    assert.equal(PLACE_LOOKUP_MIN_SECONDS, 10);
    assert.equal(PLACE_LOOKUP_MIN_METERS, 25);
    const t = new PlaceTracker();
    let answer: PlaceLabel = FERRY;
    const g = geocoder(() => answer);
    t.wrote(t.next(HERE, 'precise', 0, g.lookup) as PlaceWrite);
    answer = PIER;
    // Far enough, too soon.
    assert.equal(t.next(north(100), 'precise', 9_999, g.lookup), undefined);
    // Long enough, not far enough.
    assert.equal(t.next(north(24), 'precise', 60 * S, g.lookup), undefined);
    assert.equal(g.calls(), 1);
    // Both.
    assert.deepEqual(t.next(north(26), 'precise', 10 * S, g.lookup), { place: PIER });
    assert.equal(g.calls(), 2);
    assert.ok(distanceMeters(north(26), HERE) >= 25);
  });

  test('the distance counts from the fix last looked up, even when that lookup wrote nothing', () => {
    const t = new PlaceTracker();
    const g = geocoder(() => FERRY);
    t.wrote(t.next(HERE, 'precise', 0, g.lookup) as PlaceWrite);
    assert.equal(t.next(north(30), 'precise', 10 * S, g.lookup), undefined, 'same place: nothing to write');
    assert.equal(g.calls(), 2);
    // 20 m on from there: not yet, though 50 m from the first.
    assert.equal(t.next(north(50), 'precise', 30 * S, g.lookup), undefined);
    assert.equal(g.calls(), 2);
  });

  test('writes only when the place changed; a failed or empty lookup writes nothing', () => {
    const t = new PlaceTracker();
    let answer: PlaceLabel | null = FERRY;
    const g = geocoder(() => answer);
    t.wrote(t.next(HERE, 'precise', 0, g.lookup) as PlaceWrite);
    assert.equal(t.next(north(30), 'precise', 10 * S, g.lookup), undefined);
    answer = null;
    assert.equal(t.next(north(60), 'precise', 20 * S, g.lookup), undefined);
    answer = { name: ' ', street: null, area: null, city: null };
    assert.equal(t.next(north(90), 'precise', 30 * S, g.lookup), undefined);
    assert.deepEqual(t.held, FERRY, 'the session keeps the last place');
    assert.equal(g.calls(), 4);
  });

  test('a precision change looks up at once, however soon and however close', () => {
    const t = new PlaceTracker();
    const g = geocoder(() => FERRY);
    t.wrote(t.next(HERE, 'precise', 0, g.lookup) as PlaceWrite);
    assert.deepEqual(t.next(HERE, 'approximate', 1 * S, g.lookup), { place: sf(null, null, 'Financial District') });
    assert.equal(g.calls(), 2);
    t.wrote({ place: sf(null, null, 'Financial District') });
    assert.deepEqual(t.next(HERE, 'precise', 2 * S, g.lookup), { place: FERRY });
    assert.equal(g.calls(), 3);
  });

  test('turning Approximate on drops name and street even when the lookup finds nothing', () => {
    const t = new PlaceTracker();
    let answer: PlaceLabel | null = FERRY;
    const g = geocoder(() => answer);
    t.wrote(t.next(HERE, 'precise', 0, g.lookup) as PlaceWrite);
    answer = null;
    assert.deepEqual(t.next(HERE, 'approximate', 1 * S, g.lookup), { place: sf(null, null, 'Financial District') });
    // With nothing but a name and a street held, it clears the place.
    const bare = new PlaceTracker();
    bare.wrote({ place: { name: 'Ferry Building', street: 'The Embarcadero', area: null, city: null } });
    bare.next(HERE, 'precise', 0, () => null);
    assert.deepEqual(bare.next(HERE, 'approximate', 1 * S, () => null), { place: null });
  });

  test('an approximate share never writes a name or a street', () => {
    const t = new PlaceTracker();
    const write = t.next(HERE, 'approximate', 0, () => FERRY);
    assert.deepEqual(write, { place: sf(null, null, 'Financial District') });
  });
});

describe('along the real routes, a ping every 4 s', () => {
  /** What the fake sharer writes on a route at `speed`: each place with the route time it went out at. */
  function share(id: string, precision: 'precise' | 'approximate', speed = 1): { place: PlaceParts | null; route_t_s: number; now: number }[] {
    const route = loadRoute(id);
    const t = new PlaceTracker();
    const out: { place: PlaceParts | null; route_t_s: number; now: number }[] = [];
    for (let tick = 0; tick * 4 * speed <= route.duration_s; tick++) {
      const now = tick * 4_000;
      const p = positionAt(route, tick * 4 * speed);
      const w = t.next(p, precision, now, () => placeLabelAt(route, p.t_s));
      if (w) {
        t.wrote(w);
        out.push({ place: w.place, route_t_s: p.t_s, now });
      }
    }
    return out;
  }

  for (const id of routeIds()) {
    test(`${id}: every label shows up, in order, each write a change and at least 10 s after the last`, () => {
      const route = loadRoute(id);
      const writes = share(id, 'precise');
      assert.ok(writes.length >= 3, `${String(writes.length)} writes`);
      for (let i = 1; i < writes.length; i++) {
        const [a, b] = [writes[i - 1], writes[i]];
        assert.ok(a && b);
        assert.ok(b.now - a.now >= PLACE_LOOKUP_MIN_SECONDS * 1000);
        assert.ok(!samePlace(a.place, b.place));
      }
      for (const w of writes) {
        assert.ok(w.place);
        assert.deepEqual(validate('Place', { ...w.place, at: { seconds: 1, nanoseconds: 0 } }), []);
        assert.deepEqual(w.place, placeLabelAt(route, w.route_t_s));
      }
      // The first label, and every named place passed for 30 s or more, gets written. (A short stop,
      // standing still at a light, may not: the phone hasn't moved 25 m since its last lookup.)
      const written = new Set(writes.map((w) => JSON.stringify(w.place)));
      const labels = route.places ?? [];
      labels.forEach((label, i) => {
        const until = labels[i + 1]?.from_t_s ?? route.duration_s;
        const { from_t_s: _, ...parts } = label;
        if (i === 0 || (parts.name !== null && until - label.from_t_s >= 30)) {
          assert.ok(written.has(JSON.stringify(parts)), `${id}: ${JSON.stringify(parts)} never written`);
        }
      });
    });

    test(`${id}: approximate writes the area and the city only, and only when the area changes`, () => {
      const writes = share(id, 'approximate');
      assert.ok(writes.length >= 1);
      for (const w of writes) {
        assert.equal(w.place?.name, null);
        assert.equal(w.place?.street, null);
        assert.ok(w.place?.area);
      }
      const areas = writes.map((w) => w.place?.area);
      assert.equal(new Set(areas).size, areas.length, `areas repeat: ${areas.join(', ')}`);
    });
  }

  test('at 10x, still no more than one write per 10 s of the phone clock', () => {
    const writes = share('drive-embarcadero-south', 'precise', 10);
    for (let i = 1; i < writes.length; i++) assert.ok((writes[i]?.now ?? 0) - (writes[i - 1]?.now ?? 0) >= 10_000);
  });
});
