/**
 * The viewer's location for the sample page: the browser's answer is scripted, so every share-back
 * state can be reviewed and tested without a real prompt (and without the reviewer's real position,
 * thousands of kilometers from the sample city). `?geo=browser` uses the real browser API instead.
 */

import type { LatLng } from '../geo/geo';
import type { LocationError, LocationProvider } from '../location/provider';
import type { SessionPing } from '../session/source';

export type SampleAnswer = 'allow' | LocationError | 'unsupported';

/** How long the "browser" takes to answer the permission prompt. */
const ANSWER_MS = 350;
const FIX_EVERY_MS = 5000;

export class SampleLocationProvider implements LocationProvider {
  readonly supported: boolean;
  private readonly answer: SampleAnswer;
  private readonly at: LatLng;

  constructor(answer: SampleAnswer, at: LatLng) {
    this.answer = answer;
    this.at = at;
    this.supported = answer !== 'unsupported';
  }

  watch(onFix: (fix: SessionPing) => void, onError: (error: LocationError) => void): () => void {
    const fix = (): void => {
      onFix({ ...this.at, accuracy_m: 12, recorded_at: new Date() });
    };
    let every = 0;
    const first = window.setTimeout(() => {
      if (this.answer === 'allow') {
        fix();
        every = window.setInterval(fix, FIX_EVERY_MS);
      } else {
        onError(this.answer === 'unsupported' ? 'unavailable' : this.answer);
      }
    }, ANSWER_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }
}
