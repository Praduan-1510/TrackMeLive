/**
 * "Where Alex is", the way the apps do it (x-decisions Q-PLACE): the phone reverse-geocodes its own
 * fix and writes the result on the session as place {name, street, area, city, at}, in the same batch
 * as a ping, and only when the place changed. The fake sharer's "geocoder" is the route's labels
 * (code/qa/routes, `places`); everything around it follows the contract the apps follow:
 *
 *   - a lookup at most once per PLACE_LOOKUP_MIN_SECONDS (10), and only once the fix is at least
 *     PLACE_LOOKUP_MIN_METERS (25) from the one last looked up; a precision change looks up at once;
 *   - each part trimmed, stripped of control characters and bidi controls, cut at a character
 *     boundary to PLACE_PART_MAX_LENGTH (80) UTF-16 code units, and null when nothing is left;
 *   - while Approximate, name and street are null (the apps look up the rounded point; the fake's
 *     labels are per stretch of route, so it drops them instead);
 *   - a failed or empty lookup writes nothing, and so does one that finds what the session holds;
 *   - switching to Approximate drops name and street from what the session holds in the same write,
 *     even when the lookup finds nothing, because the rules refuse the switch otherwise.
 *
 * No Firebase here: sharer.ts writes what this decides, so it's unit-tested without an emulator.
 */

import { PLACE_LOOKUP_MIN_METERS, PLACE_LOOKUP_MIN_SECONDS, PLACE_PART_MAX_LENGTH, type Precision } from '../../../shared/schema/generated/ts/schema.ts';
import { PLACE_PARTS, distanceMeters, type PlaceLabel } from '../../routes/route.ts';

/** The parts of the session's place, as written (the batch adds at). */
export type PlaceParts = PlaceLabel;

const cp = (n: number): string => String.fromCodePoint(n);
// Control characters (Cc), and the bidi overrides and isolates the rules refuse.
const CONTROLS = new RegExp(`[\\p{Cc}${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}]`, 'gu');

/** One part as the apps clean it: stripped, trimmed, cut to 80 UTF-16 code units at a character boundary; null when empty. */
export function cleanPart(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  let s = raw.replace(CONTROLS, '').trim();
  if (s.length > PLACE_PART_MAX_LENGTH) {
    s = s.slice(0, PLACE_PART_MAX_LENGTH);
    // Never leave half of a surrogate pair at the cut.
    const last = s.charCodeAt(s.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1);
    s = s.trim();
  }
  return s === '' ? null : s;
}

/** What a lookup result may say at this precision, cleaned; null when nothing is left to say. */
export function placeFor(found: PlaceLabel | null, precision: Precision): PlaceParts | null {
  if (!found) return null;
  const parts: PlaceParts = {
    name: precision === 'approximate' ? null : cleanPart(found.name),
    street: precision === 'approximate' ? null : cleanPart(found.street),
    area: cleanPart(found.area),
    city: cleanPart(found.city),
  };
  return PLACE_PARTS.some((k) => parts[k] !== null) ? parts : null;
}

export const samePlace = (a: PlaceParts | null, b: PlaceParts | null): boolean =>
  a === b || (a !== null && b !== null && PLACE_PARTS.every((k) => a[k] === b[k]));

export interface PlaceFix {
  readonly lat: number;
  readonly lng: number;
}

/** A place write for the next batch: the parts to write, or null to clear the session's place. */
export interface PlaceWrite {
  readonly place: PlaceParts | null;
}

/**
 * Decides, fix by fix, when to look up and what to write. Call next() for each ping, put what it
 * returns in that ping's batch, and call wrote() once the batch has landed.
 */
export class PlaceTracker {
  private lookedUpAt: number | null = null;
  private lookedUpFix: PlaceFix | null = null;
  private precision: Precision | null = null;
  /** What the session holds, as this phone last wrote it (null: nothing yet, or cleared). */
  held: PlaceParts | null = null;

  /**
   * What to write with the ping at `fix`, taken at `now` (epoch ms) at `precision`, or undefined for
   * nothing. `lookup` is the geocoder, called only when the cadence allows a lookup.
   */
  next(fix: PlaceFix, precision: Precision, now: number, lookup: () => PlaceLabel | null): PlaceWrite | undefined {
    const switched = this.precision !== null && this.precision !== precision;
    const due =
      this.lookedUpAt === null
      || this.lookedUpFix === null
      || switched
      || (now - this.lookedUpAt >= PLACE_LOOKUP_MIN_SECONDS * 1000 && distanceMeters(fix, this.lookedUpFix) >= PLACE_LOOKUP_MIN_METERS);
    if (!due) return undefined;
    this.lookedUpAt = now;
    this.lookedUpFix = { lat: fix.lat, lng: fix.lng };
    this.precision = precision;

    const found = placeFor(lookup(), precision);
    if (found !== null) return samePlace(found, this.held) ? undefined : { place: found };
    // Nothing found. Turning Approximate on must still drop a name or street the session holds.
    if (precision === 'approximate' && this.held !== null && (this.held.name !== null || this.held.street !== null)) {
      return { place: placeFor(this.held, 'approximate') };
    }
    return undefined;
  }

  /** The batch carrying `write` landed: the session now holds it. */
  wrote(write: PlaceWrite): void {
    this.held = write.place;
  }
}
