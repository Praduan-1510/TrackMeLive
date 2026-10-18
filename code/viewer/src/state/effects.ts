/**
 * What share back needs done in the world after an event moved the page from one Model to the next:
 * follow the browser's location (or stop), write a viewer ping, or clear `viewer_sharing`. Pure, so
 * every way in and out of sharing is tested without a browser; the controller carries them out.
 *
 * Every way out of sharing clears `viewer_sharing`, best effort: Stop, the browser refusing location
 * mid-share, a refused write, the call or the session ending, the sharer going quiet. So the sharer
 * never sees "sharing back" for a viewer who no longer is.
 */

import type { SessionPing } from '../session/source';
import { shareBackActive, type Model, type ViewerEvent } from './model';

export type Effect =
  | { readonly kind: 'watch-location' }
  | { readonly kind: 'stop-watching' }
  | { readonly kind: 'write-ping'; readonly fix: SessionPing }
  | { readonly kind: 'clear-sharing' };

/** Share back writes a ping about as often as the sharer's phone does. */
export const WRITE_EVERY_MS = 4000;

/** `lastWriteAt`: when the previous viewer ping was written (epoch ms). */
export function shareBackEffects(prev: Model, next: Model, e: ViewerEvent, lastWriteAt: number): Effect[] {
  const effects: Effect[] = [];
  const was = shareBackActive(prev.shareBack);
  const is = shareBackActive(next.shareBack);
  if (is && !was) effects.push({ kind: 'watch-location' });
  if (was && !is) effects.push({ kind: 'stop-watching' });
  if (e.type === 'location' && next.shareBack === 'sharing') {
    const first = prev.shareBack === 'requesting';
    if (first || next.now - lastWriteAt >= WRITE_EVERY_MS) effects.push({ kind: 'write-ping', fix: e.fix });
  }
  if (prev.shareBack === 'sharing' && next.shareBack !== 'sharing') effects.push({ kind: 'clear-sharing' });
  return effects;
}
