/**
 * "Where Alex is, in words" (FSD §4): the page's text alternative to the map, read before it.
 *
 *   Near Harbor Way
 *   Near Harbor Way · 1.2 km north-east of you          (once the viewer shares back)
 *   In the Market area · about 1 km from you            (approximate: no direction)
 *   Last seen near Harbor Way · about 1.2 km north-east of you
 *
 * Also the one phrase each marker reads as ("Alex, live, 1.2 kilometers away, updated 2 seconds ago").
 */

import { compass } from '../geo/geo';
import type { Place } from '../places/lookup';
import { formatDistance, type Spoken, type Units } from './distance';

export interface FromViewer {
  readonly meters: number;
  /** From the viewer to the sharer, degrees clockwise from north. */
  readonly bearing: number;
}

export interface WhereInput {
  readonly place: Place;
  readonly lastSeen: boolean;
  readonly approximate: boolean;
  /** Null until the viewer shares back: before that there's no "from you". */
  readonly fromViewer: FromViewer | null;
  readonly units: Units;
}

type Hemisphere = readonly [letter: string, word: string];

/** "37.7943° N", spoken "37.7943 degrees north": 4 decimals, about 11 m. */
const degrees = (v: number, positive: Hemisphere, negative: Hemisphere): Spoken => {
  const n = Math.abs(v).toFixed(4);
  const [letter, word] = v >= 0 ? positive : negative;
  return { text: `${n}° ${letter}`, spoken: `${n} degrees ${word}` };
};

function placePhrase(place: Place, lastSeen: boolean, approximate: boolean): Spoken {
  const near = lastSeen ? 'Last seen near' : 'Near';
  const inside = lastSeen ? 'Last seen in' : 'In';
  const same = (s: string): Spoken => ({ text: s, spoken: s });
  switch (place.kind) {
    case 'street':
      return same(`${near} ${place.name}`);
    case 'park':
      return same(`${inside} ${place.name}`);
    case 'area':
      return same(`${inside} the ${place.name} area`);
    case 'coordinates': {
      // Approximate gives the area only (FSD §4): never numbers finer than the rounding implies.
      if (approximate) return same(lastSeen ? 'Last seen at an approximate location' : 'Approximate location');
      const lat = degrees(place.lat, ['N', 'north'], ['S', 'south']);
      const lng = degrees(place.lng, ['E', 'east'], ['W', 'west']);
      return { text: `${near} ${lat.text}, ${lng.text}`, spoken: `${near} ${lat.spoken}, ${lng.spoken}` };
    }
  }
}

/** How far, in the right words: "about" while last seen (the sharer may have moved since). */
function howFar(meters: number, units: Units, approximate: boolean, lastSeen: boolean): Spoken {
  const d = formatDistance(meters, units, approximate);
  const about = lastSeen && !approximate ? 'about ' : '';
  return { text: about + d.text, spoken: about + d.spoken };
}

export function whereLine(i: WhereInput): Spoken {
  const head = placePhrase(i.place, i.lastSeen, i.approximate);
  if (!i.fromViewer) return head;
  const d = howFar(i.fromViewer.meters, i.units, i.approximate, i.lastSeen);
  if (i.approximate) return { text: `${head.text} · ${d.text} from you`, spoken: `${head.spoken}, ${d.spoken} from you` };
  const dir = compass(i.fromViewer.bearing);
  return { text: `${head.text} · ${d.text} ${dir} of you`, spoken: `${head.spoken}, ${d.spoken} ${dir} of you` };
}

export interface SharerPhraseInput {
  readonly name: string;
  /** "live", or the last-seen time when the newest ping is stale or sharing ended. */
  readonly state: { readonly kind: 'live'; readonly ago: string } | { readonly kind: 'last-seen'; readonly at: string; readonly ended: boolean };
  readonly approximate: boolean;
  readonly fromViewer: FromViewer | null;
  readonly units: Units;
}

/** The sharer marker's one phrase: "Alex, live, 1.2 kilometers away, updated 2 seconds ago". */
export function sharerPhrase(i: SharerPhraseInput): string {
  const lastSeen = i.state.kind === 'last-seen';
  const away = i.fromViewer ? `${howFar(i.fromViewer.meters, i.units, i.approximate, lastSeen).spoken} away` : null;
  const parts =
    i.state.kind === 'live'
      ? [i.name, 'live', i.approximate ? 'approximate location' : null, away, `updated ${i.state.ago}`]
      : [i.name, `last seen at ${i.state.at}`, i.state.ended ? 'when sharing stopped' : null, i.approximate ? 'approximate location' : null, away];
  return parts.filter((p): p is string => p !== null).join(', ');
}
