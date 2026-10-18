/**
 * A stand-in for the Maps JavaScript API, served in place of maps.googleapis.com, so the live tests
 * check the page's real Geocoder path without a key or the network. Its Geocoder names a street by
 * latitude: The Embarcadero south of 37.796, Pier Walk north of it, in the Embarcadero neighborhood.
 */

import type { BrowserContext } from 'playwright-core';

const SCRIPT = `(() => {
  const callback = new URL(document.currentScript.src).searchParams.get('callback');
  class Geocoder {
    async geocode({ location }) {
      window.__tmlGeocodes = (window.__tmlGeocodes || 0) + 1;
      const street = location.lat >= 37.796 ? 'Pier Walk' : 'The Embarcadero';
      return { results: [{ types: ['street_address'], address_components: [
        { long_name: street, types: ['route'] },
        { long_name: 'Embarcadero', types: ['neighborhood', 'political'] },
        { long_name: 'San Francisco', types: ['locality', 'political'] },
      ] }] };
    }
  }
  window.google = { maps: { importLibrary: async () => ({ Geocoder }) } };
  window[callback]();
})();`;

/** Serves the stand-in for every Maps API request in this context. */
export async function stubMaps(context: BrowserContext): Promise<void> {
  await context.route('https://maps.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: SCRIPT }));
}

/** The Maps API can't be reached at all. */
export async function blockMaps(context: BrowserContext): Promise<void> {
  await context.route('https://maps.googleapis.com/**', (route) => route.abort('internetdisconnected'));
}
