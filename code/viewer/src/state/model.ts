/**
 * The viewer page's state machine. One immutable Model, changed only by `reduce(model, event)`:
 * facts from the SessionSource, answers from the browser (location, the map, the place name), the
 * viewer's own taps, and time (`tick`). It does no I/O; the controller (src/app/controller.ts)
 * turns the events into calls and the Model into a View (src/state/view.ts).
 *
 *   link     pending ─opened─▶ open        pending ─invalid─▶ invalid     pending ─expired─▶ expired
 *            pending ─unavailable─▶ unavailable
 *   session  ─gone─▶ stopped now (the sharer deleted their account; the page keeps what it has)
 *            active ─(its timer or the 1-hour limit passes)─▶ stopped then, on the page's own clock
 *   share back (only while open for it: see shareBackOpen)
 *            idle ─dismiss─▶ dismissed
 *            idle | dismissed | stopped | denied | unavailable ─request─▶ requesting
 *            requesting ─location─▶ sharing ─stop─▶ stopped
 *            requesting ─denied | unavailable─▶ denied | unavailable
 *            sharing ─denied─▶ denied            sharing ─write refused─▶ unavailable
 *            requesting | sharing ─(call ends, session ends, sharer offline)─▶ idle
 */

import { SHARE_BACK_FRESHNESS_SECONDS, type SharerSnapshot, type ViewerRole } from '@tml/shared/schema/generated/ts/schema';
import type { LocationError } from '../location/provider';
import type { Place } from '../places/lookup';
import type { Session, SessionEvent, SessionPing } from '../session/source';

export type ShareBack = 'idle' | 'dismissed' | 'requesting' | 'sharing' | 'stopped' | 'denied' | 'unavailable';
export type MapStatus = 'loading' | 'ready' | 'failed';

export type LinkState =
  | { readonly kind: 'pending' }
  | { readonly kind: 'open'; readonly role: ViewerRole }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'expired'; readonly sharer: SharerSnapshot }
  | { readonly kind: 'unavailable' };

export interface Model {
  /** Epoch ms, from the last `tick`. */
  readonly now: number;
  readonly link: LinkState;
  readonly session: Session | null;
  /** Newest first. Kept after the session ends, when pings can no longer be read. */
  readonly pings: readonly SessionPing[];
  /** Where the sharer's newest ping is, in words. */
  readonly place: Place | null;
  readonly online: boolean;
  readonly map: MapStatus;
  readonly shareBack: ShareBack;
  /** The viewer's own newest position, while sharing back. */
  readonly viewerFix: SessionPing | null;
  readonly sharingSince: Date | null;
  /** What the map keeps in view: everyone, or only the sharer after Show Alex. */
  readonly frame: 'people' | 'sharer';
}

export type ViewerEvent =
  | SessionEvent
  | { readonly type: 'tick'; readonly now: number }
  | { readonly type: 'place'; readonly place: Place }
  | { readonly type: 'map'; readonly status: MapStatus }
  | { readonly type: 'dismiss-share-back' }
  | { readonly type: 'request-share-back' }
  | { readonly type: 'location'; readonly fix: SessionPing }
  | { readonly type: 'location-error'; readonly error: LocationError }
  | { readonly type: 'share-back-refused' }
  | { readonly type: 'stop-share-back' }
  | { readonly type: 'show-sharer' };

export function initialModel(now: number): Model {
  return {
    now,
    link: { kind: 'pending' },
    session: null,
    pings: [],
    place: null,
    online: true,
    map: 'loading',
    shareBack: 'idle',
    viewerFix: null,
    sharingSince: null,
    frame: 'people',
  };
}

/** Live: active and before both its timer and the 1-hour limit. */
export function sessionLive(s: Session, now: number): boolean {
  return s.status === 'active' && now < s.expires_at.getTime() && (s.stop_at === null || now < s.stop_at.getTime());
}

/** The session ends at the earlier of its timer and the 1-hour limit. */
export const endsAt = (s: Session): Date => (s.stop_at !== null && s.stop_at < s.expires_at ? s.stop_at : s.expires_at);

/** The session as the stop job records it once it's due: stopped at its timer (`timer`) or its limit (`limit`). */
export function endedWhenDue(s: Session): Session {
  const end = endsAt(s);
  return { ...s, status: 'stopped', ended_at: end, end_reason: end === s.stop_at ? 'timer' : 'limit', viewer_sharing: false };
}

/**
 * A session past its timer or its 1-hour limit is over from that moment, before the scheduled stop
 * marks it: the rules refuse its pings from then on, and the stop job records `ended_at` as the time
 * it was due, `timer` or `limit` (FSD §4 Auto-expiry; x-decisions Q-READ-ENDED). The page ends it the
 * same way, on its own clock, so it never shows a live marker past the end, even when the stop job
 * runs late.
 */
function endIfDue(m: Model): Model {
  const s = m.session;
  if (!s || s.status !== 'active' || m.now < endsAt(s).getTime()) return m;
  return { ...m, session: endedWhenDue(s) };
}

/**
 * Whether this page may share back right now: the first browser (role viewer) only, during the
 * session's own call, when the sharer allows it, and while the sharer's app is checking in. The same
 * conditions as the Firestore rules for `viewer_sharing` and `viewerPings` (FSD §6).
 */
export function shareBackOpen(m: Model): boolean {
  const s = m.session;
  return (
    m.link.kind === 'open' &&
    m.link.role === 'viewer' &&
    s !== null &&
    sessionLive(s, m.now) &&
    s.share_back_allowed &&
    s.call_active &&
    s.call_ended_at === null &&
    m.now - s.last_ping_at.getTime() < SHARE_BACK_FRESHNESS_SECONDS * 1000
  );
}

/** Share back in progress: the browser is being asked, or the viewer's location is on both maps. */
export const shareBackActive = (s: ShareBack): boolean => s === 'requesting' || s === 'sharing';

const stopSharing = (m: Model, shareBack: ShareBack): Model => ({ ...m, shareBack, viewerFix: null, sharingSince: null });

function step(m: Model, e: ViewerEvent): Model {
  switch (e.type) {
    case 'tick':
      return { ...m, now: e.now };
    case 'invalid':
      return m.link.kind === 'pending' ? { ...m, link: { kind: 'invalid' } } : m;
    case 'expired':
      return m.link.kind === 'pending' ? { ...m, link: { kind: 'expired', sharer: e.sharer } } : m;
    case 'opened':
      return m.link.kind === 'pending' ? { ...m, link: { kind: 'open', role: e.role } } : m;
    case 'unavailable':
      return m.link.kind === 'pending' ? { ...m, link: { kind: 'unavailable' } } : m;
    case 'session':
      return { ...m, session: e.session };
    case 'gone':
      // Deleted before it was ever read: there's nothing to show, as a later open would find.
      if (!m.session) return { ...m, link: { kind: 'invalid' } };
      // Deleted while live: it ended now. (Already stopped: it keeps its own end and reason.)
      return m.session.status === 'stopped' ? m : { ...m, session: { ...m.session, status: 'stopped', ended_at: new Date(m.now), end_reason: null } };
    case 'pings':
      // Once the session ends its pings can't be read; the page keeps showing the last ones, and a
      // ping that reaches it later never moves the marker.
      return m.session?.status === 'stopped' ? m : { ...m, pings: e.pings };
    case 'connection':
      return { ...m, online: e.online };
    case 'place':
      return { ...m, place: e.place };
    case 'map':
      return { ...m, map: e.status };
    case 'dismiss-share-back':
      return m.shareBack === 'idle' ? { ...m, shareBack: 'dismissed' } : m;
    case 'request-share-back':
      return shareBackOpen(m) && !shareBackActive(m.shareBack) ? { ...m, shareBack: 'requesting' } : m;
    case 'location':
      if (!shareBackActive(m.shareBack)) return m;
      return {
        ...m,
        shareBack: 'sharing',
        viewerFix: e.fix,
        sharingSince: m.sharingSince ?? new Date(m.now),
        // Sharing starts: the map frames both people again, even after Show Alex.
        frame: m.shareBack === 'requesting' ? 'people' : m.frame,
      };
    case 'location-error':
      // While sharing, a phone that stands still can time out between fixes: keep the last one.
      // A refusal always stops it.
      if (m.shareBack === 'requesting' || (m.shareBack === 'sharing' && e.error === 'denied')) return stopSharing(m, e.error);
      return m;
    case 'share-back-refused':
      return shareBackActive(m.shareBack) ? stopSharing(m, 'unavailable') : m;
    case 'stop-share-back':
      return shareBackActive(m.shareBack) ? stopSharing(m, 'stopped') : m;
    case 'show-sharer':
      return { ...m, frame: 'sharer' };
  }
}

export function reduce(m: Model, e: ViewerEvent): Model {
  const next = endIfDue(step(m, e));
  // Share back never outlives what allows it: the call, the session, the sharer's check-ins.
  return shareBackActive(next.shareBack) && !shareBackOpen(next) ? stopSharing(next, 'idle') : next;
}
