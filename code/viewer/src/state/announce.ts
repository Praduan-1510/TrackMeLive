/**
 * What a screen reader hears when the page changes on its own (design-system/README.md,
 * Accessibility → Announcements). One polite status region gets only changes, never ticking times
 * or each ping; the ended heading is said once, as an alert ("Alex stopped sharing" after Stop,
 * otherwise "Sharing ended"). Pure: the previous and the next View in, the words out.
 */

import type { View } from './view';

export interface Announcement {
  readonly polite: string | null;
  readonly alert: string | null;
}

const NONE: Announcement = { polite: null, alert: null };

export function announce(prev: View | null, next: View): Announcement {
  if (next.kind !== 'page') return NONE;
  const f = next.facts;
  // The page has just loaded: say what it shows, once, and anything already wrong or waiting.
  if (prev?.kind !== 'page') {
    if (f.ended) return NONE;
    const first = [`${next.heading}. ${next.where.spoken}.`];
    if (f.asked) first.push(`${f.name} asked to see where you are.`);
    if (f.warning) first.push(`Sharing stops at ${f.stopsAt}.`);
    if (f.mapFailed) first.push('The map didn’t load.');
    if (f.reconnecting) first.push('Reconnecting.');
    return { polite: first.join(' '), alert: null };
  }

  const p = prev.facts;
  if (f.ended) return p.ended ? NONE : { polite: null, alert: f.endedByStop ? `${f.name} stopped sharing.` : 'Sharing ended.' };

  const say: string[] = [];
  if (f.sharing && !p.sharing) say.push('You’re both live.');
  if (!f.sharing && p.sharing) {
    say.push(f.callActive ? 'You stopped sharing your location.' : 'Your call ended, so your location is no longer shared.');
  } else if (!f.callActive && p.callActive) {
    say.push('Your call ended.');
  }
  if (f.lost && !p.lost) say.push(`${f.name}’s signal dropped. Last seen ${f.lastSeen}.`);
  if (!f.lost && p.lost) say.push(`${f.name} is live again.`);
  if (f.asked && !p.asked) say.push(`${f.name} asked to see where you are.`);
  if (f.shareBack === 'denied' && p.shareBack !== 'denied') say.push('Location is off for this page.');
  if (f.shareBack === 'unavailable' && p.shareBack !== 'unavailable') say.push('Your location couldn’t be shared.');
  if (f.mapFailed && !p.mapFailed) say.push('The map didn’t load.');
  if (f.warning && !p.warning) say.push(`Sharing stops at ${f.stopsAt}.`);
  if (f.reconnecting && !p.reconnecting) say.push('Reconnecting.');
  if (!f.reconnecting && p.reconnecting) say.push('Connected again.');
  return { polite: say.length > 0 ? say.join(' ') : null, alert: null };
}
