/**
 * The where line's words, from the session's `place` (x-decisions Q-PLACE): the sharer's phone looks
 * its own fix up with the platform's free geocoder and writes {name, street, area, city, at} on the
 * session whenever the words change. The page reads it with the session and never calls a geocoder.
 *
 *   precise       the named place ("At Ferry Building"), else the street ("Near The Embarcadero"),
 *                 else the area ("In the Financial District area"), else the city ("In the San
 *                 Francisco area")
 *   approximate   the area only (else the city): never a name or a street, even one written for a
 *                 precise fix just before the change, so the words never say more than the map
 *   ended         never: every end clears `place`, and the page stops showing it from the moment it
 *                 counts the session as over, before the clearing write reaches it
 *   none / stale  coordinates (src/format/where.ts), as the page did before any words arrived
 *
 * Stale: `place` is rewritten only when the words change, so its `at` (the recorded_at of the fix it
 * describes) can be old and still right: someone sitting at home, or walking down one long street.
 * What makes it wrong is a phone whose lookups stopped (offline geocoder, rate limits) while it keeps
 * pinging. So the words are dropped only when both hold:
 *   - the place's fix is more than PLACE_STALE_SECONDS older than the position shown, and
 *   - the sharer has since moved more than PLACE_STALE_METERS from it (1.5 km while approximate,
 *     three of its 500 m rounding cells), measured from the newest ping the page holds at or before
 *     `at`, or from the oldest it holds when the place is older than all of them.
 * Two minutes is a dozen of the phone's lookup windows (PLACE_LOOKUP_MIN_SECONDS, 10 s), and 300 m is
 * a few blocks, a dozen lookup steps (PLACE_LOOKUP_MIN_METERS, 25 m): far past any lookup that's
 * merely slow, and well before "Near Harbor Way" stops being true of someone who has left it.
 */

import type { Place as SessionPlace } from '@tml/shared/schema/generated/ts/schema';
import { distanceMeters } from '../geo/geo';
import type { Session, SessionPing } from '../session/source';
import type { Place } from './place';

export const PLACE_STALE_SECONDS = 120;
export const PLACE_STALE_METERS = { precise: 300, approximate: 1500 } as const;

/** Whether the sharer has moved on from the words: see the module comment. */
export function placeIsStale(place: SessionPlace<Date>, pings: readonly SessionPing[], approximate: boolean): boolean {
  const newest = pings[0];
  if (!newest) return true;
  const at = place.at.getTime();
  if (newest.recorded_at.getTime() - at <= PLACE_STALE_SECONDS * 1000) return false;
  const from = pings.find((p) => p.recorded_at.getTime() <= at) ?? pings.at(-1) ?? newest;
  return distanceMeters(from, newest) > PLACE_STALE_METERS[approximate ? 'approximate' : 'precise'];
}

/**
 * What the where line says for the newest ping (pings newest first). `ended` is the page's own view
 * of the end (the session stopped, or past its timer or limit), which may come before the backend's.
 */
export function placeFor(session: Session, pings: readonly SessionPing[], ended: boolean): Place | null {
  const newest = pings[0];
  if (!newest) return null;
  const coordinates: Place = { kind: 'coordinates', lat: newest.lat, lng: newest.lng };
  // Older sessions have no `place` field at all: the same as null.
  const words = ended ? null : (session.place ?? null);
  const approximate = session.precision === 'approximate';
  if (!words || placeIsStale(words, pings, approximate)) return coordinates;
  const area = words.area ?? words.city;
  if (approximate) return area ? { kind: 'area', name: area } : coordinates;
  if (words.name) return { kind: 'named', name: words.name };
  if (words.street) return { kind: 'street', name: words.street };
  return area ? { kind: 'area', name: area } : coordinates;
}
