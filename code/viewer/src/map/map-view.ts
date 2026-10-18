/**
 * The map behind the page, as the rest of the page sees it. Everything is in latitude and longitude
 * and viewport pixels, so the UI never knows which map draws it: Sprint 1 draws the stylized sample
 * city in SVG (src/map/svg/), and the Google Maps JS implementation slots in behind this interface.
 *
 * The map owns its markers' look (src/map/markers.ts), the trail (sized by age), the dashed
 * connector line with the distance chip, and framing people inside the open band the page leaves.
 */

import type { LatLng } from '../geo/geo';
import type { MascotImage } from '../mascot';

export interface SharerMarkerSpec {
  readonly at: LatLng;
  /** The capsule under the marker: the name, or "Last seen 9:41 pm". */
  readonly label: string;
  /** The marker's one phrase for screen readers. */
  readonly phrase: string;
  readonly img: MascotImage;
  /** Last seen (stale, or sharing ended): a dashed ring, no halo, the mascot dimmed, still. */
  readonly seen: boolean;
  /** A soft circle 1 km across around the rounded point instead of the halo, and no trail. */
  readonly approximate: boolean;
}

export interface ViewerMarkerSpec {
  readonly at: LatLng;
  readonly phrase: string;
}

export interface MapScene {
  /** The map's own label: "Street map around Harbor Way". */
  readonly label: string;
  readonly sharer: SharerMarkerSpec | null;
  /** The viewer's own marker ("You"), while sharing back. */
  readonly viewer: ViewerMarkerSpec | null;
  /** Earlier positions, oldest first, without where the sharer is now. */
  readonly trail: readonly LatLng[];
  /** The distance chip on the connector line ("1.2 km"), when both people are on the map. */
  readonly distance: string | null;
  /** Sharing ended: the map stays, quieter. */
  readonly dimmed: boolean;
}

/** A rectangle in viewport CSS pixels. */
export interface Band {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface FrameOptions {
  readonly animate: boolean;
  /** 'center' re-frames now; 'contain' moves only if someone has left the band (or won't fit). */
  readonly mode: 'center' | 'contain';
}

export interface MapView {
  /** Resolves once the map can draw; rejects when it can't (the page then says so and offers Try again). */
  load(): Promise<void>;
  render(scene: MapScene): void;
  /** Keeps these people inside the band, panning, and zooming out only if they don't fit. */
  frame(people: readonly LatLng[], band: Band, options: FrameOptions): void;
  /** Show Alex: one short pulse on the sharer's marker. */
  pulse(): void;
}
