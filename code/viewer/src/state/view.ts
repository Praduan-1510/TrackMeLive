/**
 * What the page shows, derived from the Model: one pure function, so every state's words, heading,
 * document title and map scene can be tested without a browser.
 *
 * Screens: loading (a skeleton, never a blank map), the live page (offer, not now, asked, location
 * off, can't share, both live, signal lost, call ended, the 1-hour warning), the ended page
 * (stopped vs ended), and two message pages: expired and invalid. Copy follows
 * design-system/README.md (Voice and copy; Errors, loading and empty states) and FSD §4 and §9.
 */

import {
  EXPIRY_WARNING_MINUTES,
  LIVE_STALE_MIN_SECONDS,
  LIVE_STALE_PING_INTERVALS,
  type SharerSnapshot,
} from '@tml/shared/schema/generated/ts/schema';
import { bearingDegrees, distanceMeters, type LatLng } from '../geo/geo';
import { formatDistance, type Spoken, type Units } from '../format/distance';
import { agoShort, agoSpoken, formatTime, type ClockStyle } from '../format/time';
import { sharerPhrase, whereLine, type FromViewer } from '../format/where';
import type { MapScene } from '../map/map-view';
import { mascotImage, type MascotImage } from '../mascot';
import type { Place } from '../places/lookup';
import type { Session, SessionPing } from '../session/source';
import { sessionLive, shareBackOpen, type Model, type ShareBack } from './model';

export interface ViewEnv {
  readonly units: Units;
  readonly clock: ClockStyle;
  /** Open in Maps opens Apple Maps on Apple devices, Google Maps elsewhere. */
  readonly maps: 'apple' | 'google';
  /** The page's host, for "allow location for trackme.live". */
  readonly host: string;
  /** Whether this browser can share a location at all. */
  readonly canGeolocate: boolean;
}

const SITE = 'Track Me Live';
const docTitle = (t: string): string => `${t} · ${SITE}`;

export interface LoadingView {
  readonly kind: 'loading';
  readonly title: string;
  /** Hidden; the page is aria-busy until the session and its first ping arrive. */
  readonly heading: string;
}

export interface MessageView {
  readonly kind: 'invalid' | 'expired' | 'unavailable';
  readonly title: string;
  readonly heading: string;
  readonly detail: string;
  /** Expired shows the sharer's dimmed mascot; an invalid link can't say whose it was. */
  readonly mascot: MascotImage | null;
  /** A link that can't be opened right now can be tried again. */
  readonly retry: boolean;
}

/** The share-back card under the where line, while share back is on offer and not on. */
export type Card =
  | { readonly kind: 'offer' | 'requesting' | 'unavailable' | 'unsupported'; readonly asked: boolean }
  | { readonly kind: 'quiet'; readonly asked: boolean; readonly after: 'dismissed' | 'stopped' }
  | { readonly kind: 'denied'; readonly asked: boolean; readonly host: string };

export interface PeopleView {
  readonly sharer: { readonly detail: Spoken; readonly lost: boolean };
  readonly since: string;
}

/** The facts announcements are made from (src/state/announce.ts). */
export interface Facts {
  readonly name: string;
  readonly ended: boolean;
  readonly endedByStop: boolean;
  readonly lost: boolean;
  readonly lastSeen: string;
  readonly sharing: boolean;
  readonly callActive: boolean;
  readonly asked: boolean;
  readonly shareBack: ShareBack;
  readonly mapFailed: boolean;
  readonly warning: boolean;
  readonly stopsAt: string;
  readonly reconnecting: boolean;
}

export interface PageView {
  readonly kind: 'page';
  readonly ended: boolean;
  readonly title: string;
  readonly heading: string;
  readonly name: string;
  readonly mascot: MascotImage;
  /** The bar's status line: "Live · updated 3 s ago", "Last seen 9:41 pm", "Sharing ended at 9:52 pm". */
  readonly status: Spoken & { readonly tone: 'live' | 'seen' };
  readonly onCall: boolean;
  readonly reconnecting: boolean;
  readonly badge: 'together' | 'no-signal' | 'ended' | null;
  readonly where: Spoken;
  readonly sub: { readonly text: string; readonly warning: boolean };
  /** Show Alex and Open in Maps; none once sharing ended. */
  readonly actions: { readonly showSharer: boolean; readonly mapsHref: string } | null;
  readonly card: Card | null;
  readonly people: PeopleView | null;
  /** "The map didn't load": the line under it, or null while the map is fine. */
  readonly mapFailed: string | null;
  readonly scene: MapScene;
  /** Who the map keeps in the open band. */
  readonly frame: readonly LatLng[];
  readonly facts: Facts;
}

export type View = LoadingView | MessageView | PageView;

// ---------- Facts from the session ----------

/**
 * The sharer's name, direction-isolated (U+2068 … U+2069, what <bdi> does in markup), so a
 * right-to-left name can't reorder the words around it: in the page, its title, the marker phrases
 * and the announcements alike.
 */
const isolate = (name: string): string => `\u2068${name}\u2069`;
const nameOf = (s: SharerSnapshot): string => isolate(s.name.trim() || 'Someone');

/** A person shows as live while their newest ping is under 3 ping intervals old, and at least 15 s (FSD §7). */
export function isStale(session: Session, newest: SessionPing, now: number): boolean {
  const limitS = Math.max(LIVE_STALE_PING_INTERVALS * session.ping_interval_s, LIVE_STALE_MIN_SECONDS);
  return now - newest.recorded_at.getTime() > limitS * 1000;
}

/** The session ends at the earlier of its timer and the 1-hour limit. */
export const endsAt = (s: Session): Date => (s.stop_at !== null && s.stop_at < s.expires_at ? s.stop_at : s.expires_at);

/** The 1-hour warning: the last 5 minutes of a session that runs to its limit (FSD §4). */
export function inLimitWarning(s: Session, now: number): boolean {
  const limit = s.expires_at.getTime();
  return sessionLive(s, now) && endsAt(s).getTime() === limit && now >= limit - EXPIRY_WARNING_MINUTES * 60_000;
}

const at = (p: SessionPing): LatLng => ({ lat: p.lat, lng: p.lng });

function mapsHref(maps: ViewEnv['maps'], p: SessionPing, name: string): string {
  const ll = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  return maps === 'apple'
    ? `https://maps.apple.com/?ll=${ll}&q=${encodeURIComponent(name)}`
    : `https://www.google.com/maps/search/?api=1&query=${ll}`;
}

function mapLabel(place: Place): string {
  switch (place.kind) {
    case 'area':
      return `Street map of the ${place.name} area`;
    case 'coordinates':
      return 'Street map';
    case 'street':
    case 'park':
      return `Street map around ${place.name}`;
  }
}

// ---------- Screens ----------

function loading(heading: string): LoadingView {
  return { kind: 'loading', title: docTitle('Loading'), heading };
}

function expired(sharer: SharerSnapshot): MessageView {
  return {
    kind: 'expired',
    title: docTitle('Location no longer shared'),
    heading: 'This location is no longer being shared',
    detail: `Ask ${nameOf(sharer)} to share again if you still need it.`,
    mascot: mascotImage(sharer),
    retry: false,
  };
}

const INVALID: MessageView = {
  kind: 'invalid',
  title: docTitle('This link doesn’t work'),
  heading: 'This link doesn’t work',
  detail: 'Check that you have the whole link, or ask the person who sent it to send it again.',
  mascot: null,
  retry: false,
};

const UNAVAILABLE: MessageView = {
  kind: 'unavailable',
  title: docTitle('Can’t open this link'),
  heading: 'This link can’t be opened right now',
  detail: 'Try again in a little while. If it still doesn’t open, ask the person who sent it to share again.',
  mascot: null,
  retry: true,
};

function card(m: Model, env: ViewEnv): Card | null {
  const s = m.session;
  if (!s || !shareBackOpen(m) || m.shareBack === 'sharing') return null;
  const asked = s.share_back_requested_at !== null;
  if (!env.canGeolocate) return { kind: 'unsupported', asked };
  switch (m.shareBack) {
    case 'idle':
      return { kind: 'offer', asked };
    case 'dismissed':
    case 'stopped':
      return { kind: 'quiet', asked, after: m.shareBack };
    case 'denied':
      return { kind: 'denied', asked, host: env.host };
    case 'requesting':
    case 'unavailable':
      return { kind: m.shareBack, asked };
  }
}

interface Basis {
  readonly s: Session;
  readonly newest: SessionPing;
  readonly place: Place;
  readonly name: string;
}

function page(m: Model, env: ViewEnv, b: Basis): PageView {
  const { s, newest, place, name } = b;
  const time = (d: Date): string => formatTime(d, env.clock);
  const approximate = s.precision === 'approximate';
  const ended = s.status === 'stopped';
  const lost = !ended && isStale(s, newest, m.now);
  const sharing = !ended && m.shareBack === 'sharing' && m.viewerFix !== null;
  const viewerFix = sharing ? m.viewerFix : null;
  const lastSeen = time(newest.recorded_at);
  const endedAt = time(s.ended_at ?? newest.recorded_at);
  const endedByStop = s.end_reason === 'stopped';
  const callActive = !ended && s.call_active && s.call_ended_at === null;
  const warning = !ended && inLimitWarning(s, m.now);
  const mapFailed = !ended && m.map === 'failed';
  const ageMs = m.now - newest.recorded_at.getTime();

  const fromViewer: FromViewer | null = viewerFix
    ? { meters: distanceMeters(at(viewerFix), at(newest)), bearing: bearingDegrees(at(viewerFix), at(newest)) }
    : null;

  const heading = ended
    ? endedByStop
      ? `${name} stopped sharing at ${endedAt}`
      : `Sharing ended at ${endedAt}`
    : lost
      ? `${name}’s signal dropped`
      : sharing
        ? 'You’re both live'
        : `${name} is sharing their location with you`;
  const title = ended
    ? endedByStop
      ? `${name} stopped sharing`
      : 'Sharing ended'
    : lost
      ? `${name}’s signal dropped`
      : sharing
        ? 'You’re both live'
        : `${name} is sharing their location`;

  const status: PageView['status'] = ended
    ? { text: `Sharing ended at ${endedAt}`, spoken: `Sharing ended at ${endedAt}`, tone: 'seen' }
    : lost
      ? { text: `Last seen ${lastSeen}`, spoken: `Last seen at ${lastSeen}`, tone: 'seen' }
      : { text: `Live · updated ${agoShort(ageMs)}`, spoken: `Live, updated ${agoSpoken(ageMs)}`, tone: 'live' };

  const stopsAt = time(endsAt(s));
  const subText = ended
    ? `The map shows where ${name} was when sharing stopped. It won’t move again.`
    : lost && sharing
      ? `This is where ${name} was last seen at ${lastSeen}. You’re still sharing with ${name}.`
      : lost
        ? `No update for a moment. This is where ${name} was last seen.`
        : warning
          ? `Sharing stops at ${stopsAt}.`
          : sharing
            ? `${name} can see you now. This stops by itself when your call ends.`
            : s.stop_rule === 'call' && s.call_ended_at === null
              ? 'Visible until your call ends.'
              : s.call_ended_at !== null
                ? `Your call ended. Visible until ${stopsAt}.`
                : `Visible until ${stopsAt}.`;

  const precision = approximate ? 'approximate' : 'precise';
  const people: PeopleView | null =
    sharing && m.sharingSince
      ? {
          sharer: {
            lost,
            detail: lost
              ? { text: `Last seen ${lastSeen}`, spoken: `Last seen at ${lastSeen}` }
              : { text: `Updated ${agoShort(ageMs)} · ${precision}`, spoken: `Updated ${agoSpoken(ageMs)}, ${precision}` },
          },
          since: time(m.sharingSince),
        }
      : null;

  const phrase = sharerPhrase({
    name,
    state: ended || lost ? { kind: 'last-seen', at: ended ? endedAt : lastSeen, ended } : { kind: 'live', ago: agoSpoken(ageMs) },
    approximate,
    fromViewer,
    units: env.units,
  });

  const scene: MapScene = {
    label: mapLabel(place),
    sharer: {
      at: at(newest),
      label: ended ? `Last seen ${endedAt}` : lost ? `Last seen ${lastSeen}` : name,
      phrase,
      img: mascotImage(s.sharer),
      seen: ended || lost,
      approximate,
    },
    viewer: viewerFix ? { at: at(viewerFix), phrase: 'You, sharing your location' } : null,
    // An approximate share never draws the exact trail.
    trail: approximate ? [] : m.pings.slice(1).map(at).reverse(),
    distance: fromViewer ? formatDistance(fromViewer.meters, env.units, approximate).text : null,
    dimmed: ended,
  };

  const asked = s.share_back_requested_at !== null;
  return {
    kind: 'page',
    ended,
    title: docTitle(title),
    heading,
    name,
    mascot: mascotImage(s.sharer),
    status,
    onCall: callActive,
    reconnecting: !ended && !m.online,
    badge: ended ? 'ended' : sharing ? (lost ? 'no-signal' : 'together') : null,
    where: whereLine({ place, lastSeen: ended || lost, approximate, fromViewer, units: env.units }),
    sub: { text: subText, warning: warning && !lost },
    actions: ended ? null : { showSharer: !mapFailed, mapsHref: mapsHref(env.maps, newest, s.sharer.name.trim()) },
    card: ended ? null : card(m, env),
    people,
    mapFailed: mapFailed ? (lost ? `${name} was last seen at ${lastSeen}.` : `${name} is still sharing. Where they are is written below.`) : null,
    scene,
    frame: viewerFix && m.frame === 'people' ? [at(newest), at(viewerFix)] : [at(newest)],
    facts: {
      name,
      ended,
      endedByStop,
      lost,
      lastSeen,
      sharing,
      callActive,
      asked: asked && shareBackOpen(m),
      shareBack: m.shareBack,
      mapFailed,
      warning,
      stopsAt,
      reconnecting: !ended && !m.online,
    },
  };
}

export function toView(m: Model, env: ViewEnv): View {
  switch (m.link.kind) {
    case 'pending':
      return loading('Loading the live location');
    case 'invalid':
      return INVALID;
    case 'expired':
      return expired(m.link.sharer);
    case 'unavailable':
      return UNAVAILABLE;
    case 'open':
      break;
  }
  const s = m.session;
  if (!s) return loading('Loading the live location');
  const name = nameOf(s.sharer);
  const newest = m.pings[0];
  // Ended before a single ping reached this page: there's no last location to show.
  if (s.status === 'stopped' && !newest) return expired(s.sharer);
  // A skeleton until the session, its first ping and where that is in words have all arrived.
  if (!newest || !m.place) return loading(`Loading ${name}’s location`);
  return page(m, env, { s, newest, place: m.place, name });
}
