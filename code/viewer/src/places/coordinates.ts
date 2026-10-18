/**
 * The lookup for a page with no Maps key (the emulators, a build without one): it always says where
 * in coordinates ("Near 37.7943° N, 122.3947° W", or "Approximate location" while approximate), and
 * never makes a request.
 */

import type { PlaceLookup } from './lookup';

export const coordinatesOnly: PlaceLookup = {
  describe: (at) => Promise.resolve({ kind: 'coordinates', lat: at.lat, lng: at.lng }),
};
