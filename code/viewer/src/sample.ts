/**
 * Sample data for the Sprint 0 shell, shaped like what the page will read from Firestore later:
 * the session document `shareSessions/{sessionId}` and its `pings` subcollection (FSD §6), with the
 * same snake_case field names. Firestore Timestamps are shown as `Date` (what a converter returns).
 *
 * The page will trade the link token for a viewer sign-in scoped to one session, then listen to the
 * session doc and its newest pings. Nothing here is fetched; the page makes no network requests.
 */

// The types are the shared schema contract (code/shared/schema/generated/ts/schema.ts), with Firestore
// Timestamps read as Date.
import type { Ping as SchemaPing, ShareSession as SchemaShareSession } from '@tml/shared/schema/generated/ts/schema';

export type {
  EndReason,
  MascotAccessory,
  MascotColor,
  MascotId,
  Precision,
  SessionStatus,
  SharerSnapshot,
  StopRule,
} from '@tml/shared/schema/generated/ts/schema';

/** `shareSessions/{sessionId}`: only what the viewer may see. */
export type ShareSession = SchemaShareSession<Date>;
/** `shareSessions/{sessionId}/pings/{id}` */
export type Ping = SchemaPing<Date>;

export interface SampleData {
  sessionId: string;
  session: ShareSession;
  /** Newest first, as a `orderBy('recorded_at', 'desc')` listener returns them. [0] is where the sharer is now. */
  pings: Ping[];
  /**
   * Stands in for the nearest street, which the real page looks up in the viewer's browser with the
   * Maps API and never stores. It is not part of any Firestore document.
   */
  nearestStreet: string;
}

// Alex walking up Harbor Way on the sample map (6 m per map pixel), newest first. The trail keeps one
// point per 15 s; the page draws them as dots behind the marker.
const POINTS: ReadonlyArray<readonly [lat: number, lng: number]> = [
  [37.79432, -122.39468],
  [37.793267, -122.396621],
  [37.792764, -122.39755],
  [37.792261, -122.398478],
  [37.791805, -122.399322],
  [37.791303, -122.400251],
  [37.790801, -122.401179],
  [37.7903, -122.402107],
];

const MIN = 60_000;

/** Fresh sample timestamps relative to `now`, so the page reads as live whenever it's opened. */
export function createSample(now: number = Date.now()): SampleData {
  const startedAt = now - 6 * MIN;
  const lastPing = now - 2_000;
  return {
    sessionId: 'sample-session',
    session: {
      status: 'active',
      started_at: new Date(startedAt),
      expires_at: new Date(startedAt + 60 * MIN),
      stop_rule: 'call',
      stop_minutes: null,
      stop_at: null,
      ended_at: null,
      end_reason: null,
      call_id: 'sample-call',
      call_active: true,
      call_ended_at: null,
      share_back_allowed: true,
      last_ping_at: new Date(lastPing),
      ping_interval_s: 4,
      precision: 'precise',
      precision_next: null,
      sharer: {
        name: 'Alex',
        mascot_id: 'fox',
        mascot_color: 'original',
        mascot_accessory: null,
      },
      first_viewed_at: new Date(now),
      viewer_sharing: false,
      share_back_requested_at: null,
    },
    pings: POINTS.map(([lat, lng], i) => ({
      lat,
      lng,
      accuracy_m: 8,
      recorded_at: new Date(lastPing - i * 15_000),
    })),
    nearestStreet: 'Harbor Way',
  };
}
