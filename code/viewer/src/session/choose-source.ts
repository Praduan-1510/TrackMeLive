/**
 * Which source answers this page. Sample data only ever appears in a development build or on an
 * explicit review link (?state=); a real share link never shows it. A real link opens the live
 * session (src/session/live-source.ts) when the build knows its backend (src/session/firebase/config.ts),
 * and otherwise says it can't be opened right now.
 */

import type { ShareLink } from './link';
import type { SessionEvent, SessionSource } from './source';

export type SourceChoice = 'sample' | 'live' | 'invalid' | 'unavailable';

export function chooseSource(link: ShareLink, reviewing: boolean, dev: boolean, hasBackend: boolean): SourceChoice {
  // A token that can't be real is never looked up, sample or not.
  if (link.kind === 'malformed') return 'invalid';
  if (reviewing) return 'sample';
  if (link.kind === 'token') return hasBackend ? 'live' : 'unavailable';
  return dev ? 'sample' : 'invalid';
}

/** A source with one answer and nothing to listen to: an invalid link, or one that can't be opened. */
export function answerOnly(event: SessionEvent): SessionSource {
  return {
    start(onEvent) {
      queueMicrotask(() => {
        onEvent(event);
      });
      return () => undefined;
    },
    shareBack: () => Promise.reject(new Error('This page has no session to share back to.')),
    stopShareBack: () => Promise.resolve(),
  };
}
