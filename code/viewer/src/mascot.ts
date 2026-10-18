/** The session's mascot, as the page shows it: the render, and the flat SVG to fall back to. */

import type { SharerSnapshot } from '@tml/shared/schema/generated/ts/schema';

export interface MascotImage {
  readonly src: string;
  /** Shown when the render can't load; when this can't either, a plain lamplight disc. */
  readonly fallback: string;
}

export function mascotImage(sharer: SharerSnapshot): MascotImage {
  const id = sharer.mascot_id;
  // TODO(mascots): stack the accessory layer (/mascots/accessories/<id>-<accessory>.png) when
  // mascot_accessory is set, and serve the 40pt and 32pt WebP or AVIF exports instead of the PNG.
  const src = sharer.mascot_color === 'original' ? `/mascots/${id}.png` : `/mascots/colors/${id}-${sharer.mascot_color}.png`;
  return { src, fallback: `/mascots/${id}.svg` };
}
