/**
 * A map whose first load fails, for the "The map didn't load" state: Try again loads the real one.
 * Stands in for the Maps API script failing on a bad connection.
 */

import type { MapView } from '../map/map-view';

export function failingFirstLoad(map: MapView): MapView {
  let tries = 0;
  return {
    load: () => (++tries === 1 ? Promise.reject(new Error('The sample map is set to fail its first load.')) : map.load()),
    render: (scene) => {
      map.render(scene);
    },
    frame: (people, band, options) => {
      map.frame(people, band, options);
    },
    pulse: () => {
      map.pulse();
    },
  };
}
