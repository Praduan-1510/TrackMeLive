/**
 * Text from other people (the sharer's name, the place names their phone looked up), direction-
 * isolated: FIRST STRONG ISOLATE … POP DIRECTIONAL ISOLATE, what <bdi> does in markup, so a
 * right-to-left name can't reorder the words around it in the page, its title, the marker phrases
 * and the announcements alike (x-decisions Q-NAME-CHARACTERS).
 */

const FSI = String.fromCodePoint(0x2068);
const PDI = String.fromCodePoint(0x2069);

export const isolate = (text: string): string => `${FSI}${text}${PDI}`;
