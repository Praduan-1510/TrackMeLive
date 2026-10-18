/**
 * The real SessionSource: a share link's token traded with redeemLinkToken for a sign-in scoped to
 * that one session, then the session document and its newest pings, live (FSD §5, §6 Viewer access).
 *
 *   redeem   ─ok─▶ opened {role}, then the session and its pings as they change
 *            ─not-found | invalid-argument─▶ invalid
 *            ─failed-precondition {reason: session_ended, sharer}─▶ expired {sharer}
 *            ─resource-exhausted (too many browsers) | anything else refused─▶ unavailable
 *            ─unreachable─▶ asked again after 1, 2, 4 and 8 s, then unavailable
 *   session  document gone (from the backend, not the cache) ─▶ gone; read refused for good ─▶ gone
 *   pings    refused once the session is over (the rules allow them only while it's live): the page
 *            keeps the last ones. Refused within the allowed clock skew of the session's end, while
 *            the document still says active, it's the server's clock that passed the end: the
 *            session ends then, as the stop job will record it, never "signal dropped"
 *            (x-decisions Q-READ-ENDED). Any other failure listens again, with backoff
 *   online   the browser's own online state, and whether the session's snapshots come from the
 *            backend or only from the local cache ─▶ connection
 *
 * The Firebase SDK lives behind ViewerBackend and loads only when start() runs, so the review page
 * and the sample never download it.
 */

import { isTransient, BackendError, type Connectivity, type ViewerBackend } from './backend';
import { decodePing, decodeSession, decodeSharer } from './decode';
import type { Session, SessionEvent, SessionPing, SessionSource } from './source';
import { endedWhenDue, endsAt, sessionLive } from '../state/model';
import { PING_CLOCK_SKEW_SECONDS, type ViewerRole } from '@tml/shared/schema/generated/ts/schema';

/** How long to wait before asking redeemLinkToken again; after the last, the link "can't be opened right now". */
export const REDEEM_RETRY_MS = [1000, 2000, 4000, 8000] as const;
/** Listening again after a listener failed; the last wait repeats while the session is live. */
export const LISTEN_RETRY_MS = [2000, 5000, 15_000] as const;
/** How many pings the page keeps: the newest is where the sharer is, the rest are the trail. */
export const PING_LIMIT = 40;

export interface LiveSourceOptions {
  readonly token: string;
  /** Loads the backend (the Firebase SDK) on first use. */
  readonly backend: () => Promise<ViewerBackend>;
  readonly connectivity: Connectivity;
  /** Epoch ms; the session's end is judged on this clock. */
  readonly now?: () => number;
}

type Answer = SessionEvent | 'retry';

/** What a failed redeem means for the page. */
function answerFor(err: unknown): Answer {
  // The SDK chunk didn't load, or something failed before reaching the backend: try again.
  if (!(err instanceof BackendError)) return 'retry';
  switch (err.code) {
    case 'not-found':
    case 'invalid-argument':
      return { type: 'invalid' };
    case 'failed-precondition': {
      const d: unknown = err.details;
      const reason = typeof d === 'object' && d !== null && 'reason' in d ? d.reason : null;
      const sharer = typeof d === 'object' && d !== null && 'sharer' in d ? decodeSharer(d.sharer) : null;
      return reason === 'session_ended' && sharer ? { type: 'expired', sharer } : { type: 'unavailable' };
    }
    case 'resource-exhausted':
    case 'permission-denied':
    case 'unauthenticated':
      return { type: 'unavailable' };
    case 'unavailable':
    case 'deadline-exceeded':
    case 'other':
      return 'retry';
  }
}

export class LiveSessionSource implements SessionSource {
  private readonly o: LiveSourceOptions;
  private readonly now: () => number;
  private emit: (e: SessionEvent) => void = () => undefined;
  private stopped = false;
  private backend: ViewerBackend | null = null;
  private sessionId: string | null = null;
  private role: ViewerRole | null = null;
  private session: Session | null = null;
  private stopSession: (() => void) | null = null;
  private stopPings: (() => void) | null = null;
  private stopConnectivity: (() => void) | null = null;
  private sessionFromCache = false;
  private online = true;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private sessionFailures = 0;
  private pingFailures = 0;
  /** The server refused the pings at the session's end before its document said so. */
  private endedByServer = false;

  constructor(options: LiveSourceOptions) {
    this.o = options;
    this.now = options.now ?? Date.now;
  }

  start(onEvent: (event: SessionEvent) => void): () => void {
    this.emit = onEvent;
    void this.open();
    return () => {
      this.stop();
    };
  }

  async shareBack(ping: SessionPing): Promise<void> {
    const { backend, sessionId } = this;
    if (!backend || !sessionId || this.role !== 'viewer') throw new Error('Only the session’s viewer can share back.');
    // The first ping (and the first after a stop) turns viewer_sharing on in the same batch.
    await backend.writeViewerPing(sessionId, ping, !this.session?.viewer_sharing);
  }

  async stopShareBack(): Promise<void> {
    const { backend, sessionId } = this;
    if (!backend || !sessionId || this.role !== 'viewer' || !this.session?.viewer_sharing) return;
    await backend.stopViewerSharing(sessionId);
  }

  // ---------- Opening the link ----------

  /** Read after every await: the page may have stopped listening meanwhile. */
  private isStopped(): boolean {
    return this.stopped;
  }

  private async open(): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        this.backend ??= await this.o.backend();
        if (this.isStopped()) return;
        const redeemed = await this.backend.redeem(this.o.token);
        if (this.isStopped()) return;
        this.opened(redeemed.sessionId, redeemed.role);
        return;
      } catch (err) {
        if (this.isStopped()) return;
        const answer = answerFor(err);
        const wait = REDEEM_RETRY_MS[attempt];
        if (answer !== 'retry' || wait === undefined) {
          if (answer === 'retry') console.warn('Track Me Live: the link couldn’t be opened', err);
          this.emit(answer === 'retry' ? { type: 'unavailable' } : answer);
          return;
        }
        await this.sleep(wait);
        if (this.isStopped()) return;
      }
    }
  }

  private opened(sessionId: string, role: ViewerRole): void {
    this.sessionId = sessionId;
    this.role = role;
    this.emit({ type: 'opened', role });
    this.stopConnectivity = this.o.connectivity.onChange(() => {
      this.syncConnection();
    });
    this.syncConnection();
    this.listenSession();
    this.listenPings();
  }

  // ---------- Listening ----------

  private live(): boolean {
    return this.session === null || sessionLive(this.session, this.now());
  }

  private listenSession(): void {
    const { backend, sessionId } = this;
    if (!backend || !sessionId || this.stopped) return;
    this.stopSession = backend.watchSession(sessionId, {
      next: (data, fromCache) => {
        this.sessionFailures = 0;
        this.sessionFromCache = fromCache;
        this.syncConnection();
        if (data === null) {
          // Offline, the cache can't say whether it exists; only the backend can say it's gone.
          if (!fromCache) this.gone();
          return;
        }
        const decoded = decodeSession(data);
        if (!decoded) {
          console.warn('Track Me Live: a session snapshot doesn’t match the schema; keeping the last one');
          return;
        }
        // Once the server has refused its pings at the end, a snapshot that still says active is behind.
        const session = this.endedByServer && decoded.status === 'active' ? endedWhenDue(decoded) : decoded;
        this.session = session;
        this.emit({ type: 'session', session });
        // Its pings can't be read any more (the rules allow them only while live): stop asking.
        if (!sessionLive(session, this.now())) this.endPings();
      },
      error: (err) => {
        this.stopSession = null;
        this.sessionFailures += 1;
        const wait = LISTEN_RETRY_MS[Math.min(this.sessionFailures, LISTEN_RETRY_MS.length) - 1] ?? 0;
        // Refused for good (the sign-in no longer reads it): the page can't follow it any more.
        if (!isTransient(err.code) && this.sessionFailures > LISTEN_RETRY_MS.length) {
          this.gone();
          return;
        }
        this.after(wait, () => {
          this.listenSession();
        });
      },
    });
  }

  private listenPings(): void {
    const { backend, sessionId } = this;
    if (!backend || !sessionId || this.stopped || !this.live()) return;
    this.stopPings = backend.watchPings(sessionId, PING_LIMIT, {
      next: (docs, fromCache) => {
        this.pingFailures = 0;
        const pings = docs.map(decodePing).filter((p): p is SessionPing => p !== null);
        // Offline before the first answer, the cache has nothing to say yet.
        if (fromCache && pings.length === 0) return;
        this.emit({ type: 'pings', pings });
      },
      error: (err) => {
        this.stopPings = null;
        if (err.code === 'permission-denied' && this.endAtRefusal()) return;
        this.pingFailures += 1;
        // Refused: the session is over (it says how it ended), or the sign-in was a moment behind.
        // Ask again a few times while it's live on this clock, then leave it to the session.
        if (!isTransient(err.code) && this.pingFailures > LISTEN_RETRY_MS.length) return;
        const wait = LISTEN_RETRY_MS[Math.min(this.pingFailures, LISTEN_RETRY_MS.length) - 1] ?? 0;
        this.after(wait, () => {
          this.listenPings();
        });
      },
    });
  }

  /**
   * Pings refused while the document still says active: when the session's end is within the clock
   * skew the backend allows, the server's clock has passed it. The session ends at its due time, as
   * the stop job will record it. Returns whether it did.
   */
  private endAtRefusal(): boolean {
    const s = this.session;
    if (!s || s.status !== 'active' || endsAt(s).getTime() - this.now() > PING_CLOCK_SKEW_SECONDS * 1000) return false;
    this.endedByServer = true;
    this.session = endedWhenDue(s);
    this.emit({ type: 'session', session: this.session });
    return true;
  }

  private endPings(): void {
    this.stopPings?.();
    this.stopPings = null;
  }

  private gone(): void {
    this.endPings();
    this.stopSession?.();
    this.stopSession = null;
    this.emit({ type: 'gone' });
  }

  private syncConnection(): void {
    const online = this.o.connectivity.online && !this.sessionFromCache;
    if (online === this.online) return;
    this.online = online;
    this.emit({ type: 'connection', online });
  }

  // ---------- Time ----------

  private after(ms: number, run: () => void): void {
    if (this.stopped) return;
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.stopped) run();
    }, ms);
    this.timers.add(t);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        resolve();
      }, ms);
      this.timers.add(t);
    });
  }

  private stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.endPings();
    this.stopSession?.();
    this.stopSession = null;
    this.stopConnectivity?.();
    this.stopConnectivity = null;
    this.emit = () => undefined;
  }
}
