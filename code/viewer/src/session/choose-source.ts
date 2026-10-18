/**
 * Which source answers this page. Sample data only ever appears in a development build or on an
 * explicit review link (?state=); a real share link never shows it. Until the Firestore source lands
 * (Sprint 2), a real link says it can't be opened right now.
 */

import type { ShareLink } from './link';
import type { SessionEvent, SessionSource } from './source';

export type SourceChoice = 'sample' | 'invalid' | 'unavailable';

export function chooseSource(link: ShareLink, reviewing: boolean, dev: boolean): SourceChoice {
  // A token that can't be real is never looked up, sample or not.
  if (link.kind === 'malformed') return 'invalid';
  if (reviewing) return 'sample';
  // TODO(sprint-2): a FirestoreSessionSource that trades the token with redeemLinkToken.
  if (link.kind === 'token') return 'unavailable';
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
