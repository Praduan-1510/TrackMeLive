/**
 * The viewer's own location, for share back. The browser is asked only when the viewer taps Share
 * my location, never on page load (FSD §8); knowing whether it can be asked at all shows no prompt.
 */

import type { SessionPing } from '../session/source';

export type LocationError =
  /** The viewer (or the browser's settings) said no. */
  | 'denied'
  /** No position came back: location services off, no signal, or a timeout. */
  | 'unavailable';

export interface LocationProvider {
  /** Whether this browser can share a location at all (an API, on a secure page). */
  readonly supported: boolean;
  /** Asks (the browser prompts the first time) and keeps following. Returns a function that stops. */
  watch(onFix: (fix: SessionPing) => void, onError: (error: LocationError) => void): () => void;
}

/** The browser's Geolocation API. */
export class BrowserLocationProvider implements LocationProvider {
  readonly supported: boolean;
  private readonly geo: Geolocation | undefined;

  constructor(nav: Navigator, secure: boolean) {
    // Not every browser has the API (some in-app browsers drop it), and none offer it on http.
    this.geo = 'geolocation' in nav ? nav.geolocation : undefined;
    this.supported = this.geo !== undefined && secure;
  }

  watch(onFix: (fix: SessionPing) => void, onError: (error: LocationError) => void): () => void {
    const geo = this.geo;
    if (!geo || !this.supported) {
      onError('unavailable');
      return () => undefined;
    }
    const id = geo.watchPosition(
      (p) => {
        onFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: p.coords.accuracy, recorded_at: new Date(p.timestamp) });
      },
      (e) => {
        onError(e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable');
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    return () => {
      geo.clearWatch(id);
    };
  }
}
