import { describe, expect, it } from 'vitest';
import { ENV, live, ping, plain, session, sharing, T0 } from '../test-fixtures';
import { announce } from './announce';
import { initialModel, type Model } from './model';
import { toView } from './view';

const v = (m: Model): ReturnType<typeof toView> => toView(m, ENV);
const said = (a: Model | null, b: Model): { polite: string | null; alert: string | null } => {
  const r = announce(a ? v(a) : null, v(b));
  return { polite: r.polite && plain(r.polite), alert: r.alert && plain(r.alert) };
};
const ended = (reason: 'stopped' | 'timer'): Model => live({}, { status: 'stopped', ended_at: new Date(T0), end_reason: reason });

describe('announce', () => {
  it('says what the page shows once it has loaded, and nothing while loading', () => {
    expect(said(null, initialModel(T0))).toEqual({ polite: null, alert: null });
    expect(said(initialModel(T0), live()).polite).toBe('Alex is sharing their location with you. Near Harbor Way.');
  });

  it('never announces a tick', () => {
    expect(said(live(), live({ now: T0 + 1000 }))).toEqual({ polite: null, alert: null });
  });

  it('says the ended heading once, as an alert', () => {
    expect(said(live(), ended('stopped'))).toEqual({ polite: null, alert: 'Alex stopped sharing.' });
    expect(said(live(), ended('timer'))).toEqual({ polite: null, alert: 'Sharing ended.' });
    expect(said(ended('stopped'), ended('stopped'))).toEqual({ polite: null, alert: null });
    // The sharer deleted their account: the session is gone, and that's an end.
    const gone = live({}, { status: 'stopped', ended_at: new Date(T0), end_reason: null });
    expect(said(live(), gone)).toEqual({ polite: null, alert: 'Sharing ended.' });
  });

  it('says when both are live, and when that stops, and why', () => {
    expect(said(live({ shareBack: 'requesting' }), sharing()).polite).toBe('You’re both live.');
    expect(said(sharing(), live({ shareBack: 'stopped' })).polite).toBe('You stopped sharing your location.');
    expect(said(sharing(), live({}, { call_active: false, call_ended_at: new Date(T0) })).polite).toBe(
      'Your call ended, so your location is no longer shared.',
    );
  });

  it('says when the call ended while not sharing back', () => {
    expect(said(live(), live({}, { call_active: false, call_ended_at: new Date(T0) })).polite).toBe('Your call ended.');
  });

  it('says when the signal dropped and came back', () => {
    expect(said(live(), live({ pings: [ping(20_000)] })).polite).toBe('Alex’s signal dropped. Last seen 9:40 pm.');
    expect(said(live({ pings: [ping(20_000)] }), live()).polite).toBe('Alex is live again.');
  });

  it('says when Alex asks, and when location is off or unavailable', () => {
    expect(said(live(), live({}, { share_back_requested_at: new Date(T0) })).polite).toBe('Alex asked to see where you are.');
    expect(said(live({ shareBack: 'requesting' }), live({ shareBack: 'denied' })).polite).toBe('Location is off for this page.');
    expect(said(live({ shareBack: 'requesting' }), live({ shareBack: 'unavailable' })).polite).toBe('Your location couldn’t be shared.');
  });

  it('says when the map fails, the 1-hour warning starts, and the connection drops and returns', () => {
    expect(said(live(), live({ map: 'failed' })).polite).toBe('The map didn’t load.');
    const near = { expires_at: new Date(T0 + 4 * 60_000) };
    expect(said(live(), live({}, near)).polite).toBe('Sharing stops at 9:45 pm.');
    expect(said(live(), live({ online: false })).polite).toBe('Reconnecting.');
    expect(said(live({ online: false }), live()).polite).toBe('Connected again.');
  });

  it('mentions what’s already wrong or waiting when the page first loads', () => {
    const asked = live({ map: 'failed' }, { share_back_requested_at: new Date(T0) });
    expect(said(initialModel(T0), asked).polite).toBe('Alex is sharing their location with you. Near Harbor Way. Alex asked to see where you are. The map didn’t load.');
    expect(said(initialModel(T0), ended('stopped'))).toEqual({ polite: null, alert: null });
  });

  it('says several changes together', () => {
    const before = live();
    const after = live({ map: 'failed', online: false }, session({ share_back_requested_at: new Date(T0) }));
    expect(said(before, after).polite).toBe('Alex asked to see where you are. The map didn’t load. Reconnecting.');
  });
});
