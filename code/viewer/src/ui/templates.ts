/**
 * The page's markup, from a View. The live page is four regions (bar, gap, head, body), each with a
 * key: a region is rebuilt only when its key changes, and ticking text (recency, the where line) is
 * bound and updated in place (setBinds), so focus, images and the reading position stay put.
 *
 * Every control is 48px or taller and every size is in rem (src/styles/). Interactive elements carry
 * data-key, which focus follows across a rebuild, and data-act, the action they run.
 */

import type { MascotImage } from '../mascot';
import type { Card, MessageView, PageView } from '../state/view';
import { dual, esc } from './dom';
import { ICONS } from './icons';

export interface Region {
  readonly key: string;
  readonly html: string;
}

const img = (m: MascotImage, size: number): string =>
  `<img src="${esc(m.src)}" data-fallback="${esc(m.fallback)}" alt="" width="${String(size)}" height="${String(size)}" decoding="async">`;

const avatar = (m: MascotImage, size: number): string => `<span class="av sharer" aria-hidden="true">${img(m, size)}</span>`;

// ---------- Loading and message pages ----------

/** The skeleton (index.html paints the same before any script runs). */
export function loadingMain(heading: string): string {
  return `<main class="vp" aria-busy="true" aria-labelledby="vp-h1">
  <div class="glassbar skel" aria-hidden="true"><span class="sk av"></span><span class="sk-lines"><span class="sk w60"></span><span class="sk w40"></span></span></div>
  <div class="vp-body"><div class="vp-gap"></div>
    <div class="sheet skel"><div class="grab" aria-hidden="true"></div><span class="sk w70 tall" aria-hidden="true"></span><span class="sk w90" aria-hidden="true"></span><span class="sk w50" aria-hidden="true"></span><h1 class="sr-only" id="vp-h1" tabindex="-1">${esc(heading)}</h1></div>
  </div>
</main>`;
}

/** Expired, invalid and unopenable links: no map, no last location. They look different because they mean different things. */
export function messageMain(v: MessageView): string {
  const art = v.mascot ? img(v.mascot, 64) : v.kind === 'unavailable' ? ICONS.warn : ICONS.brokenLink;
  return `<main class="msg" aria-labelledby="msg-h1">
  <div class="ring${v.mascot ? '' : ' broken'}" aria-hidden="true">${art}</div>
  <h1 id="msg-h1" tabindex="-1">${esc(v.heading)}</h1>
  <p class="detail">${esc(v.detail)}</p>
  ${v.retry ? '<button class="btn neutral" type="button" data-act="reload" data-key="reload">Try again</button>' : ''}
</main>
<footer class="brandfoot"><img class="logo-light" src="/brand/logo-horizontal.svg" alt="Track Me Live" width="147" height="24"><img class="logo-dark" src="/brand/logo-horizontal-on-dark.svg" alt="Track Me Live" width="147" height="24"></footer>`;
}

/** The live page's frame; the regions fill it. */
export const PAGE_MAIN = `<main class="vp" aria-labelledby="vp-h1">
  <div class="glassbar" data-region="bar"></div>
  <div class="vp-body">
    <div class="vp-gap" data-region="gap"></div>
    <div class="sheet"><div class="grab" aria-hidden="true"></div><div class="head" data-region="head"></div><div class="body" data-region="body"></div></div>
  </div>
</main>`;

// ---------- The live page's regions ----------

export function bar(v: PageView): Region {
  const pills = [
    v.onCall ? '<span class="pill call"><span class="d" aria-hidden="true"></span>On your call</span>' : '',
    v.reconnecting ? '<span class="pill neutral"><span class="d" aria-hidden="true"></span>Reconnecting</span>' : '',
  ].join('');
  return {
    key: `${v.name}|${v.mascot.src}|${v.status.tone}|${String(v.onCall)}|${String(v.reconnecting)}`,
    html: `${avatar(v.mascot, 32)}
    <div class="txt"><span class="t1">${esc(v.name)}</span><span class="t2"><span class="d ${v.status.tone}" aria-hidden="true"></span>${dual(v.status.text, v.status.spoken, 'status')}</span></div>
    ${pills}`,
  };
}

export function gap(v: PageView): Region {
  if (v.mapFailed === null) return { key: '', html: '' };
  return {
    key: v.mapFailed,
    html: `<div class="map-failed"><span class="mf-ic" aria-hidden="true">${ICONS.map}</span><p class="mf-t">The map didn’t load</p><p>${esc(v.mapFailed)}</p>
      <button class="btn neutral small" type="button" data-act="retry-map" data-key="retry-map">Try again</button></div>`,
  };
}

const BADGES: Record<NonNullable<PageView['badge']>, string> = {
  together: '<span class="badge together">' + dual('LIVE TOGETHER', 'Live Together') + '</span>',
  'no-signal': '<span class="badge seen">' + dual('NO SIGNAL', 'No GPS signal') + '</span>',
  ended: '<span class="pill ended"><span class="d" aria-hidden="true"></span>Ended</span>',
};

export function head(v: PageView): Region {
  const actions = v.actions
    ? `<div class="where-btns">${
        v.actions.showSharer
          ? `<button class="btn neutral small" type="button" data-act="show-sharer" data-key="show-sharer">${ICONS.target}Show ${esc(v.name)}</button>`
          : ''
      }<a class="btn neutral small" href="${esc(v.actions.mapsHref)}" target="_blank" rel="noopener noreferrer" data-key="maps" data-bind-href="maps">${ICONS.map}Open in Maps</a></div>`
    : '';
  return {
    // The Open in Maps link follows the sharer in place (binds), so the heading isn't rebuilt on every ping.
    key: `${v.heading}|${String(v.badge)}|${v.sub.text}|${String(v.sub.warning)}|${v.actions ? String(v.actions.showSharer) : 'ended'}`,
    html: `<div class="title"><h1 id="vp-h1" tabindex="-1">${esc(v.heading)}</h1>${v.badge ? BADGES[v.badge] : ''}</div>
    <p class="where"><span class="wi" aria-hidden="true">${ICONS.pin}</span><span class="wt">${dual(v.where.text, v.where.spoken, 'where')}</span></p>
    <p class="sub${v.sub.warning ? ' warning' : ''}">${v.sub.warning ? ICONS.clock : ''}${esc(v.sub.text)}</p>
    ${actions}`,
  };
}

function askLine(v: PageView): string {
  return `<p class="ask-line" id="sb-ask">${avatar(v.mascot, 20)}${esc(v.name)} asked to see where you are</p>`;
}

const described = (asked: boolean, ids: string): string => `aria-describedby="${asked ? 'sb-ask ' : ''}${ids}"`;

function offline(v: PageView, card: Card, icon: string, title: string, detail: string, buttons: string): string {
  return `<div class="shareback off">${card.asked ? askLine(v) : ''}<div class="row"><span class="ico muted" aria-hidden="true">${icon}</span><div><p class="t1" id="sb-off">${esc(title)}</p><p class="t2" id="sb-off-d">${esc(detail)}</p></div></div>${buttons}</div>`;
}

function cardHtml(v: PageView, card: Card): string {
  const name = esc(v.name);
  const retry = `<button class="btn neutral small grow" type="button" data-act="share-back" data-key="share" ${described(card.asked, 'sb-off sb-off-d')}>Try again</button>`;
  switch (card.kind) {
    case 'offer':
    case 'requesting': {
      const waiting = card.kind === 'requesting';
      return `<div class="shareback${card.asked ? ' asked' : ''}">${card.asked ? askLine(v) : ''}
        <div class="row"><span class="ico" aria-hidden="true">${ICONS.share}</span><div><p class="t1">Let ${name} see you too</p><p class="t2" id="sb-t2">Only during this call. Nothing to install.</p></div></div>
        <div class="sb-btns">${waiting ? '' : '<button class="btn plain small" type="button" data-act="dismiss-share-back" data-key="dismiss">Not now</button>'}<button class="btn viewer small grow" type="button" data-act="share-back" data-key="share" ${described(card.asked, 'sb-t2 sb-hint')}${waiting ? ' aria-disabled="true"' : ''}>${waiting ? 'Waiting for your browser…' : 'Share my location'}</button></div></div>
        <p class="fine" id="sb-hint">Your browser will ask for permission first.</p>`;
    }
    case 'quiet':
      return `${card.asked ? `<div class="ask-solo">${askLine(v)}</div>` : ''}
        <button class="btn plain block" type="button" data-act="share-back" data-key="share" ${described(card.asked, 'sb-hint')}>${ICONS.share}Share my location with ${name}</button>
        <p class="fine" id="sb-hint">${card.after === 'stopped' ? `${name} can’t see you now. You can share again during this call.` : 'Only during this call. Your browser will ask first.'}</p>`;
    case 'denied':
      return offline(v, card, ICONS.lock, 'Location is off for this page', `To share, allow location for ${card.host} in your browser settings.`,
        `<div class="sb-btns"><button class="btn plain small" type="button" data-act="location-help" data-key="help" aria-haspopup="dialog">How to turn it on</button>${retry}</div>`);
    case 'unavailable':
      return offline(v, card, ICONS.warn, 'Your location couldn’t be shared', 'Check that location is on for this phone and that you’re online, then try again.', `<div class="sb-btns">${retry}</div>`);
    case 'unsupported':
      return offline(v, card, ICONS.warn, 'This browser can’t share your location', `Open the link in Safari or Chrome to share back. You can still see ${v.name} here.`, '');
  }
}

export function body(v: PageView): Region {
  if (v.people) {
    const p = v.people;
    return {
      key: `people|${String(p.sharer.lost)}|${p.since}`,
      html: `<div class="people">
        <div class="person">${avatar(v.mascot, 32)}<div class="txt"><span class="t1">${esc(v.name)}</span><span class="t2">${dual(p.sharer.detail.text, p.sharer.detail.spoken, 'sharer-detail')}</span></div><span class="st ${p.sharer.lost ? 'idle' : 'sharer'}"><span class="d" aria-hidden="true"></span>${p.sharer.lost ? 'Last seen' : 'Live'}</span></div>
        <div class="person"><span class="av viewer" aria-hidden="true">${ICONS.person}</span><div class="txt"><span class="t1">You</span><span class="t2">Sharing since ${esc(p.since)}</span></div><span class="st viewer"><span class="d" aria-hidden="true"></span>Live</span></div>
      </div>
      <button class="btn destructive block" type="button" data-act="stop-share-back" data-key="stop" data-guard>Stop sharing my location</button>`,
    };
  }
  if (!v.card) return { key: '', html: '' };
  return { key: `card|${JSON.stringify(v.card)}`, html: cardHtml(v, v.card) };
}

/** The text that ticks, updated in place. */
export function binds(v: PageView): Record<string, string> {
  const b: Record<string, string> = {
    status: v.status.text,
    'status-sr': v.status.spoken,
    where: v.where.text,
    'where-sr': v.where.spoken,
  };
  if (v.actions) b.maps = v.actions.mapsHref;
  if (v.people) {
    b['sharer-detail'] = v.people.sharer.detail.text;
    b['sharer-detail-sr'] = v.people.sharer.detail.spoken;
  }
  return b;
}
