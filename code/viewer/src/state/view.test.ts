import { describe, expect, it } from 'vitest';
import { ENV, live, ping, plain, session, sharing, T0 } from '../test-fixtures';
import { endsAt, initialModel, reduce, type Model } from './model';
import { inLimitWarning, isStale, toView, type PageView, type View } from './view';

const MIN = 60_000;

function page(m: Model, env = ENV): PageView {
  const v = toView(m, env);
  if (v.kind !== 'page') throw new Error(`expected the live page, got ${v.kind}`);
  return v;
}
const words = (v: View): { title: string; heading: string } => ({ title: plain(v.title), heading: plain(v.heading) });

describe('loading', () => {
  it('shows a skeleton until the session, its first ping and the place have all arrived', () => {
    expect(words(toView(initialModel(T0), ENV))).toEqual({ title: 'Loading · Track Me Live', heading: 'Loading the live location' });
    expect(words(toView(live({ pings: [] }), ENV)).heading).toBe('Loading Alex’s location');
    expect(toView(live({ place: null }), ENV).kind).toBe('loading');
    expect(toView(live(), ENV).kind).toBe('page');
  });
});

describe('message pages', () => {
  it('shows an invalid link without a name or a mascot', () => {
    const v = toView({ ...initialModel(T0), link: { kind: 'invalid' } }, ENV);
    expect(v).toMatchObject({ kind: 'invalid', heading: 'This link doesn’t work', mascot: null });
    expect(v.title).toBe('This link doesn’t work · Track Me Live');
  });
  it('shows an expired link with the sharer’s name and mascot', () => {
    const v = toView({ ...initialModel(T0), link: { kind: 'expired', sharer: session().sharer } }, ENV);
    expect(v.kind).toBe('expired');
    if (v.kind !== 'expired') return;
    expect(v.heading).toBe('This location is no longer being shared');
    expect(plain(v.detail)).toBe('Ask Alex to share again if you still need it.');
    expect(v.mascot?.src).toBe('/mascots/fox.png');
    expect(v.title).toBe('Location no longer shared · Track Me Live');
  });
  it('shows a link that can’t be opened right now, with Try again', () => {
    expect(toView({ ...initialModel(T0), link: { kind: 'unavailable' } }, ENV)).toMatchObject({
      kind: 'unavailable',
      title: 'Can’t open this link · Track Me Live',
      heading: 'This link can’t be opened right now',
      mascot: null,
      retry: true,
    });
  });
  it('treats a session that ended before any ping reached the page as expired', () => {
    expect(toView(live({ pings: [] }, { status: 'stopped', ended_at: new Date(T0) }), ENV).kind).toBe('expired');
  });
});

describe('live', () => {
  it('says who is sharing, where in words, and until when', () => {
    const v = page(live());
    expect(words(v)).toEqual({ title: 'Alex is sharing their location · Track Me Live', heading: 'Alex is sharing their location with you' });
    expect(v.where.text).toBe('Near Harbor Way');
    expect(v.sub.text).toBe('Visible until your call ends.');
    expect(v.status).toEqual({ text: 'Live · updated 2 s ago', spoken: 'Live, updated 2 seconds ago', tone: 'live' });
    expect(v.onCall).toBe(true);
    expect(v.badge).toBeNull();
    expect(v.actions?.showSharer).toBe(true);
    expect(v.actions?.mapsHref).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=37\.79432,-122\.39468$/);
  });
  it('opens Apple Maps on Apple devices, with the name and no direction marks', () => {
    expect(page(live(), { ...ENV, maps: 'apple' }).actions?.mapsHref).toBe('https://maps.apple.com/?ll=37.79432,-122.39468&q=Alex');
  });
  it('isolates the sharer’s name, so a right-to-left name can’t reorder the words around it', () => {
    expect(page(live()).heading).toBe('\u2068Alex\u2069 is sharing their location with you');
  });
  it('writes the sharer’s end time for a timer, or after the call ended', () => {
    const timer = { stop_rule: 'minutes' as const, stop_minutes: 30 as const, stop_at: new Date(T0 + 20 * MIN) };
    expect(page(live({}, timer)).sub.text).toBe('Visible until 10:01 pm.');
    expect(page(live({}, { ...timer, call_active: false, call_ended_at: new Date(T0) })).sub.text).toBe('Your call ended. Visible until 10:01 pm.');
  });
  it('draws the earlier pings as a trail, oldest first', () => {
    expect(page(live()).scene.trail).toHaveLength(2);
    expect(page(live()).frame).toHaveLength(1);
  });
  it('shows the page with coordinates when no place name came back', () => {
    const v = page(live({ place: { kind: 'coordinates', lat: 37.79432, lng: -122.39468 } }));
    expect(v.where.text).toBe('Near 37.7943° N, 122.3947° W');
    expect(v.scene.label).toBe('Street map');
  });
  it('shows no coordinates while approximate, even ones left from before the sharer switched', () => {
    const v = page(live({ place: { kind: 'coordinates', lat: 37.79432, lng: -122.39468 } }, { precision: 'approximate' }));
    expect(v.where).toEqual({ text: 'Approximate location', spoken: 'Approximate location' });
    expect(v.scene.label).toBe('Street map');
  });
  it('shows the Reconnecting pill while offline', () => {
    expect(page(live({ online: false })).reconnecting).toBe(true);
  });
});

describe('share back on offer', () => {
  it('offers it, then the quiet button after Not now', () => {
    expect(page(live()).card).toEqual({ kind: 'offer', asked: false });
    expect(page(live({ shareBack: 'dismissed' })).card).toEqual({ kind: 'quiet', asked: false, after: 'dismissed' });
    expect(page(live({ shareBack: 'stopped' })).card).toEqual({ kind: 'quiet', asked: false, after: 'stopped' });
  });
  it('shows the ask above it once Alex asks', () => {
    const v = page(live({}, { share_back_requested_at: new Date(T0) }));
    expect(v.card).toEqual({ kind: 'offer', asked: true });
    expect(v.facts.asked).toBe(true);
  });
  it('says when location is off, can’t be found, or can’t be shared from this browser', () => {
    expect(page(live({ shareBack: 'denied' })).card).toEqual({ kind: 'denied', asked: false, host: 'trackme.live' });
    expect(page(live({ shareBack: 'unavailable' })).card).toEqual({ kind: 'unavailable', asked: false });
    expect(page(live(), { ...ENV, canGeolocate: false }).card).toEqual({ kind: 'unsupported', asked: false });
  });
  it('is never offered to a watcher, without the call, or when the sharer said no', () => {
    expect(page(live({ link: { kind: 'open', role: 'watcher' } })).card).toBeNull();
    expect(page(live({}, { call_active: false, call_ended_at: new Date(T0) })).card).toBeNull();
    expect(page(live({}, { share_back_allowed: false })).card).toBeNull();
  });
});

describe('both live', () => {
  it('says so, with both people, the distance and Stop sharing', () => {
    const v = page(sharing());
    expect(words(v)).toEqual({ title: 'You’re both live · Track Me Live', heading: 'You’re both live' });
    expect(v.badge).toBe('together');
    expect(v.card).toBeNull();
    expect(v.people?.since).toBe('9:37 pm');
    expect(v.people?.sharer.detail.text).toBe('Updated 2 s ago · precise');
    expect(v.where.text).toBe('Near Harbor Way · 1.2 km south-west of you');
    expect(v.scene.distance).toBe('1.2 km');
    expect(v.scene.viewer?.phrase).toBe('You, sharing your location');
    expect(plain(v.scene.sharer?.phrase ?? '')).toBe('Alex, live, 1.2 kilometers away, updated 2 seconds ago');
    expect(v.frame).toHaveLength(2);
    expect(plain(v.sub.text)).toBe('Alex can see you now. This stops by itself when your call ends.');
  });
  it('frames only the sharer after Show Alex', () => {
    expect(page(sharing({ frame: 'sharer' })).frame).toHaveLength(1);
  });
});

describe('signal lost', () => {
  it('switches to Last seen once the newest ping is 3 intervals old (and at least 15 s)', () => {
    const s = session();
    expect(isStale(s, ping(15_000), T0)).toBe(false);
    expect(isStale(s, ping(15_001), T0)).toBe(true);
    expect(isStale(session({ ping_interval_s: 15 }), ping(44_000), T0)).toBe(false);
    expect(isStale(session({ ping_interval_s: 15 }), ping(46_000), T0)).toBe(true);
  });
  it('says the signal dropped, with the time, and a dashed marker', () => {
    const v = page(live({ pings: [ping(75_000)] }));
    expect(words(v)).toEqual({ title: 'Alex’s signal dropped · Track Me Live', heading: 'Alex’s signal dropped' });
    expect(v.status).toEqual({ text: 'Last seen 9:39 pm', spoken: 'Last seen at 9:39 pm', tone: 'seen' });
    expect(v.where.text).toBe('Last seen near Harbor Way');
    expect(plain(v.sub.text)).toBe('No update for a moment. This is where Alex was last seen.');
    expect(v.scene.sharer).toMatchObject({ seen: true, label: 'Last seen 9:39 pm' });
  });
  it('keeps both people while sharing back, with NO SIGNAL', () => {
    const v = page(sharing({ pings: [ping(75_000)] }));
    expect(v.badge).toBe('no-signal');
    expect(plain(v.sub.text)).toBe('This is where Alex was last seen at 9:39 pm. You’re still sharing with Alex.');
    expect(v.people?.sharer).toEqual({ lost: true, detail: { text: 'Last seen 9:39 pm', spoken: 'Last seen at 9:39 pm' } });
  });
});

describe('ended', () => {
  const ended = { status: 'stopped' as const, ended_at: new Date(T0 + 11 * MIN), end_reason: 'stopped' as const };
  it('says Alex stopped sharing, after Stop', () => {
    const v = page(live({}, ended));
    expect(words(v)).toEqual({ title: 'Alex stopped sharing · Track Me Live', heading: 'Alex stopped sharing at 9:52 pm' });
    expect(v.badge).toBe('ended');
    expect(v.status.text).toBe('Sharing ended at 9:52 pm');
    expect(v.actions).toBeNull();
    expect(v.card).toBeNull();
    expect(v.onCall).toBe(false);
    expect(v.scene).toMatchObject({ dimmed: true, sharer: { seen: true, label: 'Last seen 9:52 pm' } });
  });
  it('says Sharing ended, for a timer, the call or the limit', () => {
    for (const reason of ['timer', 'call', 'limit'] as const) {
      expect(words(page(live({}, { ...ended, end_reason: reason })))).toEqual({ title: 'Sharing ended · Track Me Live', heading: 'Sharing ended at 9:52 pm' });
    }
  });
  it('says Sharing ended at the 1-hour limit as soon as it passes, before the stop job marks it', () => {
    const atLimit = reduce(live({}, { expires_at: new Date(T0 + 11 * MIN) }), { type: 'tick', now: T0 + 11 * MIN });
    const v = page(atLimit);
    expect(words(v)).toEqual({ title: 'Sharing ended · Track Me Live', heading: 'Sharing ended at 9:52 pm' });
    expect(v.actions).toBeNull();
    expect(v.scene.sharer).toMatchObject({ seen: true, label: 'Last seen 9:52 pm' });
  });
});

describe('the map didn’t load', () => {
  it('says so, keeps the where line and Open in Maps, and drops Show Alex', () => {
    const v = page(live({ map: 'failed' }));
    expect(plain(v.mapFailed ?? '')).toBe('Alex is still sharing. Where they are is written below.');
    expect(v.actions?.showSharer).toBe(false);
    expect(v.where.text).toBe('Near Harbor Way');
    expect(plain(page(live({ map: 'failed', pings: [ping(75_000)] })).mapFailed ?? '')).toBe('Alex was last seen at 9:39 pm.');
  });
});

describe('approximate', () => {
  it('names only the area, draws no trail, and rounds the distance', () => {
    const v = page(sharing({ place: { kind: 'area', name: 'Market' } }, { precision: 'approximate' }));
    expect(v.where.text).toBe('In the Market area · about 1 km from you');
    expect(v.scene.trail).toEqual([]);
    expect(v.scene.sharer?.approximate).toBe(true);
    expect(v.scene.label).toBe('Street map of the Market area');
  });
  it('never shows a street or park found before the share turned approximate', () => {
    for (const place of [{ kind: 'street', name: 'Harbor Way' }, { kind: 'park', name: 'Alder Park' }] as const) {
      const v = page(live({ place }, { precision: 'approximate' }));
      expect(v.where.text).toBe('Approximate location');
      expect(v.scene.label).toBe('Street map');
    }
  });
});

describe('the 1-hour warning', () => {
  const nearLimit = { started_at: new Date(T0 - 56 * MIN), expires_at: new Date(T0 + 4 * MIN) };
  it('says when sharing stops in the last 5 minutes before the limit', () => {
    expect(inLimitWarning(session(nearLimit), T0)).toBe(true);
    expect(inLimitWarning(session({ expires_at: new Date(T0 + 6 * MIN) }), T0)).toBe(false);
    const v = page(live({}, nearLimit));
    expect(v.sub).toEqual({ text: 'Sharing stops at 9:45 pm.', warning: true });
  });
  it('doesn’t warn when a timer ends the session first', () => {
    const s = session({ ...nearLimit, stop_rule: 'minutes', stop_minutes: 15, stop_at: new Date(T0 + 2 * MIN) });
    expect(endsAt(s)).toEqual(new Date(T0 + 2 * MIN));
    expect(inLimitWarning(s, T0)).toBe(false);
  });
});
