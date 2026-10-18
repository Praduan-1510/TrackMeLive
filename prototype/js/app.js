/* Track Me Live click-through prototype.
   One state object drives two phones: Alex's iPhone (the app) and Mom's phone (the browser link). */
(function () {
  'use strict';

  const M = window.TML.map;
  const SETS = [
    { id: 'classics', name: 'Classics' },
    { id: 'anime', name: 'Anime' },
    { id: 'movie', name: 'Movie night' },
  ];
  const MASCOTS = [
    { id: 'fox', name: 'Fox', set: 'classics' },
    { id: 'ghost', name: 'Ghost', set: 'classics' },
    { id: 'robot', name: 'Robot', set: 'classics' },
    { id: 'astronaut', name: 'Astronaut', set: 'classics' },
    { id: 'hero', name: 'Hero', set: 'anime' },
    { id: 'star', name: 'Star', set: 'anime' },
    { id: 'ninja', name: 'Ninja', set: 'anime' },
    { id: 'neko', name: 'Neko', set: 'anime' },
    { id: 'ace', name: 'Ace', set: 'movie' },
    { id: 'detective', name: 'Detective', set: 'movie' },
    { id: 'cowboy', name: 'Cowboy', set: 'movie' },
    { id: 'agent', name: 'Agent', set: 'movie' },
  ];
  // Every character has a render per color: fur, body or shell for the Classics, hair or clothes for
  // the Anime and Movie night sets. Skin, eyes, visors and lamps never change.
  const ASSET = {
    mascot: (id, color = 'original') => (color !== 'original'
      ? `../design-system/assets/Mascots/colors/${id}-${color}.png`
      : `../design-system/assets/Mascots/${id}.png`),
    flat: (id) => `../design-system/assets/Mascots/${id}.svg`,
    // Accessory overlays are rendered with the mascot's camera, so they stack on the render exactly.
    accessory: (id, acc) => `../design-system/assets/Mascots/accessories/${id}-${acc}.png`,
    logo: (f) => `../brand/logo/${f}`,
  };
  const ACCESSORIES = [
    { id: 'headphones', name: 'Headphones' },
    { id: 'glasses', name: 'Glasses' },
    { id: 'headlamp', name: 'Headlamp' },
  ];
  // Each character takes only the accessories that fit its gear. The astronaut's helmet takes none.
  const ACC_FOR = {
    fox: ['headphones', 'glasses', 'headlamp'], ghost: ['headphones', 'glasses', 'headlamp'], robot: ['headlamp'], astronaut: [],
    hero: ['glasses'], star: ['headphones', 'glasses', 'headlamp'], ninja: ['headphones'], neko: ['glasses', 'headlamp'],
    ace: ['headphones', 'headlamp'], detective: ['glasses'], cowboy: ['glasses'], agent: ['headphones', 'glasses', 'headlamp'],
  };
  const COLORS = [
    { id: 'original', name: 'Original', swatch: '#F2A033' },
    { id: 'moss', name: 'Moss', swatch: '#A3B13E' },
    { id: 'lagoon', name: 'Lagoon', swatch: '#33B3A3' },
    // Measured from the dusk renders (the average of what changes): ΔE 36.5 from crossing blue in light, 21.8 in dark.
    { id: 'dusk', name: 'Dusk', swatch: '#7A91C5' },
    { id: 'rose', name: 'Rose', swatch: '#DD6A95' },
  ];
  // The Original swatch shows each character's own key color, measured from its renders
  // (the average of the region that changes color).
  const KEY = {
    fox: '#E5AB5B', ghost: '#BEC5C6', robot: '#909EA4', astronaut: '#D9DBDA', hero: '#DC9654', star: '#E1C2CD',
    ninja: '#424860', neko: '#E1DCD3', ace: '#4D332B', detective: '#D3BD92', cowboy: '#E5C69B', agent: '#454448',
  };
  const swatchFor = (c) => (c.id === 'original' ? KEY[S.alex.mascot] : c.swatch);
  const PING_MS = 3500;
  const PING_S = `${PING_MS / 1000} s`;
  const LINK = 'trackme.live/s/8fK2';
  // Every session gets its own link; Share again sends a new one.
  const TOKENS = ['8fK2', 'Q7mX', 'c3Rt', 'Hw9p', 'Zk4n', 'p2Lv'];
  const linkFor = (n) => `trackme.live/s/${TOKENS[((n % TOKENS.length) + TOKENS.length) % TOKENS.length]}`;
  const LIMIT_MS = 3600000; // the hard limit: every session stops 1 hour after it starts

  // ---------- Time ----------
  const T0 = Date.now();
  const BASE = new Date(2026, 9, 17, 21, 38, 0).getTime();
  const now = () => BASE + (Date.now() - T0);
  const fmt = (ms) => {
    const d = new Date(ms);
    let h = d.getHours();
    const ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
  };
  const clock = (ms) => fmt(ms).replace(/ (am|pm)$/, '');
  const mmss = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const ago = (ms) => {
    const s = Math.max(1, Math.round((now() - ms) / 1000));
    return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
  };
  const minutes = (ms) => {
    const m = Math.floor(Math.max(0, ms) / 60000);
    return m < 1 ? '< 1 min' : `${m} min`;
  };
  // Spoken forms for screen readers: long unit names, never "s" or "min".
  const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'long' });
  const agoSpoken = (ms) => {
    const s = Math.max(0, Math.round((now() - ms) / 1000));
    return s < 60 ? RTF.format(-s, 'second') : RTF.format(-Math.round(s / 60), 'minute');
  };
  const minutesSpoken = (ms) => {
    const m = Math.floor(Math.max(0, ms) / 60000);
    return m < 1 ? 'less than a minute' : m === 1 ? '1 minute' : `${m} minutes`;
  };

  // ---------- State ----------
  let S;
  const stored = (key, fallback, ok) => {
    try { const v = localStorage.getItem(key); return v && (!ok || ok.includes(v)) ? v : fallback; } catch (e) { return fallback; }
  };
  function fresh() {
    return {
      theme: stored('tml-proto-theme', 'system'),
      // Which phones the stage shows. App content, state and flows are shared; only the device and OS change.
      platform: stored('tml-proto-platform', 'ios', ['ios', 'android']),
      // Text size on both phones: default, 150% or 200% (about iOS's AX1 and AX3, Android's 1.5 and 2.0).
      text: stored('tml-proto-text', 'default', ['default', 'large', 'xl']),
      show: 'alex',
      alex: {
        screen: 'splash', ob: 0, onboarded: false, pickerFrom: 'onboarding',
        // The name people see on the map: trimmed, 1 to 24 characters.
        name: 'Alex', nameErr: false,
        // Sign-up: the code typed so far, its error, and when a new code can be sent.
        signup: 'details', codeFilled: false, code: '', codeErr: null, resendAt: 0, numberErr: false, sendErr: false, codeNote: '',
        mascot: 'fox', color: 'original', accessory: 'none',
        modal: null, modalFor: null, alert: null, banner: null,
        // Permissions, and the prompt on screen (an in-app explainer or the system's own alert).
        // loc: unset | while | denied, plus Android's once (Only this time) and ask (Ask every time).
        // "While using" is all sharing needs: it starts in the app and keeps going in the background.
        // phone and precise are Android only: READ_PHONE_STATE (to stop when the call ends), and Precise vs Approximate.
        perm: { loc: 'unset', notif: 'unset', phone: 'unset', precise: true }, sys: null, afterLoc: null, everEnded: false,
        // The "Share faster during calls" card, and the quick-start control: Control Center on iPhone,
        // the Quick Settings tile on Android (cc is the iPhone panel; Android uses shade = 'qs').
        tipDone: false, cc: false, quickUsed: false, tileAdded: false, phoneLater: false,
        // "Who it's for", filled in with the last name used. Only Alex's screens ever show it.
        viewerName: 'Mom',
        island: false, menu: null, menuAt: null,
        // Android only: the picture-in-picture mini map (open, menu, closed), the notification shade,
        // the system Settings page on screen, and the choice in the location dialog.
        pip: null, shade: false, sysPage: null, locChoice: 'precise',
        settings: { offer: true, precision: 'precise', defaultStop: 'call', shareBack: true, alertOpened: true, alertCall: true, alertExpiry: true },
      },
      // Each call gets an id. A session started during a call keeps that call's id (call_id); it is
      // Live Together only while that same call is connected (call_active).
      call: { active: false, startedAt: 0, ever: false, id: 0 },
      // stop: 'call', minutes, or 'limit'; stopAt is never later than expiresAt (start + 1 hour).
      // look: the mascot, color and accessory when the session started; its marker keeps them.
      // precisionNext: a mid-session change of Precise/Approximate, applied at the next ping.
      session: { status: 'idle', n: -1, viewer: '', callId: null, startedAt: 0, expiresAt: 0, stop: 'call', stopAt: null, precision: 'precise', precisionNext: null, shareBack: true, viewedAt: null, endedAt: null, reason: null, askedAt: null, look: null },
      // Ask to share is once per call, also across Share again during the same call.
      askedCall: null,
      // Story steps already done (they stay done until Restart).
      storyDone: [],
      // frozen: what Mom's open page keeps showing after a session ends, even once a new one starts.
      // frame: what the viewer's map keeps in view, 'auto' (Alex, and Mom once she shares back) or 'alex' after Show Alex.
      mom: { screen: 'lock', notif: false, perm: false, sharing: false, denied: false, dismissed: false, everShared: false, sharedAt: null, frozen: null, loading: false, mapFailed: false, noGeo: false, frame: 'auto', mapsAsk: false },
      world: { t: M.T_START, trail: [], alexLast: 0, mom: M.HOME.slice(), momLast: 0, signalLost: false, offline: false, lastPing: 0 },
      // Edge cases the stage can trigger: an incomplete number, a text that fails, an expired code.
      dev: { badNumber: false, sendFail: false, codeExpired: false },
    };
  }

  // ---------- Small helpers ----------
  const mascotName = () => MASCOTS.find((m) => m.id === S.alex.mascot).name;
  const mascotSrc = () => ASSET.mascot(S.alex.mascot, S.alex.color);
  // Kept for callers; every color is its own render now, so nothing is tinted in the browser.
  const hueFilter = () => '';
  const accFor = (id = S.alex.mascot) => ACC_FOR[id] || [];
  const accName = (id) => (ACCESSORIES.find((x) => x.id === id) || { name: 'None' }).name;
  // Accessory renders that failed to load (not rendered yet): never asked for again, never shown broken.
  const ACC_MISSING = new Set();
  // The current choice, or a session's snapshot of it.
  const currentLook = () => ({ mascot: S.alex.mascot, color: S.alex.color, accessory: S.alex.accessory });
  const accSrcFor = (look) => {
    const a = look.accessory;
    if (!a || a === 'none' || !(ACC_FOR[look.mascot] || []).includes(a)) return '';
    const src = ASSET.accessory(look.mascot, a);
    return ACC_MISSING.has(src) ? '' : src;
  };
  const accSrc = () => accSrcFor(currentLook());
  // The accessory is its own layer on top of the mascot: same box, never tinted.
  const accLayer = (cls, style, look = currentLook()) => {
    const src = accSrcFor(look);
    return src ? `<img class="acc-layer${cls ? ` ${cls}` : ''}" src="${src}" alt="" style="${style}filter:none" onerror="TML.accFail(this)">` : '';
  };
  const mascotLabel = () => (S.alex.accessory !== 'none' && accSrc() ? `${mascotName()} with ${accName(S.alex.accessory).toLowerCase()}` : mascotName());
  // A render that can't load falls back to the Original render, then the flat SVG, then nothing
  // (the marker keeps its plain lamplight disc).
  const lookImg = (look, cls, size, style) => {
    const box = `${style || ''}${size ? `width:${size}px;height:${size}px;` : ''}`;
    return `<img class="${cls || ''}" src="${ASSET.mascot(look.mascot, look.color)}" alt="" style="${box}" data-id="${look.mascot}" onerror="TML.mascotFail(this)">${accLayer(cls, box, look)}`;
  };
  const mascotImg = (cls, size, style) => lookImg(currentLook(), cls, size, style);
  // A share keeps the look it started with on both maps and Mom's page; Home, the picker and Settings
  // show a new choice at once, and it reaches the map with the next share.
  const sessionLook = () => (S.session.status !== 'idle' && S.session.look) || currentLook();
  const sessionMascotImg = (cls, size, style) => lookImg(sessionLook(), cls, size, style);
  const active = () => S.session.status === 'active';
  // Live Together needs the session's own call: connected now, and the call the session started with.
  const callActive = () => active() && S.session.callId != null && S.call.active && S.call.id === S.session.callId;
  const alexPos = () => M.bez(S.world.t);
  // stopAt: the timer's end, already capped at the 1-hour limit. endAt: when sharing ends at the latest.
  const stopAt = () => (S.session.stop === 'call' ? null : S.session.stopAt);
  const endAt = () => (S.session.stop === 'call' ? S.session.expiresAt : Math.min(S.session.stopAt, S.session.expiresAt));
  // The 1-hour warning: 5 minutes before the limit, when the limit (not a timer) ends sharing.
  const WARN_MS = 5 * 60000;
  const limitSoon = () => active() && endAt() === S.session.expiresAt && now() >= S.session.expiresAt - WARN_MS;
  const limitLine = () => `Sharing stops at ${fmt(S.session.expiresAt)} · 1-hour limit`;
  // Share back can happen only during the session's own call, when Alex allows it.
  const shareBackPossible = () => callActive() && S.session.shareBack;
  // Why share back isn't on offer, in one line for Alex's live sheet (null while it is, or while they share back).
  const shareBackNote = () => {
    const s = S.session;
    if (!active() || S.mom.sharing || shareBackPossible()) return null;
    if (s.callId == null) return `${who.They()} can share back only when you start sharing during a call.`;
    if (!s.seesCallEnd) return `${who.They()} can share back only when Track Me Live has Phone access, so it can stop when the call ends.`;
    if (!callActive()) return 'Share back ended with the call.';
    return 'Share back is off for this call.';
  };
  const sbNoteHtml = () => { const t = shareBackNote(); return t ? `<p class="sb-note">${t}</p>` : ''; };
  const stopLabel = (v) => (v === 'call' ? 'When the call ends' : v === 'limit' ? `At the 1-hour limit · ${fmt(S.session.expiresAt)}` : v === 60 ? 'In 1 hour' : `In ${v} min`);
  const stopShort = () => (S.session.stop === 'call' ? 'When call ends' : fmt(endAt()).replace(' ', '\u00a0'));
  const quiet = () => S.world.signalLost || S.world.offline;
  // Approximate: the phone rounds each point to about 500 m before it's written, so both maps get the
  // rounded point, drawn with a soft circle, and every distance says "about".
  const APPROX_GRID = 500 / 6;
  const approx = () => S.session.precision === 'approximate';
  const sharedPos = () => { const p = alexPos(); return approx() ? p.map((v) => Math.round(v / APPROX_GRID) * APPROX_GRID) : p; };
  const distance = () => M.distanceLabel(sharedPos(), S.world.mom, approx());
  const distanceSpoken = () => M.distanceSpoken(sharedPos(), S.world.mom, approx());
  const link = () => linkFor(S.session.n);
  // "Who it's for": a name only Alex's screens use. Without one, the copy says they and them,
  // and the viewer's disc shows a person icon instead of an initial.
  const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const vn = () => esc((S.session.viewer || '').trim());
  // The sharer's own name, as typed at sign-up (1 to 24 characters).
  const an = () => esc(S.alex.name || 'Alex');
  const who = {
    They: () => vn() || 'They',
    them: () => vn() || 'them',
    label: () => vn() || 'Them',
    their: () => (vn() ? `${vn()}’s` : 'their'),
    Their: () => (vn() ? `${vn()}’s` : 'Their'),
    with: () => (vn() ? `Sharing with ${vn()}` : 'Sharing your location'),
  };
  // The viewer's initial: the raw name's first character when it's a letter or digit, escaped;
  // otherwise (a symbol, or no name) a person icon.
  const viewerMark = () => { const ch = [...(S.session.viewer || '').trim()][0] || ''; return /^[\p{L}\p{N}]$/u.test(ch) ? esc(ch.toUpperCase()) : M.PERSON; };
  const sees = () => (vn() ? `${vn()} sees` : 'They see');
  // Before the link is opened, nobody sees anything yet.
  const seesLast = () => (S.session.viewedAt ? `${sees()} where you were last seen.` : `${vn() ? `${vn()} will see` : 'They’ll see'} where you were last seen when they open the link.`);
  // The live sheet's line under the title, on both platforms.
  function liveSub() {
    const n = vn();
    if (S.world.offline) return `No connection right now. ${seesLast()}`;
    if (S.world.signalLost) return `No GPS signal right now. ${seesLast()}`;
    if (!S.session.viewedAt) return n ? `Link sent to ${n}. You’ll know when it’s opened.` : 'Link sent. You’ll know when it’s opened.';
    if (S.mom.sharing) return `${who.They()} opened your link at ${fmt(S.session.viewedAt)} and ${n ? 'is' : 'are'} sharing back.`;
    return `${who.They()} opened your link at ${fmt(S.session.viewedAt)}.${callActive() && S.session.shareBack && !S.mom.denied ? ' Share back is on.' : ''}`;
  }
  // The sharer's own row: how precise, and the real ping interval (or why there are no pings).
  const alexDetail = () => (S.world.offline ? 'No connection' : S.world.signalLost ? 'No GPS signal'
    : `${approx() ? 'Approximate' : 'Precise'} · every ${PING_S}`);
  const statusWord = () => (S.world.offline ? 'No connection' : 'No GPS signal');
  const endedWhy = (s) => (s.reason === 'limit' ? 'That’s the longest a link can run. Share again to send a new link.'
    : s.reason === 'call' ? 'Your call ended, so sharing stopped.' : s.reason === 'timer' ? 'Your timer ran out, so sharing stopped.' : `You stopped sharing at ${fmt(s.endedAt)}.`);
  // The points go, the session details stay: "deleted by 10:38 pm tomorrow".
  const deletedBy = (s) => `Location points from this session are deleted by ${fmt(s.endedAt + 24 * 3600000)} tomorrow.`;
  const alexDetailSpoken = () => (S.world.offline ? 'No connection' : S.world.signalLost ? 'No GPS signal'
    : `${approx() ? 'Approximate' : 'Precise'}, updates every ${PING_MS / 1000} seconds`);

  // What the eye reads and what a screen reader says, when they differ ("3 s ago" / "3 seconds ago").
  const dual = (vis, spoken, bv, bs) => `<span aria-hidden="true"${bv ? ` data-bind="${bv}"` : ''}>${vis}</span><span class="sr-only"${bs ? ` data-bind="${bs}"` : ''}>${spoken}</span>`;
  // Badges are uppercase to the eye and a plain phrase to a screen reader.
  const badge = (cls, vis, spoken, dot) => `<span class="badge ${cls}">${dot ? '<i aria-hidden="true"></i>' : ''}${dual(vis, spoken)}</span>`;
  const liveBadge = () => (S.world.offline ? badge('seen', 'NO CONNECTION', 'No connection')
    : S.world.signalLost ? badge('seen', 'NO SIGNAL', 'No GPS signal') : badge('live', 'LIVE', 'Sharing live', true));
  const stopSpoken = () => (S.session.stop === 'call' ? 'Stops when the call ends' : `Stops at ${fmt(endAt())}`);
  // The live sheet's three tiles, each read as one phrase: "Distance, 1.3 kilometers".
  function tilesHtml() {
    const dt = distTile();
    const t = (vis, label, spoken, bv, bs) => `<div class="tile"><span class="sr-only"${bs ? ` data-bind="${bs}"` : ''}>${spoken}</span><b aria-hidden="true"${bv ? ` data-bind="${bv}"` : ''}>${vis}</b><span aria-hidden="true">${label}</span></div>`;
    return `<div class="tiles">${t(dt.v, dt.l, dt.spoken, dt.bind, dt.bind ? 'distanceSr' : '')}${t(minutes(now() - S.session.startedAt), 'sharing', `Sharing for ${minutesSpoken(now() - S.session.startedAt)}`, 'duration', 'durationSr')}${t(stopShort(), 'stops', stopSpoken())}</div>`;
  }

  const ic = {
    loc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 3 L3 10.5 L11 13 L13.5 21 Z" fill="currentColor"/></svg>',
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h3.5l1.8 4.6-2.3 1.6a12 12 0 0 0 5.8 5.8l1.6-2.3L20 14.5V18a2 2 0 0 1-2 2A15 15 0 0 1 3 5a2 2 0 0 1 2-2z" fill="currentColor"/></svg>',
    chev: '<svg viewBox="0 0 8 13" aria-hidden="true"><path d="M1.5 1.5 L6.5 6.5 L1.5 11.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    back: '<svg viewBox="0 0 12 20" aria-hidden="true"><path d="M10 2 L2 10 L10 18" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 L10 17.5 L19 7" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11 L12 4 L20 11 V19 a1.5 1.5 0 0 1 -1.5 1.5 H14.5 V15 h-5 v5.5 H5.5 A1.5 1.5 0 0 1 4 19 Z" fill="currentColor"/></svg>',
    face: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3.5 L8.5 7 Q12 5.6 15.5 7 L20 3.5 L19.5 12 Q19 19.5 12 21 Q5 19.5 4.5 12 Z" fill="currentColor"/><circle cx="9.3" cy="12" r="1.3" fill="var(--surface-raised)"/><circle cx="14.7" cy="12" r="1.3" fill="var(--surface-raised)"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/><circle cx="16" cy="7" r="2.6" stroke="currentColor" stroke-width="2.2" fill="none"/><circle cx="10" cy="17" r="2.6" stroke="currentColor" stroke-width="2.2" fill="none"/></svg>',
    bubble: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5c-5 0-9 3.3-9 7.4 0 2.3 1.2 4.3 3.2 5.7L5.5 20l4-2c.8.2 1.6.3 2.5.3 5 0 9-3.3 9-7.4S17 3.5 12 3.5z" fill="currentColor"/></svg>',
    mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 7.5 L12 13 L20 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14 a4 4 0 0 0 5.7 0 l3-3 a4 4 0 0 0 -5.7 -5.7 l-1 1 M14 10 a4 4 0 0 0 -5.7 0 l-3 3 a4 4 0 0 0 5.7 5.7 l1 -1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="18" cy="12" r="1.8" fill="currentColor"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
    shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 L19 6 V11.5 C19 16 16 19.2 12 21 C8 19.2 5 16 5 11.5 V6 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 12 L11.2 14.2 L15.2 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5 V12 L15 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5a5.5 5.5 0 0 0-5.5 5.5v3.6L5 15.5V17h14v-1.5l-1.5-2.9V9A5.5 5.5 0 0 0 12 3.5z" fill="currentColor"/><path d="M9.8 18.5a2.3 2.3 0 0 0 4.4 0z" fill="currentColor"/></svg>',
    xcircle: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M8.6 8.6l6.8 6.8M15.4 8.6l-6.8 6.8" stroke="var(--surface)" stroke-width="2" stroke-linecap="round"/></svg>',
    warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.2v6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.6" r="1.3" fill="currentColor"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 12.5v6a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5v-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5 9 4l6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5z M9 4v13.5 M15 6.5V20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    target: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8a7 7 0 0 0-7 7c0 5.1 6 10.9 6.3 11.2a1 1 0 0 0 1.4 0c.3-.3 6.3-6.1 6.3-11.2a7 7 0 0 0-7-7zm0 9.7a2.7 2.7 0 1 1 0-5.4 2.7 2.7 0 0 1 0 5.4z" fill="currentColor"/></svg>',
    updown: '<svg viewBox="0 0 10 16" aria-hidden="true"><path d="M2 6 5 3l3 3M2 10l3 3 3-3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 13 8" aria-hidden="true"><path d="M1.5 1.5 L6.5 6.5 L11.5 1.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  // Control Center glyphs: generic stand-ins for the system's own symbols.
  const cg = {
    plane: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15.6v-1.9l-7.6-4.8V4.3a1.4 1.4 0 0 0-2.8 0v4.6L3 13.7v1.9l7.6-2.4v5L8.7 19.6V21l3.3-.9 3.3.9v-1.4l-1.9-1.4v-5z" fill="currentColor"/></svg>',
    cell: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="14" width="3.4" height="6" rx="1.2" fill="currentColor"/><rect x="8.2" y="10.5" width="3.4" height="9.5" rx="1.2" fill="currentColor"/><rect x="13.4" y="7" width="3.4" height="13" rx="1.2" fill="currentColor"/><rect x="18.6" y="3.5" width="3.4" height="16.5" rx="1.2" fill="currentColor" opacity=".45"/></svg>',
    wifi: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.6 9.2a13.4 13.4 0 0 1 18.8 0M5.6 12.4a9.2 9.2 0 0 1 12.8 0M8.6 15.6a5 5 0 0 1 6.8 0" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/><circle cx="12" cy="18.8" r="1.7" fill="currentColor"/></svg>',
    bt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 7.5l11 9-5.5 4.5V3l5.5 4.5-11 9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.6A8.2 8.2 0 1 1 9.4 4a6.6 6.6 0 0 0 10.6 10.6z" fill="currentColor"/></svg>',
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><path d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    vol: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 9.2h3.6L12 5v14l-4.9-4.2H3.5z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.3 6a8.6 8.6 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    torch: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 2.8h9v3.6l-2.4 3.4v11.4h-4.2V9.8L7.5 6.4z" fill="currentColor"/></svg>',
    camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 8.2h3.3l1.9-2.7h6.6l1.9 2.7h3.3v11H3.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13.4" r="3.4" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    rot: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.4 3.2v4h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><rect x="9" y="11.2" width="6" height="4.6" rx="1" fill="currentColor"/><path d="M10.2 11.2V10a1.8 1.8 0 0 1 3.6 0v1.2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor"/></svg>',
    skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6v12l8-6zM12 6v12l8-6z" fill="currentColor"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    power: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M7.2 6.4a7.5 7.5 0 1 0 9.6 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  };
  const PHONE = '(415) 555-0142';
  const CODE = '482913';
  const statusIcons = `<span class="icons"><svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true"><rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor"/><rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor"/><rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor"/></svg><svg width="27" height="13" viewBox="0 0 27 13" aria-hidden="true"><rect x="0.5" y="0.5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="16" height="9" rx="2" fill="currentColor"/><rect x="24.5" y="4.5" width="2" height="4" rx="1" fill="currentColor" opacity=".4"/></svg></span>`;

  // ---------- Devices ----------
  const DEV = {};
  function mount(name) {
    const screen = document.querySelector(`.screen[data-device="${name}"]`);
    // The iPhone status bar's time turns into the green call pill during a call; on Alex's phone it
    // returns to the call, since iOS gives apps no way to open the call screen themselves.
    // The map layer sits after the app in reading order (it's drawn underneath): the words come first.
    screen.innerHTML = `<div class="layer ui-layer"></div><div class="layer map-layer"></div><div class="layer top-layer"></div>
      <div class="statusbar"><span class="sb-l"><button class="sb-time" type="button" ${name === 'alex' ? 'data-act="backToCall"' : ''} tabindex="-1" aria-label="Return to the call"><span data-bind="clock">9:38</span></button><span class="sb-loc" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M11 1 1.6 5.1l4.4 1 1 4.4z" fill="currentColor"/></svg></span></span>${statusIcons}</div><div class="home-ind"></div>
      <div class="a-statusbar"></div><div class="a-gesture"></div><div class="a-cam" aria-hidden="true"></div>
      ${name === 'alex' ? '<div class="pip" hidden><div class="pip-map" aria-hidden="true"></div><div class="pip-ui"></div></div>' : ''}
      <div class="sr-live" role="status" aria-live="polite"></div>${name === 'mom' ? '<div class="sr-live sr-alert" role="alert"></div>' : ''}`;
    const d = {
      screen,
      ui: screen.querySelector('.ui-layer'),
      top: screen.querySelector('.top-layer'),
      live: screen.querySelector('.sr-live'),
      alert: screen.querySelector('.sr-alert'),
      mapHost: screen.querySelector('.map-layer'),
      map: new M.MapView(screen.querySelector('.map-layer')),
      // Android's picture-in-picture mini map keeps its own map, so it survives screen changes.
      pipMap: name === 'alex' ? new M.MapView(screen.querySelector('.pip-map')) : null,
      lastKey: null, lastUi: '', lastTop: '', lastBar: '', lastPip: '', lastSaid: '',
      // Focus: the control that opened the current dialog, and the dialog on screen.
      trigger: null, returnTo: null, modalKey: '', momPrev: null, alertSaid: '',
    };
    screen.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el || !screen.contains(el)) return;
      e.preventDefault();
      // A destructive button that has just appeared ignores a tap carried over from a double tap.
      if (el.hasAttribute('data-guard') && Date.now() - ((d.guards || {})[JSON.stringify(focusKey(el))] || 0) < GUARD_MS) return;
      d.trigger = focusKey(el);
      act(el.dataset.act, el);
    });
    // Dialogs: Escape closes them (system prompts that need an answer don't), and Tab stays inside.
    screen.addEventListener('keydown', (e) => {
      const modal = openModal(d);
      if (!modal) return;
      if (e.key === 'Escape') {
        const esc = modal.getAttribute('data-esc');
        if (esc) { e.preventDefault(); e.stopPropagation(); act(esc, modal); }
        return;
      }
      if (e.key !== 'Tab') return;
      const f = [...modal.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]')].filter((x) => x.getClientRects().length);
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === modal || !modal.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !modal.contains(at))) { e.preventDefault(); first.focus(); }
    });
    screen.addEventListener('change', (e) => {
      const el = e.target.closest('[data-change]');
      if (el) act(el.dataset.change, el);
      const tx = e.target.closest('[data-input]');
      if (tx && INPUTS[tx.dataset.input]) INPUTS[tx.dataset.input](tx, true);
    });
    // Text fields commit as you type and never re-render, so the next tap (Send code, Share live
    // location) always lands. A clear button next to a field follows it.
    screen.addEventListener('input', (e) => {
      const tx = e.target.closest('[data-input]');
      if (!tx || !INPUTS[tx.dataset.input]) return;
      INPUTS[tx.dataset.input](tx, false);
      const clear = tx.id && screen.querySelector(`[data-clear-for="${tx.id}"]`);
      if (clear) clear.hidden = !tx.value.trim();
    });
    // iPhone scrolling screens: past the large title, the bar turns solid with an inline title and
    // a hard scroll edge.
    screen.addEventListener('scroll', (e) => {
      const el = e.target;
      if (el.classList && el.classList.contains('scr')) el.classList.toggle('scrolled', el.scrollTop > 36);
    }, true);
    DEV[name] = d;
  }

  // ---------- Shared pieces ----------
  const tabbar = (current) => `<nav class="tabbar" aria-label="Tabs">
      <button type="button" data-act="tab" data-tab="home" ${current === 'home' ? 'aria-current="page"' : ''}>${ic.home}Home</button>
      <button type="button" data-act="tab" data-tab="mascot" ${current === 'mascot' ? 'aria-current="page"' : ''}>${ic.face}Mascot</button>
      <button type="button" data-act="tab" data-tab="settings" ${current === 'settings' ? 'aria-current="page"' : ''}>${ic.gear}Settings</button>
    </nav>`;
  const backBtn = (act, label) => `<button class="back" type="button" data-act="${act}" aria-label="${label}">${ic.back}</button>`;

  // The phone's own call screen (iOS stand-in); the README says it's a stand-in.
  const callScreen = (who) => {
    const isAlex = who === 'alex';
    const pill = isAlex && active() ? island() : '';
    return {
      key: `${who}-call`, cls: 'callscreen', darkChrome: true, islandOpen: isAlex && active() && S.alex.island,
      html: `${pill}<div class="who">${isAlex ? 'Mom' : an()}</div><div class="dur" data-bind="calltime">00:00</div>
        <div class="grow"></div>
        <div class="callpad" aria-hidden="true"><div><i></i>mute</div><div><i></i>keypad</div><div><i></i>speaker</div><div><i></i>add call</div><div><i></i>video</div><div><i></i>contacts</div></div>
        <button class="endcall" type="button" data-act="endCall" aria-label="End call">${ic.phone}</button>`,
    };
  };

  // The Live Activity in the Dynamic Island, shown while Alex is out of the app during a share.
  // Compact: mascot and distance. Tapped open: both people, the distance, Open map and Stop.
  // The island is hardware black, so it always takes the dark tokens.
  const islandShort = () => (S.world.offline ? 'No connection' : S.world.signalLost ? 'No signal' : S.mom.sharing ? distance() : 'Live');
  const islandSub = () => (quiet() ? `${statusWord()} · last seen ${fmt(S.world.alexLast)}` : limitSoon() ? limitLine() : S.session.stop === 'call' ? 'Until the call ends' : `Until ${fmt(endAt())}`);
  function island() {
    const lost = quiet();
    const art = (cls) => `<span class="ia${cls ? ` ${cls}` : ''}${lost ? ' seen' : ''}">${sessionMascotImg()}</span>`;
    if (!S.alex.island) {
      return `<button class="island" data-theme="dark" type="button" data-act="toggleIsland" aria-label="${who.with()}, ${lost ? statusWord().toLowerCase() : S.mom.sharing ? `${distanceSpoken()} apart` : 'live'}. Open the Live Activity">${art()}<span class="ib${lost ? ' lost' : ''}" aria-hidden="true"><span class="d${lost ? ' seen' : ''}"></span><span data-bind="islandShort">${islandShort()}</span></span></button>`;
    }
    return `<div class="island open" data-theme="dark" role="group" aria-label="Live Activity: ${vn() ? `sharing with ${vn()}` : 'sharing your location'}">
        <div class="ih">${art('big')}<div class="it"><b>${who.with()}</b><span data-bind="islandSub">${islandSub()}</span></div><button class="ix" type="button" data-act="toggleIsland" aria-label="Close the Live Activity">${ic.x}</button></div>
        <div class="itrack"><span class="dot a" aria-hidden="true"></span><span class="who">You</span><span class="line"></span><span class="lbl">${S.mom.sharing ? dual(distance(), `${distanceSpoken()} apart`, 'islandDist', 'islandDistSr') : !S.session.viewedAt ? 'Link sent · not opened yet' : vn() ? `${vn()} is watching` : 'They’re watching'}</span><span class="line"></span><span class="who">${who.label()}</span><span class="dot b${S.mom.sharing ? '' : ' off'}" aria-hidden="true">${viewerMark()}</span></div>
        <div class="ibtns"><button class="ibtn" type="button" data-act="backToApp">Open map</button><button class="ibtn stop" type="button" data-act="islandStop">Stop sharing</button></div>
      </div>`;
  }

  // ---------- Alex's screens ----------
  function viewAlex() {
    const a = S.alex;
    switch (a.screen) {
      case 'splash':
        return { key: 'splash', cls: 'splash', darkChrome: true, html: `<span class="glow" data-theme="dark"></span><img class="m" src="${ASSET.logo('mark-on-dark.svg')}" alt=""><img class="w" src="${ASSET.logo('wordmark-on-dark.svg')}" alt="Track Me Live">` };
      case 'onboarding': return viewOnboarding();
      case 'signup': return viewSignup();
      case 'picker': return viewPicker();
      case 'share': return viewShare();
      case 'live': return viewLive();
      case 'ended': return viewEnded();
      case 'settings': return viewSettings();
      case 'call': return callScreen('alex');
      default: return viewHome();
    }
  }

  function viewOnboarding() {
    const i = S.alex.ob;
    const pages = [
      {
        art: `<span class="glow"></span><img class="hero" src="${ASSET.mascot('fox')}" alt="" data-id="fox" onerror="TML.mascotFail(this)">`,
        title: 'Share where you are, the moment you’re on the phone.',
        body: '<p class="ob-body">One tap during a call, and the person you’re talking to can follow you live. They don’t need the app.</p>',
      },
      {
        art: `<div class="ob-map">
            ${M.svg('120 120 300 255')}
            <div class="mk sharer" aria-hidden="true" style="left:${(M.bez(0.66)[0] - 120) * 1.1}px;top:${(M.bez(0.66)[1] - 120) * 1.1}px"><div class="halo"></div><div class="disc"><img src="${ASSET.mascot('fox')}" alt="" data-id="fox" onerror="TML.mascotFail(this)"></div></div>
            <div class="mk viewer" aria-hidden="true" style="left:${(M.HOME[0] - 120) * 1.1}px;top:${(M.HOME[1] - 120) * 1.1 + 30}px"><div class="halo"></div><div class="disc">M</div></div>
          </div>`,
        title: 'Live Together',
        body: '<p class="ob-body">While you talk, they can share back. You both see one map until the call ends.</p>',
      },
      {
        art: `<span class="glow"></span><img src="${ASSET.logo('mark.svg')}" alt="" class="ob-mark">`,
        title: 'Private by default',
        body: `<div class="ob-list">
            <div>${ic.shield}<span>Nothing is shared until you tap Share.</span></div>
            <div>${ic.clock}<span>Sharing stops when the call ends, or when your timer runs out.</span></div>
            <div>${ic.trash}<span>Location points are deleted 24 hours after you stop.</span></div>
          </div>`,
      },
    ];
    const p = pages[i];
    return {
      key: `ob-${i}`, cls: 'pad',
      html: `<div class="navrow"><span></span>${i < 2 ? '<button class="btn plain small" type="button" data-act="obSkip">Skip</button>' : ''}</div>
        <div class="ob-art">${p.art}</div>
        <h1 class="ob-title">${p.title}</h1>${p.body}
        <div class="grow"></div>
        <div class="ob-dots" aria-hidden="true">${pages.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
        <button class="btn prominent block ob-next" type="button" data-act="obNext">${i < 2 ? 'Continue' : 'Get started'}</button>`,
    };
  }

  // Sign-up: name and mobile number, then a 6-digit code sent by text. A new code can be sent after
  // 30 seconds; a wrong or expired code says so and keeps the way forward open.
  const resendLeft = () => Math.max(0, Math.ceil((S.alex.resendAt - now()) / 1000));
  const resendLine = () => {
    const a = S.alex;
    if (a.codeErr === 'expired' || resendLeft() === 0) return '<button class="btn plain small resend" type="button" data-act="resendCode">Send a new code</button>';
    return `<p class="fnote center" data-bind="resend">You can send a new code in <span class="tnum">0:${String(resendLeft()).padStart(2, '0')}</span>.</p>`;
  };
  const codeMessage = () => {
    const a = S.alex;
    if (a.codeErr === 'wrong') return `<p class="ferr center" id="code-err">${ic.warn}<span>That code didn’t work. Check the text and try again.</span></p>`;
    if (a.codeErr === 'expired') return `<p class="ferr center" id="code-err">${ic.warn}<span>That code has expired. Send a new one.</span></p>`;
    if (a.code.length === 6) return '<p class="fnote center">Checking the code…</p>';
    if (a.codeNote) return `<p class="fnote center">${a.codeNote}</p>`;
    return '';
  };

  function viewSignup() {
    const a = S.alex;
    if (a.signup === 'details') {
      const number = S.dev.badNumber ? '(415) 555-01' : PHONE;
      return {
        key: 'signup-details', cls: 'pad scroll', title: 'Create your account',
        html: `<div class="navrow">${backBtn('signupBack', 'Back')}</div>
          <h1 class="lt">Create your account</h1>
          <p class="muted lede">Your name goes on your live map. Your number keeps the account yours.</p>
          <div class="form">
            <div class="field${a.nameErr ? ' bad' : ''}"><label class="flabel" for="name-ios">Name</label><input class="fin" id="name-ios" type="text" data-input="setName" value="${esc(a.name)}" maxlength="24" autocomplete="name" spellcheck="false" ${a.nameErr ? 'aria-invalid="true" aria-describedby="name-err"' : ''}></div>
            <div class="field${a.numberErr ? ' bad' : ''}"><span class="flabel">Mobile number</span><span class="fval"><span class="cc">US +1${ic.down}</span><span class="tnum" ${a.numberErr ? 'aria-describedby="num-err"' : ''}>${number}</span></span></div>
          </div>
          ${a.nameErr ? `<p class="ferr" id="name-err">${ic.warn}<span>Enter your name. It can be up to 24 characters.</span></p>` : ''}
          ${a.numberErr ? `<p class="ferr" id="num-err">${ic.warn}<span>Enter your full mobile number, like ${PHONE}.</span></p>` : ''}
          ${a.sendErr ? `<p class="ferr" id="send-err">${ic.warn}<span>We couldn’t send the code. Check your connection, then try again.</span></p>` : ''}
          <p class="fnote">People you share with see your name and mascot, never your number.</p>
          <div class="grow"></div>
          <button class="btn prominent block" type="button" data-act="sendCode">${a.sendErr ? 'Try again' : 'Send code'}</button>
          <p class="fine">We’ll text you a 6-digit code. Message and data rates may apply.</p>`,
      };
    }
    const code = a.code;
    const keys = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['', ''], ['0', ''], ['del', '']];
    return {
      key: 'signup-code', cls: 'pad signup-code',
      html: `<div class="navrow">${backBtn('signupBack', 'Back')}</div>
        <h1 class="lt">Enter the code</h1>
        <p class="muted lede">Sent by text to +1 <span class="tnum">${PHONE}</span>.</p>
        <div class="otp${a.codeErr ? ' bad' : ''}" role="group" aria-label="6-digit code" ${a.codeErr ? 'aria-describedby="code-err"' : ''}>${[0, 1, 2, 3, 4, 5].map((k) => `<span class="${code[k] ? 'on' : k === code.length ? 'cur' : ''}">${code[k] || ''}</span>`).join('')}</div>
        ${codeMessage()}
        ${resendLine()}
        <div class="grow"></div>
        <div class="kb">
          <button class="qt" type="button" data-act="fillCode" ${code.length === 6 || a.codeErr === 'expired' ? 'disabled' : ''} aria-label="Fill in code ${CODE} from Messages"><span>From Messages</span><b class="tnum">${CODE.slice(0, 3)} ${CODE.slice(3)}</b></button>
          <div class="keys">${keys.map(([k, l]) => (k
            ? `<button type="button" class="${k === 'del' ? 'fn' : ''}" data-act="typeKey" data-k="${k}" ${k === 'del' ? 'aria-label="Delete"' : ''}>${k === 'del' ? '<b aria-hidden="true">⌫</b>' : `<b>${k}</b>${l ? `<i aria-hidden="true">${l}</i>` : ''}`}</button>`
            : '<span class="blank"></span>')).join('')}</div>
        </div>`,
    };
  }

  // The set tab follows the chosen mascot until someone switches tabs.
  const pickSet = () => S.alex.pickSet || MASCOTS.find((m) => m.id === S.alex.mascot).set;

  function viewPicker() {
    const fromTab = S.alex.pickerFrom === 'tab';
    return {
      key: `picker-${fromTab}`, cls: `pad scroll${fromTab ? ' tabbed' : ''}`, title: 'Your mascot',
      html: `<div class="navrow"><span></span></div>
        <h1 class="lt">Your mascot</h1>
        <p class="muted lede">It marks where you are on the map, for you and whoever follows you.</p>
        ${active() ? '<p class="fnote pick-note">Your new mascot shows from your next share.</p>' : ''}
        <div class="pick-stage"><span class="glow"></span>${mascotImg('stage-img', 152).replace('alt=""', `alt="${mascotLabel()}"`)}</div>
        <h2 class="label">Character</h2>
        <div class="segmented pick-sets" role="group" aria-label="Character set">${SETS.map((t) => `<button type="button" data-act="pickSet" data-id="${t.id}" aria-pressed="${t.id === pickSet()}">${t.name}</button>`).join('')}</div>
        <div class="pick-grid" role="group" aria-label="Character">${MASCOTS.filter((m) => m.set === pickSet()).map((m) => `<button class="pick" type="button" data-act="pickMascot" data-id="${m.id}" aria-pressed="${m.id === S.alex.mascot}"><img src="${ASSET.mascot(m.id, S.alex.color)}" alt="" data-id="${m.id}" onerror="TML.mascotFail(this)">${m.name}${m.id === S.alex.mascot ? `<span class="pick-check">${ic.check}</span>` : ''}</button>`).join('')}</div>
        <h2 class="label">Color</h2>
        <div class="swatches" role="group" aria-label="Color">${COLORS.map((c) => `<button class="swatch" type="button" data-act="pickColor" data-id="${c.id}" aria-pressed="${c.id === S.alex.color}" aria-label="${c.name}" style="background:${swatchFor(c)}">${c.id === S.alex.color ? ic.check : ''}</button>`).join('')}</div>
        <h2 class="label">Accessory</h2>
        ${accFor().length
          ? `<div class="acc-chips" role="group" aria-label="Accessory">${['none', ...accFor()].map((id) => `<button class="acc-chip" type="button" data-act="pickAccessory" data-id="${id}" aria-pressed="${id === S.alex.accessory}">${id === S.alex.accessory ? ic.check : ''}${accName(id)}</button>`).join('')}</div>`
          : '<p class="acc-none">The astronaut’s helmet doesn’t take accessories.</p>'}
        <div class="spacer"></div>
        ${fromTab ? '<div class="tab-room save-room"></div>' : '<button class="btn prominent block" type="button" data-act="savePicker">Continue</button>'}`,
      // From the tab, Save stays pinned above the tab bar.
      after: fromTab ? `<div class="pin-save"><button class="btn prominent block" type="button" data-act="savePicker">Save</button></div>${tabbar('mascot')}` : '',
    };
  }

  function viewHome() {
    const c = S.call.active;
    let card;
    if (active()) {
      card = `<button class="callcard live" type="button" data-act="openLive">
          <span class="row"><span class="badge live"><i></i>LIVE</span>${vn() ? `Sharing with ${vn()}` : 'Sharing live'}</span>
          <span class="ct">${S.mom.sharing ? 'You’re both live. ' : ''}Tap to open the map.</span></button>`;
    } else if (c) {
      card = `<div class="callcard">
          <div class="row"><span class="calldot"></span>On a call · <span class="tnum" data-bind="calltime">00:00</span></div>
          <p>Share your location with the person you’re talking to. They don’t need the app.</p>
          <button class="btn prominent block" type="button" data-act="openShare">${ic.loc}Share live location</button></div>`;
    } else {
      card = `<div class="callcard idle">
          <div class="row">${ic.phone}Not on a call</div>
          <p class="muted">When you’re on a call with Track Me Live open, we’ll offer to share your location. You can also add a one-tap control.</p></div>`;
    }
    // After the first share, and never during a call: how to start sharing in one tap next time.
    const tip = S.alex.everEnded && !S.alex.tipDone && !c && !active()
      ? `<div class="callcard idle tipcard">
          <div class="row ink"><span class="ask-ic">${ic.loc}</span>Share faster during calls</div>
          <p class="muted">Add Track Me Live to Control Center or the Action button. During a call, one tap opens the share screen.</p>
          <div class="sb-btns"><button class="btn plain small" type="button" data-act="tipLater">Not now</button><button class="btn neutral small grow" type="button" data-act="tipHow">Show me how</button></div>
        </div>`
      : '';
    return {
      key: 'home', cls: 'pad scroll tabbed', title: 'Home',
      html: `<p class="kicker">Good evening</p>
        <h1 class="lt">Hi, ${an()}</h1>
        ${card}${tip}
        <div class="hero-card">
          <div class="art">${mascotImg()}</div>
          <div class="hero-tx"><div class="t1">${mascotName()}</div><p class="muted">Your marker on the map.</p>
          <span class="pill ${active() ? 'live' : 'seen'}"><span class="d"></span>${active() ? 'Sharing live' : 'Not sharing'}</span></div>
        </div>
        ${!c && !active() ? `<button class="btn prominent block home-cta" type="button" data-act="openShare">${ic.loc}Share live location</button><p class="fine">You’ll choose who gets the link.</p>` : ''}
        <div class="tab-room"></div>`,
      after: tabbar('home'),
    };
  }

  function viewShare() {
    const c = S.call.active;
    const st = S.session;
    const start = M.bez(M.T_START);
    const vb = [start[0] - 150, start[1] - 88];
    const together = c && st.shareBack;
    return {
      key: 'share', cls: 'pad scroll', title: 'Share where you are',
      html: `<div class="navrow">${backBtn('goHome', 'Home')}${c ? '<span class="pill call"><span class="d"></span>On a call · <span data-bind="calltime">00:00</span></span>' : ''}</div>
        <h1 class="lt">Share where you are</h1>
        <p class="muted lede">${c ? 'The person you’re talking to follows you live in their browser. No app needed.' : 'Whoever gets the link follows you live in their browser. No app needed.'}</p>
        <div class="share-preview" aria-hidden="true">
          ${M.svg(`${vb[0]} ${vb[1]} 350 210`)}
          <div class="mk sharer${st.precision === 'approximate' ? ' approx' : ''}" style="left:150px;top:88px"><div class="area"></div><div class="halo"></div><div class="disc">${mascotImg()}</div><div class="name"><span>You</span></div></div>
          ${together ? `<div class="ghost-mk">+</div><div class="ghost-lbl"><span>${esc(S.alex.viewerName.trim()) || 'Them'}</span></div>` : ''}
          <div class="cap">${together ? '<span class="badge together">LIVE TOGETHER</span><span>You both see one map</span>' : '<span class="badge live"><i></i>LIVE</span><span>They see you move as you go</span>'}</div>
        </div>
        <div class="group"><div class="list">
          <div class="li vrow"><label for="viewer-ios">Who it’s for (optional)</label><span class="vfield"><input id="viewer-ios" type="text" data-input="setViewer" value="${esc(S.alex.viewerName)}" placeholder="Name" maxlength="24" autocomplete="off" spellcheck="false" aria-describedby="viewer-foot"><button class="vclear" type="button" data-act="clearViewer" data-clear-for="viewer-ios" aria-label="Clear the name"${S.alex.viewerName.trim() ? '' : ' hidden'}>${ic.xcircle}</button></span></div>
          <button class="li" type="button" data-act="openTimer">Stops<span class="val">${stopLabel(st.stop)}${ic.chev}</span></button>
          <button class="li" type="button" data-act="openMenu" data-menu="precision" aria-haspopup="menu" aria-expanded="${S.alex.menu === 'precision'}">Location<span class="val">${st.precision === 'precise' ? 'Precise' : 'Approximate'}${ic.updown}</span></button>
          ${c ? `<label class="li"><span class="li-tx"><span>Let them share back</span><span class="li-sub">Only during this call.</span></span><span class="switch viewer"><input type="checkbox" role="switch" data-change="toggleShareBack" ${st.shareBack ? 'checked' : ''} aria-label="Let them share back"><span></span></span></label>` : ''}
        </div><p class="foot" id="viewer-foot">Only you see the name. They see your name and mascot.</p></div>
        <div class="spacer"></div>
        <button class="btn prominent block" type="button" data-act="openShareSheet">${ic.loc}Share live location</button>
        <p class="fine">Next, choose who gets the link.</p>`,
    };
  }

  function momState() {
    if (S.mom.sharing) return { av: 'viewer', t2: dual('Sharing back · updated just now', 'Sharing back, updated now', 'momDetail', 'momDetailSr'), st: 'viewer', word: 'Live' };
    if (!S.session.viewedAt) return { av: 'viewer off', t2: dual('Link sent · not opened yet', 'Link sent, not opened yet'), st: 'idle', word: 'Waiting' };
    // Ask to share: once per call, only during the session's own call, and only if share back is on.
    const canAsk = callActive() && S.session.shareBack && S.askedCall !== S.session.callId;
    const t2 = S.session.askedAt ? `Asked at ${fmt(S.session.askedAt)}` : `Opened at ${fmt(S.session.viewedAt)}`;
    return { av: 'viewer', t2, st: 'idle', word: 'Watching', canAsk };
  }

  // The first tile: the distance once they share back; before that, who it's waiting for.
  const distTile = () => (S.mom.sharing
    ? { v: distance(), l: 'apart', bind: 'distance', spoken: `Distance, ${distanceSpoken()}` }
    : shareBackPossible() ? { v: 'Waiting', l: `for ${who.them()} to share`, bind: '', spoken: `Waiting for ${who.them()} to share` }
      : { v: '—', l: 'not shared', bind: '', spoken: 'Distance not shared' });

  function viewLive() {
    const c = callActive();
    const lost = quiet();
    const ms = momState();
    const together = S.mom.sharing;
    // No Back to call button on iPhone: the green call pill in the status bar returns to the call.
    const bar = c
      ? `<span class="calldot"></span><div class="txt"><span class="t1">On a call</span><span class="t2"><span data-bind="calltime">00:00</span></span></div>`
      : `<div class="av sharer bar-av">${sessionMascotImg('', 30)}</div><div class="txt"><span class="t1">Sharing live</span><span class="t2">Stops at ${fmt(endAt())}</span></div>`;
    return {
      key: 'live', withMap: true, cls: 'mapcol',
      html: `<div class="glassbar">${bar}<button class="icon-btn" type="button" data-act="goHome" aria-label="Home">${ic.home}</button></div>
        <div class="sheet">
          <div class="grab" aria-hidden="true"></div>
          <div class="head">
            <div class="title"><h2 tabindex="-1">${together ? 'Live Together' : 'Sharing live'}</h2>${liveBadge()}</div>
            <p class="sub">${liveSub()}</p>
            ${limitSoon() ? `<p class="limit-line">${ic.clock}<span>${limitLine()}</span></p>` : ''}
          </div>
          ${tilesHtml()}
          <div class="people">
            <div class="person"><div class="av sharer" aria-hidden="true">${sessionMascotImg()}</div><div class="txt"><span class="t1">You</span><span class="t2">${dual(alexDetail(), alexDetailSpoken(), 'alexDetail', 'alexDetailSr')}</span></div>
              <span class="st ${lost ? 'idle' : 'sharer'}"><span class="d"></span>${lost ? 'Last seen' : 'Live'}</span></div>
            <div class="person"><div class="av ${ms.av}" aria-hidden="true">${viewerMark()}</div><div class="txt"><span class="t1">${who.label()}</span><span class="t2">${ms.t2}</span></div>
              ${ms.canAsk ? '<button class="btn ask" type="button" data-act="askShare">Ask to share</button>' : `<span class="st ${ms.st}"><span class="d"></span>${ms.word}</span>`}</div>
            ${sbNoteHtml()}
            ${precisionRow()}
          </div>
          <div class="actions">
            <button class="btn neutral" type="button" data-act="openTimer">Change timer</button>
            <button class="btn neutral" type="button" data-act="openShareSheet">${ic.send}Send link again</button>
          </div>
          <button class="btn destructive block" type="button" data-act="askStop">Stop sharing</button>
        </div>`,
    };
  }

  // Precise or Approximate while sharing: the change takes effect from the next ping.
  function precisionRow() {
    const pend = S.session.precisionNext;
    const shown = pend || S.session.precision;
    const off = S.alex.perm.precise === false;
    const b = (v, l) => (v === shown ? `<button type="button" aria-pressed="true">${l}</button>`
      : off && v === 'precise' ? `<button type="button" aria-pressed="false" aria-disabled="true">${l}</button>`
        : `<button type="button" aria-pressed="false" data-act="togglePrecision">${l}</button>`);
    const note = pend ? 'From the next update' : off ? 'Precise is off in Settings' : approx() ? 'Within about 500 m' : 'Your exact spot';
    return `<div class="person loc-row"><div class="txt"><span class="t1" id="lr-lbl">Location</span><span class="t2">${note}</span></div>
      <div class="segmented" role="group" aria-labelledby="lr-lbl">${b('precise', 'Precise')}${b('approximate', 'Approximate')}</div></div>`;
  }

  function viewEnded() {
    const s = S.session;
    const limit = s.reason === 'limit';
    const n = vn();
    return {
      key: 'ended', cls: 'pad scroll ended',
      html: `<div class="ended-body">
          <div class="ended-art" aria-hidden="true"><span class="ring"></span>${sessionMascotImg('', 128, 'opacity:.85;')}</div>
          <h1 class="lt center" tabindex="-1">${limit ? 'Sharing stopped after 1 hour' : 'Sharing ended'}</h1>
          <p class="muted center">${endedWhy(s)}</p>
          <div class="summary">
            ${n ? `<div class="row"><span>Shared with</span><b>${n}</b></div>` : ''}
            <div class="row"><span>Shared for</span><b>${minutes(s.endedAt - s.startedAt)}</b></div>
            <div class="row"><span>${n ? `${n} opened it` : 'Link opened'}</span><b>${s.viewedAt ? fmt(s.viewedAt) : 'Not opened'}</b></div>
            <div class="row"><span>${n ? `${n} shared back` : 'Shared back'}</span><b>${S.mom.everShared ? 'Yes' : 'No'}</b></div>
          </div>
          <p class="fine">${deletedBy(s)}</p>
        </div>
        ${limit
          ? `<button class="btn prominent block" type="button" data-act="shareAgain">${ic.loc}Share again</button><button class="btn plain block" type="button" data-act="done">Done</button>`
          : '<button class="btn prominent block" type="button" data-act="done">Done</button>'}`,
    };
  }

  function viewSettings() {
    const st = S.alex.settings;
    const sw = (key, label, sub) => `<label class="li"><span class="li-tx">${label}${sub ? `<span class="li-sub">${sub}</span>` : ''}</span><span class="switch"><input type="checkbox" role="switch" data-change="setting" data-key="${key}" ${st[key] ? 'checked' : ''} aria-label="${label}"><span></span></span></label>`;
    const seg = (name, val, opts, label) => `<div class="segmented" role="group" aria-label="${label}">${opts.map(([v, l]) => `<button type="button" data-act="${name}" data-v="${v}" aria-pressed="${v === val}">${l}</button>`).join('')}</div>`;
    const locWord = { unset: 'Not set', while: 'While using the app', once: 'Ask next time', ask: 'Ask next time', denied: 'Off' }[S.alex.perm.loc];
    const notifWord = { unset: 'Not set', allowed: 'Allowed', denied: 'Off' }[S.alex.perm.notif];
    return {
      key: 'settings', cls: 'pad scroll tabbed', title: 'Settings',
      html: `<div class="navrow"><span></span></div>
        <h1 class="lt">Settings</h1>
        <div class="grouped">
          <div class="group"><h2>Sharing</h2><div class="list">
            ${sw('offer', 'Offer to share when I’m on a call', 'When Track Me Live is open')}
            <div class="li stack"><span id="lbl-precision">Location detail</span>${seg('setPrecision', st.precision, [['precise', 'Precise'], ['approximate', 'Approximate']], 'Location detail')}</div>
            <button class="li" type="button" data-act="openTimer" data-for="default">Default stop time<span class="val">${stopLabel(st.defaultStop)}${ic.chev}</span></button>
          </div></div>
          <div class="group"><h2>Live Together</h2><div class="list">${sw('shareBack', 'Let people share back', 'Only during a call. Off for each call if you turn it off.')}</div></div>
          <div class="group"><h2>Alerts</h2><div class="list">
            ${sw('alertOpened', 'When my link is opened')}${sw('alertCall', 'When a call ends while I’m sharing')}${sw('alertExpiry', 'When sharing expires')}
          </div></div>
          <div class="group"><h2>Appearance</h2><div class="list"><div class="li stack">${seg('setTheme', S.theme, [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], 'Appearance')}</div></div></div>
          <div class="group"><h2>Permissions</h2><div class="list">
            <button class="li" type="button" data-act="permLoc"><span class="li-tx"><span>Location</span>${S.alex.perm.loc === 'while' || S.alex.perm.loc === 'once' || S.alex.perm.loc === 'ask' ? `<span class="li-sub">Precise: ${S.alex.perm.precise === false ? 'Off' : 'On'}</span>` : ''}</span><span class="val">${locWord}${S.alex.perm.loc === 'while' ? '' : ic.chev}</span></button>
            <button class="li" type="button" data-act="permNotif">Notifications<span class="val">${notifWord}${S.alex.perm.notif === 'allowed' ? '' : ic.chev}</span></button>
          </div><p class="foot">Sharing starts while the app is open and keeps going in the background until it stops. If Live Activities are off, sharing still works, and the location arrow in the status bar shows it.</p></div>
          <div class="group"><h2>Your data</h2><div class="list"><button class="li danger" type="button" data-act="askDelete">Delete account and all data</button></div>
            <p class="foot">Location points are deleted 24 hours after a session ends. Session details are kept for 30 days, then deleted.</p></div>
        </div>
        <div class="tab-room"></div>`,
      after: tabbar('settings'),
    };
  }

  // The stop rules on offer: the call only while there's one to follow; never past the 1-hour limit.
  function stopOptions(forDefault) {
    if (forDefault) return ['call', 15, 30, 60];
    const callOk = active() ? callActive() : S.call.active;
    const opts = callOk ? ['call'] : [];
    if (!active()) return opts.concat([15, 30, 60]);
    [15, 30, 60].forEach((m) => { if (now() + m * 60000 < S.session.expiresAt) opts.push(m); });
    return opts.concat(['limit']);
  }
  const shareSheetUntil = () => (S.session.stop === 'call' ? 'until the call ends'
    : active() ? `until ${fmt(endAt())}` : S.session.stop === 'limit' ? 'for 1 hour' : `for ${S.session.stop} min`);

  function topAlex() {
    const a = S.alex;
    let html = '';
    if (a.modal === 'timer') {
      const forDefault = a.modalFor === 'default';
      const cur = forDefault ? a.settings.defaultStop : S.session.stop;
      const title = forDefault ? 'Default stop time' : 'When sharing stops';
      html += `<div class="scrim" data-act="closeModal"></div>
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="tm-t" data-esc="closeModal">
          <div class="mhead"><h2 id="tm-t">${title}</h2><button class="close" type="button" data-act="closeModal" aria-label="Close">${ic.x}</button></div>
          <div class="choices" role="radiogroup" aria-labelledby="tm-t">${stopOptions(forDefault).map((v) => { const on = String(v) === String(cur); return `<button class="choice" type="button" role="radio" aria-checked="${on}" data-act="setStop" data-v="${v}"${on ? ' data-autofocus' : ''}>${stopLabel(v)}${on ? ic.check : ''}</button>`; }).join('')}</div>
          <p class="fine">Sharing never runs longer than 1 hour.${!forDefault && (active() ? callActive() : S.call.active) ? ' If the call drops and you’ve set a timer, sharing continues until it runs out.' : ''}</p>
        </div>`;
    }
    if (a.modal === 'sharesheet') {
      // The system share sheet: neutral contacts and app glyphs. The app never knows who is on the call.
      const people = ['Mom', 'Dad', 'Sam', 'Priya'];
      const nextLink = active() ? link() : linkFor(S.session.n + 1);
      html += `<div class="scrim" data-act="closeModal"></div>
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="ss-t" data-esc="closeModal">
          <div class="mhead"><h2 id="ss-t">${active() ? 'Send your link again' : 'Send your link'}</h2><button class="close" type="button" data-act="closeModal" aria-label="Close">${ic.x}</button></div>
          <div class="share-link"><div class="ic"><img src="${ASSET.logo('app-icon-default.svg')}" alt=""></div><div><b>${an()} · Live location</b><span>${nextLink} · ${shareSheetUntil()}</span></div></div>
          <div><h3 class="label">People</h3><div class="people-row">${people.map((n) => `<button class="contact" type="button" data-act="sendTo" data-to="${n}"><span class="ph">${n[0]}</span>${n}</button>`).join('')}</div></div>
          <div><h3 class="label">Apps</h3><div class="apps-row">
            <button class="app" type="button" data-act="sendTo" data-to="Mom"><span class="sq">${ic.bubble}</span>Messages</button>
            <button class="app" type="button" data-act="sendTo" data-to="Mail"><span class="sq">${ic.mail}</span>Mail</button>
            <button class="app" type="button" data-act="sendTo" data-to="Copy"><span class="sq">${ic.copy}</span>Copy link</button>
            <button class="app" type="button" data-act="sendTo" data-to="More"><span class="sq">${ic.more}</span>More</button>
          </div></div>
        </div>`;
    }
    if (a.modal === 'quickhow') {
      const steps = ['Swipe down from the top-right corner to open Control Center.', 'Touch and hold an empty space, then tap Add a Control.', 'Search for Track Me Live, then tap Share location.'];
      html += `<div class="scrim" data-act="closeModal"></div>
        <div class="modal" role="dialog" aria-modal="true" aria-label="Share faster during calls" data-esc="closeModal">
          <div class="mhead"><h2>Share faster during calls</h2><button class="close" type="button" data-act="closeModal" aria-label="Close">${ic.x}</button></div>
          <div class="qh-prev" data-theme="dark" aria-hidden="true"><span class="cc-mod cc-tml"><span class="g">${ic.loc}</span><span class="t"><b>Share location</b><small>Track Me Live</small></span></span></div>
          <ol class="qh-steps">${steps.map((t, i) => `<li><b aria-hidden="true">${i + 1}</b><span>${t}</span></li>`).join('')}</ol>
          <p class="fine">On an iPhone with an Action button, you can also choose it in Settings, under Action Button. iOS doesn’t let apps add it for you.</p>
          <button class="btn neutral block" type="button" data-act="tipDone">Done</button>
        </div>`;
    }
    if (a.menu === 'precision') {
      const at = a.menuAt || { top: 420 };
      const item = (v, l, sub) => `<button class="menu-item" type="button" role="menuitemradio" aria-checked="${S.session.precision === v}" data-act="setSessionPrecision" data-v="${v}"${S.session.precision === v ? ' data-autofocus' : ''}><span class="mi-check" aria-hidden="true">${S.session.precision === v ? ic.check : ''}</span><span class="mi-tx"><span>${l}</span><small>${sub}</small></span></button>`;
      html += `<div class="menu-scrim" data-act="closeMenu"></div>
        <div class="menu" role="menu" aria-label="Location detail" data-esc="closeMenu" style="top:${at.top}px">
          ${S.alex.perm.precise === false ? `<button class="menu-item" type="button" role="menuitemradio" aria-checked="false" aria-disabled="true" disabled><span class="mi-check" aria-hidden="true"></span><span class="mi-tx"><span>Precise</span><small>Precise is off in Settings</small></span></button>` : item('precise', 'Precise', 'Your exact spot')}${item('approximate', 'Approximate', 'Within about 500 m')}
        </div>`;
    }
    if (a.alert === 'stop') {
      html += `<div class="scrim"></div><div class="alert" role="alertdialog" aria-modal="true" aria-labelledby="al-t" aria-describedby="al-d" data-esc="cancelAlert"><div class="body"><b id="al-t">Stop sharing your location?</b><p id="al-d">${S.session.viewedAt ? `${vn() ? `${vn()} will` : 'They’ll'} see that sharing ended.` : 'Your link will stop working.'}</p></div>
        <div class="btns"><button class="btn neutral" type="button" data-act="cancelAlert" data-autofocus>Cancel</button><button class="btn danger" type="button" data-act="confirmStop">Stop</button></div></div>`;
    }
    if (a.alert === 'delete') {
      html += `<div class="scrim"></div><div class="alert" role="alertdialog" aria-modal="true" aria-labelledby="al-t" aria-describedby="al-d" data-esc="cancelAlert"><div class="body"><b id="al-t">Delete your account?</b><p id="al-d">This deletes your profile, mascot and every session right away. You can’t undo it.</p></div>
        <div class="btns"><button class="btn neutral" type="button" data-act="cancelAlert" data-autofocus>Cancel</button><button class="btn danger" type="button" data-act="deleteAccount">Delete</button></div></div>`;
    }
    html += permPrompt();
    if (a.cc) html += controlCenter();
    html += bannerIOS();
    return html;
  }

  // What the app says on the iPhone: system notifications only when they're allowed; while the app
  // is open, its own messages are a glass capsule under the top bar, and the call offer an in-app banner.
  const inAppIOS = () => !['call', 'splash'].includes(S.alex.screen);
  const bannerText = (b) => b.snack || `${b.title}. ${b.body}`;
  function bannerIOS() {
    const b = S.alex.banner;
    if (!b) return '';
    if (b.kind === 'push' && S.alex.perm.notif === 'allowed') {
      return `<button class="banner" type="button" data-act="${b.act || 'dismissBanner'}" data-banner="${b.id}"><span class="appic"><img src="${ASSET.logo('app-icon-default.svg')}" alt=""></span><span class="txt"><span class="meta"><span>Track Me Live</span><span>now</span></span><b>${b.title}</b><p>${b.body}</p></span></button>`;
    }
    if (!inAppIOS() || S.alex.cc) return '';
    if (b.kind === 'offer' && S.alex.screen === 'home') return '';
    if (b.kind === 'offer') {
      return `<div class="offer" data-banner="${b.id}"><div class="otx"><b>${b.title}</b><span>${b.body}</span></div><button class="btn prominent small" type="button" data-act="${b.act}">Share</button><button class="ox" type="button" data-act="dismissBanner" aria-label="Not now">${ic.x}</button></div>`;
    }
    return `<div class="toast ${S.alex.screen === 'live' ? 'below-bar' : ''}" data-banner="${b.id}" aria-hidden="true">${bannerText(b)}</div>`;
  }

  // Control Center, a stand-in for iOS's own, with the Track Me Live control in it.
  function controlCenter() {
    const c = (g, label, on) => `<span class="cc-mod cc-c${on ? ` ${on}` : ''}" aria-label="${label}" role="img">${g}</span>`;
    return `<div class="ccenter" data-theme="dark" role="dialog" aria-modal="true" aria-label="Control Center" data-esc="ccClose">
        <button class="cc-bg" type="button" data-act="ccClose" aria-label="Close Control Center"></button>
        <div class="cc-top" aria-hidden="true">${cg.plus}${cg.power}</div>
        <div class="cc-grid">
          <span class="cc-mod cc-conn" aria-hidden="true"><i>${cg.plane}</i><i class="green">${cg.cell}</i><i class="blue">${cg.wifi}</i><i class="blue">${cg.bt}</i></span>
          <span class="cc-mod cc-media" aria-hidden="true"><span class="lbl">Not Playing</span><span class="ctl"><i class="flip">${cg.skip}</i><i>${cg.play}</i><i>${cg.skip}</i></span></span>
          <span class="cc-mod cc-focus" aria-hidden="true"><span class="g">${cg.moon}</span><b>Focus</b></span>
          <span class="cc-mod cc-slider" aria-hidden="true"><span class="fill" style="height:62%"></span><i>${cg.sun}</i></span>
          <span class="cc-mod cc-slider" aria-hidden="true"><span class="fill" style="height:40%"></span><i>${cg.vol}</i></span>
          <button class="cc-mod cc-tml" type="button" data-act="ccShare"><span class="g">${ic.loc}</span><span class="t"><b>Share location</b><small>Track Me Live</small></span></button>
          ${c(cg.torch, 'Flashlight')}${c(cg.rot, 'Orientation lock')}${c(ic.clock, 'Timer')}${c(cg.camera, 'Camera')}
        </div>
      </div>`;
  }

  // In-app explainers come first; the system prompts are generic stand-ins for iOS's own alerts.
  function permPrompt() {
    const sysMap = () => {
      const p = M.bez(M.T_START);
      // iOS's Precise switch on the prompt: off, the app gets an approximate location.
      const on = S.alex.perm.precise !== false;
      return `<div class="sysmap${on ? '' : ' approx'}"><div class="sysmap-art" aria-hidden="true">${M.svg(`${p[0] - 115} ${p[1] - 60} 230 120`)}<span class="pin"></span></div><button class="prec" type="button" role="switch" aria-checked="${on}" data-act="locPrecise">${ic.loc}Precise: ${on ? 'On' : 'Off'}</button></div>`;
    };
    const ask = (icon, title, body, yes, yesAct, noAct) => `<div class="scrim"></div>
      <div class="modal ask" role="dialog" aria-modal="true" aria-labelledby="ask-t" aria-describedby="ask-d" data-esc="${noAct}">
        <div class="ask-art" aria-hidden="true"><span>${icon}</span></div>
        <h2 id="ask-t">${title}</h2><p id="ask-d">${body}</p>
        <button class="btn prominent block" type="button" data-act="${yesAct}">${yes}</button>
        <button class="btn plain block" type="button" data-act="${noAct}">Not now</button>
      </div>`;
    switch (S.alex.sys) {
      case 'locPre':
        return ask(ic.loc, 'Allow location to share', 'Track Me Live uses your location only while you’re sharing. Nobody sees it until you send your link, and it stops when you do.', 'Continue', 'locContinue', 'sysClose');
      case 'locSys':
        return `<div class="scrim"></div><div class="sysalert" role="alertdialog" aria-modal="true" aria-label="Location permission">
          <b>Allow “Track Me Live” to use your location?</b>
          <p>Your location is shared only with people you send your link to, and only until sharing stops.</p>
          ${sysMap()}
          <div class="sysbtns"><button class="btn" type="button" data-act="locOnce">Allow Once</button><button class="btn" type="button" data-act="locAllow">Allow While Using App</button><button class="btn" type="button" data-act="locDeny">Don’t Allow</button></div></div>`;
      case 'locOff':
        // Long button labels wrap in a two-up row, so these stack.
        return `<div class="scrim"></div><div class="alert" role="alertdialog" aria-modal="true" aria-labelledby="al-t" aria-describedby="al-d" data-esc="sysClose"><div class="body"><b id="al-t">Location is off for Track Me Live</b><p id="al-d">To share where you are, turn on location in Settings. It’s only used while you share.</p></div>
          <div class="btns stack"><button class="btn prominent" type="button" data-act="locSettings">Open Settings</button><button class="btn neutral" type="button" data-act="sysClose" data-autofocus>Not now</button></div></div>`;
      case 'notifPre':
        return ask(ic.bell, vn() ? `Know when ${vn()} opens it` : 'Know when your link is opened', 'Turn on alerts to hear when your link is opened, when a call ends while you’re sharing, and when sharing stops.', 'Turn on alerts', 'notifContinue', 'notifLater');
      case 'notifOff':
        return `<div class="scrim"></div><div class="alert" role="alertdialog" aria-modal="true" aria-labelledby="al-t" aria-describedby="al-d" data-esc="sysClose"><div class="body"><b id="al-t">Notifications are off</b><p id="al-d">To hear when your link is opened and when sharing stops, turn on notifications for Track Me Live in Settings.</p></div>
          <div class="btns stack"><button class="btn prominent" type="button" data-act="notifSettings">Open Settings</button><button class="btn neutral" type="button" data-act="sysClose" data-autofocus>Not now</button></div></div>`;
      case 'notifSys':
        return `<div class="scrim"></div><div class="sysalert" role="alertdialog" aria-modal="true" aria-label="Notifications permission">
          <b>“Track Me Live” would like to send you notifications</b>
          <p>Notifications may include alerts, sounds and icon badges. These can be configured in Settings.</p>
          <div class="sysbtns row"><button class="btn" type="button" data-act="notifDeny">Don’t Allow</button><button class="btn pref" type="button" data-act="notifAllow">Allow</button></div></div>`;
      default:
        return '';
    }
  }

  // ---------- Mom's screens ----------
  // Mom's page is a real web page: a <main> with one h1 per state, the map as a labelled region,
  // where Alex is in words, and a document title per state (the prototype keeps it on the screen
  // as data-doc-title, since both phones share one document).
  const DOC = (t) => `${t} · Track Me Live`;
  function viewMom() {
    const m = S.mom;
    if (m.screen === 'call') return callScreen('mom');
    if (m.screen === 'expired' || m.screen === 'invalid') return {
      key: m.screen, cls: 'expired', browser: true, docTitle: DOC(m.screen === 'invalid' ? 'This link doesn’t work' : 'Location no longer shared'),
      html: `${m.screen === 'invalid' ? invalidPage() : expiredPage()}
        <div class="urlbar" aria-hidden="true"><span>${ic.lock}trackme.live</span></div>`,
    };
    if (m.screen === 'page' || m.screen === 'ended') return viewViewerPage();
    return {
      key: 'lock', cls: 'lockscreen', darkChrome: true,
      html: `<div class="wall" data-theme="dark" aria-hidden="true">${M.svg('0 0 390 844')}</div><div class="date">Saturday, October 17</div><div class="time" data-bind="clockBig">9:38</div>`,
    };
  }

  // The link page is the same website on every phone; only the browser around it changes. It uses
  // inline SVG icons, never an icon font. The browser's own bars are not part of the page.
  const brandfoot = () => `<footer class="brandfoot"><img class="logo-on-light" src="${ASSET.logo('logo-horizontal.svg')}" alt="Track Me Live"><img class="logo-on-dark" src="${ASSET.logo('logo-horizontal-on-dark.svg')}" alt="Track Me Live"></footer>`;
  const expiredPage = () => `<main class="vp-msg"><div class="ring" aria-hidden="true">${sessionMascotImg()}</div><h1 tabindex="-1">This location is no longer being shared</h1><p class="muted">Ask ${an()} to share again if you still need it.</p></main>${brandfoot()}`;
  // A link that never worked (mistyped or cut off) is not the same as one that ended.
  const invalidPage = () => `<main class="vp-msg"><div class="ring broken" aria-hidden="true">${ic.link}</div><h1 tabindex="-1">This link doesn’t work</h1><p class="muted">Check that you have the whole link, or ask the person who sent it to send it again.</p></main>${brandfoot()}`;

  function viewViewerPage() {
    const p = viewerParts(ic);
    return {
      key: p.key, withMap: true, browser: true, dim: p.ended, mapFailed: p.mapFailed, docTitle: p.docTitle,
      html: `${p.page}<div class="urlbar" aria-hidden="true"><span>${ic.lock}trackme.live</span></div>`,
    };
  }

  // "Open in Maps": the rounded point on approximate shares, as coordinates (the map is 6 m per px).
  const geo = (p) => {
    const lat = 37.7955 - (p[1] * 6) / 111320;
    const lng = -122.3937 + (p[0] * 6) / (111320 * Math.cos((lat * Math.PI) / 180));
    return [lat.toFixed(5), lng.toFixed(5)];
  };
  const mapsHref = (p) => {
    const [lat, lng] = geo(p);
    return S.platform === 'android' ? `https://www.google.com/maps/search/?api=1&amp;query=${lat},${lng}` : `https://maps.apple.com/?ll=${lat},${lng}&amp;q=${encodeURIComponent(S.alex.name || 'Alex')}`;
  };
  // Where Alex is, in words: the nearest street or park, and once Mom shares back, how far and which way.
  function whereNow() {
    const m = S.mom;
    const ended = m.screen === 'ended';
    const f = m.frozen;
    const pos = ended && f ? f.pos : sharedPos();
    return M.whereWords(pos, m.sharing && !ended ? S.world.mom : null, ended && f ? f.approx : approx(), ended || quiet());
  }
  // The page's h1, per state. Focus moves here when what was focused goes away.
  function momHeading() {
    const m = S.mom;
    const f = m.frozen;
    if (m.screen === 'ended') {
      const endedAt = f ? f.endedAt : S.session.endedAt;
      const stopped = f ? f.reason === 'stopped' : S.session.reason === 'stopped';
      return stopped ? `${an()} stopped sharing at ${fmt(endedAt)}` : `Sharing ended at ${fmt(endedAt)}`;
    }
    if (quiet()) return `${an()}’s signal dropped`;
    if (m.sharing) return 'You’re both live';
    return `${an()} is sharing their location with you`;
  }

  function viewerParts(icons) {
    const ic = icons;
    const m = S.mom;
    if (m.loading) {
      // While the page trades the link for a session: a skeleton, never a blank map.
      return { key: 'viewer-loading', ended: false, docTitle: DOC('Loading'), page: `<main class="vp" aria-busy="true"><div class="glassbar skel" aria-hidden="true"><span class="sk av"></span><span class="sk-lines"><span class="sk w60"></span><span class="sk w40"></span></span></div><div class="vp-body"><div class="vp-gap"></div>
        <div class="sheet skel"><div class="grab" aria-hidden="true"></div><span class="sk w70 tall" aria-hidden="true"></span><span class="sk w90" aria-hidden="true"></span><span class="sk w50" aria-hidden="true"></span><h1 class="sr-only" tabindex="-1">Loading ${an()}’s location</h1></div></div></main>` };
    }
    const ended = m.screen === 'ended';
    const f = m.frozen;
    const live = callActive();
    const lost = quiet() && !ended;
    const sharing = m.sharing;
    // Share back: only during the session's own call, only when Alex allows it.
    const offerBack = !ended && live && S.session.shareBack && !sharing;
    const endedAt = f ? f.endedAt : S.session.endedAt;
    const statusVis = ended ? `Sharing ended at ${fmt(endedAt)}` : lost ? `Last seen ${fmt(S.world.alexLast)}` : 'Live · updated just now';
    const statusSr = ended ? statusVis : lost ? `Last seen at ${fmt(S.world.alexLast)}` : 'Live, updated now';
    const bar = `<div class="av sharer" aria-hidden="true">${sessionMascotImg('', 32)}</div>
      <div class="txt"><span class="t1">${an()}</span><span class="t2"><span class="d ${ended || lost ? 'seen' : ''}" aria-hidden="true"></span>${dual(statusVis, statusSr, ended || lost ? '' : 'alexStatus', ended || lost ? '' : 'alexStatusSr')}</span></div>
      ${live && !ended ? '<span class="pill call"><span class="d" aria-hidden="true"></span>On your call</span>' : ''}`;
    const failed = m.mapFailed && !ended
      ? `<div class="map-failed"><span class="mf-ic" aria-hidden="true">${ic.map}</span><b>The map didn’t load</b><span>${lost ? `${an()} was last seen at ${fmt(S.world.alexLast)}.` : `${an()} is still sharing. Where they are is written below.`}</span><button class="btn neutral small" type="button" data-act="retryMap">Try again</button></div>`
      : '';
    const h1 = momHeading();
    const w = whereNow();
    const where = `<p class="where"><span class="wi" aria-hidden="true">${ic.pin}</span><span class="wt">${dual(w.text, w.spoken, ended ? '' : 'where', ended ? '' : 'whereSr')}</span></p>`;
    const pos = ended && f ? f.pos : sharedPos();
    const whereBtns = ended ? '' : `<div class="where-btns">${m.mapFailed ? '' : `<button class="btn neutral small" type="button" data-act="showAlex">${ic.target}Show ${an()}</button>`}<a class="btn neutral small" href="${mapsHref(pos)}" data-act="openMaps" rel="noopener">${ic.map}Open in Maps</a></div>`;
    const head = (badgeHtml, sub) => `<div class="head">
        <div class="title"><h1 id="vp-h1" tabindex="-1">${h1}</h1>${badgeHtml}</div>
        ${where}
        <p class="sub">${sub}</p>
        ${whereBtns}</div>`;
    let body;
    if (ended) {
      body = head('<span class="pill ended"><span class="d" aria-hidden="true"></span>Ended</span>', `The map shows where ${an()} was when sharing stopped. It won’t move again.`);
    } else if (sharing) {
      const peopleRows = `<div class="people">
          <div class="person"><div class="av sharer" aria-hidden="true">${sessionMascotImg()}</div><div class="txt"><span class="t1">${an()}</span><span class="t2">${lost ? `Last seen ${fmt(S.world.alexLast)}` : dual(`Updated just now · ${approx() ? 'approximate' : 'precise'}`, `Updated now, ${approx() ? 'approximate' : 'precise'}`, 'alexDetailViewer', 'alexDetailViewerSr')}</span></div><span class="st ${lost ? 'idle' : 'sharer'}"><span class="d" aria-hidden="true"></span>${lost ? 'Last seen' : 'Live'}</span></div>
          <div class="person"><div class="av viewer" aria-hidden="true">${M.PERSON}</div><div class="txt"><span class="t1">You</span><span class="t2">Sharing since ${fmt(m.sharedAt)}</span></div><span class="st viewer"><span class="d" aria-hidden="true"></span>Live</span></div>
        </div>
        <button class="btn destructive block" type="button" data-act="stopMine" data-guard>Stop sharing my location</button>`;
      body = lost
        ? `${head(badge('seen', 'NO SIGNAL', 'No GPS signal'), `This is where ${an()} was last seen at ${fmt(S.world.alexLast)}. You’re still sharing with ${an()}.`)}${peopleRows}`
        : `${head(badge('together', 'LIVE TOGETHER', 'Live Together'), `${an()} can see you now. This stops by itself when your call ends.`)}${peopleRows}`;
    } else {
      const until = S.session.stop === 'call' && live ? 'Visible until your call ends.' : `Visible until ${fmt(endAt())}.`;
      const asked = S.session.askedAt && S.askedCall === S.session.callId;
      const askedLine = asked ? `<div class="ask-line" id="sb-ask"><span class="av sharer" aria-hidden="true">${sessionMascotImg('', 20)}</span>${an()} asked to see where you are</div>` : '';
      let card = '';
      if (offerBack && m.noGeo) {
        card = `<div class="shareback off">${askedLine}<div class="row"><span class="ico muted-ico" aria-hidden="true">${ic.warn}</span><div><div class="t1">This browser can’t share your location</div><div class="t2">Open the link in Safari or Chrome to share back. You can still see Alex here.</div></div></div></div>`;
      } else if (offerBack && m.denied) {
        card = `<div class="shareback off">${askedLine}<div class="row"><span class="ico muted-ico" aria-hidden="true">${ic.lock}</span><div><div class="t1" id="sb-off">Location is off for this page</div><div class="t2" id="sb-off-d">To share, allow location for trackme.live in your browser settings.</div></div></div>
          <button class="btn neutral block" type="button" data-act="askPermission" aria-describedby="sb-off sb-off-d">Try again</button></div>`;
      } else if (offerBack && !m.dismissed) {
        card = `<div class="shareback${asked ? ' asked' : ''}">${askedLine}<div class="row"><span class="ico" aria-hidden="true">${ic.loc}</span><div><div class="t1">Let ${an()} see you too</div><div class="t2" id="sb-t2">Only during this call. Nothing to install.</div></div></div>
          <div class="sb-btns"><button class="btn plain small" type="button" data-act="dismissShareBack">Not now</button><button class="btn viewer small grow" type="button" data-act="askPermission" aria-describedby="${asked ? 'sb-ask ' : ''}sb-t2 sb-hint">Share my location</button></div></div>
          <p class="fine" id="sb-hint">Your browser will ask for permission first.</p>`;
      } else if (offerBack) {
        card = `<button class="btn plain block" type="button" data-act="askPermission" aria-describedby="${asked ? 'sb-ask ' : ''}sb-hint">${ic.loc}Share my location with ${an()}</button>
          <p class="fine" id="sb-hint">Only during this call. Your browser will ask first.</p>`;
        if (asked) card = `<div class="ask-solo">${askedLine}</div>${card}`;
      }
      body = `${head('', lost ? `No update for a moment. This is where ${an()} was last seen.` : until)}${card}`;
    }
    const title = ended ? (h1.startsWith('Sharing ended') ? 'Sharing ended' : `${an()} stopped sharing`) : lost ? `${an()}’s signal dropped` : sharing ? 'You’re both live' : `${an()} is sharing their location`;
    return {
      key: `viewer-${ended ? 'ended' : 'live'}`, ended, mapFailed: m.mapFailed && !ended, docTitle: DOC(title),
      page: `<main class="vp" aria-labelledby="vp-h1"><div class="glassbar">${bar}</div><div class="vp-body"><div class="vp-gap">${failed}</div><div class="sheet"><div class="grab" aria-hidden="true"></div>${body}</div></div></main>`,
    };
  }

  // Overlays of Mom's page itself (not the browser's): the same on every phone, so render() adds
  // them after either platform's browser layer.
  function mapsAsk() {
    if (!S.mom.mapsAsk) return '';
    // Opening the Maps app leaves the browser; the prototype stops at the browser's question.
    return `<div class="scrim" data-act="closeMaps"></div><div class="perm maps-ask" role="dialog" aria-modal="true" aria-labelledby="mp-t" aria-describedby="mp-d" data-esc="closeMaps">
        <div class="row">${ic.map}<div><b id="mp-t">Open in Maps?</b><p id="mp-d">Maps opens where ${an()} is now. Sharing on this page keeps going.</p></div></div>
        <div class="btns"><button class="btn neutral" type="button" data-act="closeMaps">Cancel</button><button class="btn viewer" type="button" data-act="mapsOpen">Open</button></div></div>`;
  }

  function topMom() {
    let html = '';
    if (S.mom.perm) {
      html += `<div class="scrim"></div><div class="perm" role="dialog" aria-modal="true" aria-labelledby="pm-t" aria-describedby="pm-d" data-esc="closePerm">
        <div class="row">${ic.loc}<div><b id="pm-t">trackme.live wants to use your location</b><p id="pm-d">Your browser asks this once for this site.</p></div></div>
        <div class="btns"><button class="btn neutral" type="button" data-act="denyLoc">Don’t allow</button><button class="btn viewer" type="button" data-act="allowLoc">Allow</button></div></div>`;
    }
    if (S.mom.notif) {
      html += `<button class="banner" type="button" data-act="openLink"><span class="appic msg" aria-hidden="true">${ic.bubble}</span><span class="txt"><span class="meta"><span>Messages</span><span>now</span></span><b>${an()}</b><p>I’m sharing my live location with you${S.call.active ? ' while we talk' : ''}.</p>
        <span class="link"><img src="${ASSET.logo('app-icon-default.svg')}" alt=""><span><b>${an()} · Live location</b><br>Opens in your browser</span></span></span></button>`;
    }
    return html;
  }

  // ---------- Rendering ----------
  function resolvedTheme() {
    if (S.theme !== 'system') return S.theme;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // Android draws its own screens and OS chrome (js/android.js) from the same state.
  const droid = () => (S.platform === 'android' && window.TML.android) || null;

  // ---------- Focus ----------
  // Focus survives a re-render: the same control (by its action and data) gets it back. After an
  // action it never drops to the page: it goes where the action says (FOCUS), into a dialog that
  // opened, back to what opened a dialog that closed, or to the screen's heading.
  const FOCUS = {};
  const GUARD_MS = 400;
  const focusNext = (who, sel) => { FOCUS[who] = sel; };
  function focusKey(el) {
    if (!el || el === document.body) return null;
    const act = el.getAttribute('data-act') || el.getAttribute('data-change');
    if (!act && !el.id) return null;
    return { id: el.id, act, v: el.getAttribute('data-v') || el.getAttribute('data-id') || el.getAttribute('data-to') || el.getAttribute('data-k') || el.getAttribute('data-tab') || '' };
  }
  function findKey(d, k) {
    if (!k) return null;
    let el = k.id ? d.screen.querySelector(`#${CSS.escape(k.id)}`) : null;
    if (!el && k.act) {
      el = [...d.screen.querySelectorAll(`[data-act="${k.act}"], [data-change="${k.act}"]`)]
        .find((x) => !x.closest('[inert]') && (x.getAttribute('data-v') || x.getAttribute('data-id') || x.getAttribute('data-to') || x.getAttribute('data-k') || x.getAttribute('data-tab') || '') === k.v);
    }
    return el;
  }
  function restoreFocus(d, k) {
    if (!k || d.screen.contains(document.activeElement)) return;
    const el = findKey(d, k);
    if (el) el.focus({ preventScroll: true });
  }
  const openModal = (d) => d.top.querySelector('[aria-modal="true"], [role="menu"]');
  const modalId = (el) => `${el.className}|${el.getAttribute('aria-label') || ''}|${(el.querySelector('h2, b') || {}).textContent || ''}`;
  function focusInto(modal) {
    const t = modal.querySelector('[data-autofocus]') || modal;
    if (t === modal && !modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1');
    t.focus({ preventScroll: true });
  }
  // The screen's heading, or its first control.
  function focusHome(d) {
    const h = d.ui.querySelector('h1[tabindex], h2[tabindex], h1, .a-top-title:not(:empty)');
    const t = h || d.ui.querySelector('button, a[href], input');
    if (!t) return;
    if (t === h && !h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
    t.focus({ preventScroll: true });
  }
  function manageFocus(d, who, had, fk) {
    const modal = openModal(d);
    const mkey = modal ? modalId(modal) : '';
    let target = FOCUS[who] || null;
    FOCUS[who] = null;
    const acted = !!d.trigger || had;
    if (mkey && mkey !== d.modalKey) {
      // A dialog opened (or one replaced another): remember what opened the first one.
      if (!d.modalKey) d.returnTo = d.trigger || fk;
      if (acted) { d.modalKey = mkey; d.trigger = null; focusInto(modal); return; }
    } else if (!mkey && d.modalKey) {
      const back = d.returnTo;
      d.returnTo = null;
      if (acted && !target) target = back;
    }
    d.modalKey = mkey;
    d.trigger = null;
    if (target && acted) {
      const el = typeof target === 'string' ? d.screen.querySelector(target) : findKey(d, target);
      if (el && !el.closest('[inert]')) {
        if (!el.matches('button, a[href], input, [tabindex]')) el.setAttribute('tabindex', '-1');
        el.focus({ preventScroll: true });
        return;
      }
    }
    restoreFocus(d, fk);
    if (had && !d.screen.contains(document.activeElement)) (modal ? focusInto(modal) : focusHome(d));
  }

  // Inactive layers are hidden from screen readers and can't take focus: the map behind a screen
  // that doesn't show it, and everything behind an open dialog.
  function layers(d, v) {
    const modal = !!openModal(d);
    const mapOn = !!v.withMap && !v.mapFailed;
    const m = d.mapHost;
    if (mapOn) { m.removeAttribute('aria-hidden'); m.setAttribute('role', 'region'); m.setAttribute('aria-label', 'Map'); }
    else { m.setAttribute('aria-hidden', 'true'); m.removeAttribute('role'); m.removeAttribute('aria-label'); }
    m.inert = !mapOn || modal;
    d.ui.inert = modal;
    d.screen.querySelectorAll(':scope > .statusbar, :scope > .a-statusbar, :scope > .pip').forEach((el) => { el.inert = modal; });
  }

  // ---------- Mom's page: what a screen reader hears ----------
  // One persistent polite status region gets only changes, never ticking times; "Alex stopped
  // sharing" is said once as an alert.
  function sayIn(el, text) {
    if (!el) return;
    el.textContent = '';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.textContent = text; el._t = setTimeout(() => { el.textContent = ''; }, 7000); }, 60);
  }
  function momAnnounce(d) {
    const m = S.mom;
    const onPage = (m.screen === 'page' || m.screen === 'ended') && !m.loading;
    const live = m.screen === 'page';
    const cur = onPage ? {
      ended: m.screen === 'ended', lost: live && quiet(), sharing: live && m.sharing, denied: live && m.denied,
      asked: live && !!S.session.askedAt && S.askedCall === S.session.callId, failed: live && m.mapFailed,
    } : null;
    const p = d.momPrev;
    d.momPrev = cur;
    if (!cur) { d.alertSaid = ''; return; }
    if (!p) return;
    if (cur.ended && !p.ended) {
      const h = momHeading();
      if (d.alertSaid !== h) { d.alertSaid = h; sayIn(d.alert, `${h.replace(/ at .*/, '')}.`); }
      return;
    }
    if (cur.ended) return;
    const say = [];
    if (cur.sharing && !p.sharing) say.push('You’re both live.');
    if (!cur.sharing && p.sharing) say.push(callActive() ? 'You stopped sharing your location.' : 'Your call ended, so your location is no longer shared.');
    if (cur.lost && !p.lost) say.push(`${an()}’s signal dropped. Last seen ${fmt(S.world.alexLast)}.`);
    if (!cur.lost && p.lost) say.push(`${an()} is live again.`);
    if (cur.asked && !p.asked) say.push(`${an()} asked to see where you are.`);
    if (cur.denied && !p.denied) say.push('Location is off for this page.');
    if (cur.failed && !p.failed) say.push('The map didn’t load.');
    if (say.length) sayIn(d.live, say.join(' '));
  }

  // The viewer's map keeps Alex (and Mom, once she shares back) in the band the bars and the sheet
  // leave open. Show Alex frames Alex alone.
  // Frames points in the band between a top bar and a sheet: pans, and zooms out (to 0.55) to fit
  // two people. top and bottom are in the screen's own px; markers keep their size (map.js).
  function frameMap(d, top, bottom, pts) {
    const sr = d.screen.getBoundingClientRect();
    const k = sr.width / 390 || 1;
    const mapTop = (d.mapHost.getBoundingClientRect().top - sr.top) / k;
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const band = Math.max(bottom - top, 60);
    const z = pts.length > 1 ? Math.max(0.55, Math.min(1, (band - 130) / Math.max(y1 - y0, 1), 270 / Math.max(x1 - x0, 1))) : 1;
    const fx = (x0 + x1) / 2;
    const fy = (y0 + y1) / 2;
    const cy = top + band / 2 - mapTop + 10;
    const dx = Math.max(-200, Math.min(200, 195 - fx * z));
    const dy = Math.max(-400, Math.min(300, cy - fy * z));
    d.map.panTo(dx, dy, z);
    return { band, z };
  }
  // The band a screen leaves open: from the bottom of its bar to the top of its sheet.
  function bandOf(d, barSel, sheetSel) {
    const bar = d.ui.querySelector(barSel);
    const sheet = d.ui.querySelector(sheetSel);
    if (!bar || !sheet || !d.screen.offsetParent) return null;
    const sr = d.screen.getBoundingClientRect();
    const k = sr.width / 390 || 1;
    return { top: (bar.getBoundingClientRect().bottom - sr.top) / k, bottom: (sheet.getBoundingClientRect().top - sr.top) / k };
  }

  // The viewer's map keeps Alex (and Mom, once she shares back) in the band the bars and the sheet
  // leave open. Show Alex frames Alex alone.
  const MIN_BAND = 160;
  function panMom() {
    const d = DEV.mom;
    if (!d || !d.screen.classList.contains('with-map')) return;
    const vp = d.ui.querySelector('.vp');
    const bar = vp && vp.querySelector('.glassbar');
    const sheet = vp && vp.querySelector('.sheet');
    if (!bar || !sheet || !d.screen.offsetParent) return;
    // When the sheet needs more room than leaves a 160pt band for the map (large text, zoom), the
    // page scrolls as a whole: the bar is a sticky header, the band keeps its 160pt with the markers
    // framed in it, and the sheet follows, opening at its heading.
    const body = vp.querySelector('.vp-body');
    const tall = sheet.scrollHeight > body.clientHeight - 16 - MIN_BAND;
    vp.classList.toggle('tall', tall);
    let b;
    if (tall) { const top = vp.offsetTop + body.offsetTop; b = { top, bottom: top + MIN_BAND }; } else b = bandOf(d, '.vp .glassbar', '.vp .sheet');
    if (!b) return;
    // No room left for the map (page zoom): the bar folds onto the sheet.
    vp.classList.toggle('folded', !tall && b.bottom - b.top < 24);
    const f = S.mom.frozen;
    const a = S.mom.screen === 'ended' && f ? f.pos : sharedPos();
    const both = S.mom.sharing && S.mom.screen === 'page' && S.mom.frame !== 'alex';
    frameMap(d, b.top, b.bottom, both ? [a, S.world.mom] : [a]);
  }

  // Alex's live map (iPhone; Android frames its own): the band between the bar, or the message
  // under it, and the sheet. In-app messages sit under the bar wherever its height puts it.
  function panAlex() {
    const d = DEV.alex;
    if (!d || S.platform === 'android' || S.alex.screen !== 'live' || !d.screen.classList.contains('with-map')) return;
    const b = bandOf(d, '.glassbar', '.sheet');
    if (!b) return;
    d.screen.style.setProperty('--bar-b', `${Math.round(b.top)}px`);
    const toast = d.top.querySelector('.toast.below-bar');
    const sr = d.screen.getBoundingClientRect();
    const k = sr.width / 390 || 1;
    const top = toast ? Math.max(b.top, (toast.getBoundingClientRect().bottom - sr.top) / k) : b.top;
    frameMap(d, top, Math.max(b.bottom, top + 60), S.mom.sharing ? [sharedPos(), S.world.mom] : [sharedPos()]);
  }

  function render() {
    const theme = resolvedTheme();
    const A = droid();
    document.body.dataset.platform = S.platform;
    document.querySelector('.devices').dataset.show = S.show;
    for (const who of ['alex', 'mom']) {
      const d = DEV[who];
      const had = d.screen.contains(document.activeElement);
      const fk = had ? focusKey(document.activeElement) : null;
      const v = A ? (who === 'alex' ? A.viewAlex() : A.viewMom()) : who === 'alex' ? viewAlex() : viewMom();
      d.screen.dataset.theme = theme;
      d.screen.dataset.platform = S.platform;
      d.screen.dataset.text = S.text;
      d.screen.classList.toggle('big', S.text !== 'default');
      d.screen.classList.toggle('with-map', !!v.withMap);
      d.screen.classList.toggle('dark-chrome', !!v.darkChrome);
      d.screen.classList.toggle('browser', !!v.browser);
      d.screen.classList.toggle('dim-map', !!v.dim);
      d.screen.classList.toggle('map-down', !!v.mapFailed);
      d.screen.classList.toggle('island-open', !!v.islandOpen);
      d.screen.classList.toggle('cc-open', who === 'alex' && !A && !!S.alex.cc);
      // iOS shows its location arrow in the status bar while an app (or a page) is using location.
      d.screen.classList.toggle('loc-on', who === 'alex' ? active() : S.mom.sharing);
      if (v.docTitle) d.screen.dataset.docTitle = v.docTitle; else delete d.screen.dataset.docTitle;
      const screenNow = who === 'alex' ? S.alex.screen : S.mom.screen;
      d.screen.classList.toggle('call-pill', !A && S.call.active && screenNow !== 'call' && screenNow !== 'lock' && screenNow !== 'splash');
      // The call pill is a control only on Alex's iPhone, and only while it shows.
      const pill = d.screen.querySelector('.statusbar .sb-time');
      const pillOn = who === 'alex' && d.screen.classList.contains('call-pill');
      pill.tabIndex = pillOn ? 0 : -1;
      if (pillOn) pill.removeAttribute('aria-hidden'); else pill.setAttribute('aria-hidden', 'true');
      const enter = v.key !== d.lastKey;
      // iPhone scrolling screens get a navigation bar that turns solid, with an inline title, past the large title.
      const edge = !A && v.title && /\bscroll\b/.test(v.cls || '') ? `<div class="ios-edge" aria-hidden="true"><span>${v.title}</span></div>` : '';
      const ui = `<div class="scr ${v.cls || ''}${enter ? ' enter' : ''}">${edge}${v.html}</div>${v.after || ''}`;
      if (enter || ui.replace(' enter', '') !== d.lastUi.replace(' enter', '')) {
        const prev = d.ui.querySelector('.scr');
        const keep = !enter && prev ? prev.scrollTop : 0;
        // The viewer's sheet scrolls on its own at large sizes; keep its place too.
        const sheetPrev = !enter && prev ? prev.querySelector('.vp .sheet') : null;
        const keepSheet = sheetPrev ? sheetPrev.scrollTop : 0;
        const vpPrev = !enter && prev ? prev.querySelector('.vp') : null;
        const keepVp = vpPrev && vpPrev.querySelector('.vp-body') ? vpPrev.querySelector('.vp-body').scrollTop : 0;
        const tallPrev = !!(vpPrev && vpPrev.classList.contains('tall'));
        d.ui.innerHTML = ui;
        if (keep) { const scr = d.ui.querySelector('.scr'); scr.scrollTop = keep; scr.classList.toggle('scrolled', keep > 36); }
        if (keepSheet) { const sh = d.ui.querySelector('.vp .sheet'); if (sh) sh.scrollTop = keepSheet; }
        const vpNow = d.ui.querySelector('.vp');
        if (vpNow && tallPrev) { vpNow.classList.add('tall'); const bd = vpNow.querySelector('.vp-body'); if (bd) bd.scrollTop = keepVp; }
        d.lastUi = ui;
      }
      d.lastKey = v.key;
      const top = (A ? (who === 'alex' ? A.topAlex() : A.topMom()) : who === 'alex' ? topAlex() : topMom()) + (who === 'mom' ? mapsAsk() : '');
      if (top !== d.lastTop) { d.top.innerHTML = top; d.lastTop = top; }
      // In-app messages are announced politely, once each.
      if (who === 'alex') {
        const b = S.alex.banner;
        const said = b ? `${b.id}|${bannerText(b)}` : '';
        if (said !== d.lastSaid) { d.lastSaid = said; d.live.textContent = b ? bannerText(b) : ''; }
        else if (enter) d.live.textContent = '';
      } else {
        // A new page clears what was said on the old one, so the virtual cursor never finds it.
        if (enter) [d.live, d.alert].forEach((el) => { if (el) { clearTimeout(el._t); el.textContent = ''; } });
        momAnnounce(d);
      }
      if (A) A.chrome(who, d, v);
      layers(d, v);
      // When each guarded button first appeared (by its action), for the double-tap guard.
      const seen = d.guards || {};
      d.guards = {};
      d.screen.querySelectorAll('[data-guard]').forEach((el) => { const k = JSON.stringify(focusKey(el)); d.guards[k] = seen[k] || Date.now(); });
      manageFocus(d, who, had, fk);
    }
    updateLive();
    panMom();
    panAlex();
    renderStory();
  }

  // One phrase per marker, for screen readers on both maps.
  function phrases(perspective) {
    const ax = approx();
    const lost = quiet();
    const join = (...xs) => xs.filter(Boolean).join(', ');
    const far = S.mom.sharing ? `${lost && !ax ? 'about ' : ''}${distanceSpoken()} away` : '';
    if (perspective === 'mom') {
      return {
        sharer: lost ? join(an(), `last seen at ${fmt(S.world.alexLast)}`, ax && 'approximate location', far)
          : join(an(), 'live', ax && 'approximate location', far, `updated ${agoSpoken(S.world.alexLast)}`),
        viewer: 'You, sharing your location',
      };
    }
    const name = vn() || 'The person you’re sharing with';
    return {
      sharer: lost ? join('You', S.world.offline ? 'no connection' : 'no GPS signal', `last seen at ${fmt(S.world.alexLast)}`)
        : join('You', 'live', ax && 'approximate location', `updated ${agoSpoken(S.world.alexLast)}`),
      viewer: join(name, 'live', `${distanceSpoken()} away`, `updated ${agoSpoken(S.world.momLast)}`),
    };
  }

  function mapView(perspective) {
    // Both maps keep the look the session started with, so Alex sees what Mom sees.
    const look = sessionLook();
    const base = { img: ASSET.mascot(look.mascot, look.color), acc: accSrcFor(look) };
    // Mom's open page keeps the stopped session's last spot, even after Alex starts a new one.
    const f = S.mom.frozen;
    if (perspective === 'mom' && S.mom.screen === 'ended' && f) {
      const n = M.nearest(f.pos);
      return {
        sharer: { ...base, x: f.pos[0], y: f.pos[1], visible: true, seen: true, approx: f.approx, label: `Last seen ${fmt(f.endedAt)}`, phrase: `${an()}, last seen at ${fmt(f.endedAt)}, when sharing stopped` },
        viewer: { x: 0, y: 0, visible: false, label: 'You', mark: M.PERSON },
        trail: f.trail, approx: f.approx, mapLabel: f.approx ? `Street map of the ${M.area(f.pos)} area` : `Street map around ${n.name}`,
      };
    }
    const p = sharedPos();
    const ended = S.session.status === 'stopped';
    const seen = quiet() || ended;
    const ax = approx();
    const ph = phrases(perspective);
    const n = M.nearest(p);
    return {
      sharer: {
        ...base, x: p[0], y: p[1], visible: S.session.status !== 'idle' && !(perspective === 'mom' && S.mom.loading), seen, approx: ax, phrase: ph.sharer,
        label: perspective === 'alex' ? 'You' : seen ? `Last seen ${fmt(ended ? S.session.endedAt : S.world.alexLast)}` : an(),
      },
      // The name Alex gave is for Alex's map only; Mom's own marker is "You" with a person icon.
      viewer: { x: S.world.mom[0], y: S.world.mom[1], visible: S.mom.sharing, label: perspective === 'mom' ? 'You' : who.label(), mark: perspective === 'mom' ? M.PERSON : viewerMark(), phrase: ph.viewer },
      // An approximate share never draws the exact trail.
      trail: ax ? [] : S.world.trail,
      approx: ax,
      mapLabel: perspective === 'alex' ? 'Street map' : ax ? `Street map of the ${M.area(p)} area` : `Street map around ${n.name}`,
    };
  }

  function bind(name, text) {
    document.querySelectorAll(`[data-bind="${name}"]`).forEach((el) => { if (el.textContent !== text) el.textContent = text; });
  }

  function updateLive() {
    const t = now();
    bind('clock', clock(t));
    bind('clockBig', clock(t));
    if (S.call.active) bind('calltime', mmss(t - S.call.startedAt));
    if (S.alex.screen === 'signup' && S.alex.signup === 'code' && resendLeft() > 0) bind('resend', `You can send a new code in 0:${String(resendLeft()).padStart(2, '0')}.`);
    if (active()) {
      bind('duration', minutes(t - S.session.startedAt));
      bind('durationSr', `Sharing for ${minutesSpoken(t - S.session.startedAt)}`);
      if (S.mom.sharing) { bind('distance', distance()); bind('distanceSr', `Distance, ${distanceSpoken()}`); }
      bind('islandShort', islandShort());
      bind('islandSub', islandSub());
      if (S.mom.sharing) { bind('islandDist', distance()); bind('islandDistSr', `${distanceSpoken()} apart`); }
      if (S.mom.sharing) { bind('momDetail', `Sharing back · updated ${ago(S.world.momLast)}`); bind('momDetailSr', `Sharing back, updated ${agoSpoken(S.world.momLast)}`); }
      if (!quiet()) {
        bind('alexStatus', `Live · updated ${ago(S.world.alexLast)}`);
        bind('alexStatusSr', `Live, updated ${agoSpoken(S.world.alexLast)}`);
        bind('alexDetailViewer', `Updated ${ago(S.world.alexLast)} · ${approx() ? 'approximate' : 'precise'}`);
        bind('alexDetailViewerSr', `Updated ${agoSpoken(S.world.alexLast)}, ${approx() ? 'approximate' : 'precise'}`);
      }
      if (S.mom.screen === 'page' && !S.mom.loading) { const w = whereNow(); bind('where', w.text); bind('whereSr', w.spoken); }
    }
    DEV.alex.map.update(mapView('alex'));
    DEV.mom.map.update(mapView('mom'));
    panMom();
    panAlex();
    const A = droid();
    if (A) A.updateLive(t);
  }

  // ---------- The story panel ----------
  function renderStory() {
    const s = S.session;
    const android = S.platform === 'android';
    const steps = [
      { done: S.alex.onboarded, html: '<span class="who a">ALEX</span>Go through onboarding, create an account and pick a mascot.' },
      { done: S.call.ever, html: 'Start a call with Mom using <b>Start a call with Mom</b> below.' },
      { done: s.status !== 'idle' || S.alex.screen === 'share', html: android
        ? '<span class="who a">ALEX</span>Tap <b>Share live location</b>, then <b>While using the app</b>, then <b>Allow</b> for Phone.'
        : '<span class="who a">ALEX</span>Tap <b>Share live location</b>, then <b>Allow While Using App</b>.' },
      { done: s.status !== 'idle', html: '<span class="who a">ALEX</span>Tap <b>Share live location</b>, choose <b>Mom</b>, then decide about alerts.' },
      { done: !!s.viewedAt, html: '<span class="who m">MOM</span>Tap the message from Alex to open the link.' },
      { done: S.mom.everShared, html: s.status === 'active' && s.callId == null
        ? 'Mom can share back only during a call. Tap <b>Stop sharing</b>, then <b>Start a call with Mom</b>, and share again from the call card.'
        : s.status === 'active' && !s.seesCallEnd
          ? 'Mom can share back only when Alex’s phone allows Phone access. Tap <b>Stop sharing</b>, set <b>Phone access</b> to <b>Allow</b> in Alex’s Settings, then share again during a call.'
          : `<span class="who a">ALEX</span>Optional: tap <b>Ask to share</b>. <span class="who m">MOM</span>Tap <b>Share my location</b>, then <b>${android ? 'While visiting the site' : 'Allow'}</b>.` },
      { done: s.status === 'stopped', html: android
        ? 'You’re both live. Try <b>Back to call</b> and tap the mini map, <b>Change timer</b>, <b>Lose Alex’s GPS signal</b>, <b>Jump to the 1-hour limit</b>, or <b>End the call</b>.'
        : 'You’re both live. Tap the green time in Alex’s status bar to go back to the call, then the Dynamic Island. Or try <b>Change timer</b>, <b>Lose Alex’s GPS signal</b>, <b>Jump to the 1-hour limit</b> or <b>End the call</b>.' },
      { done: S.mom.screen === 'expired', html: '<span class="who m">MOM</span>After it ends, use <b>Mom opens the link later</b>.' },
      { done: S.alex.quickUsed, html: android
        ? '<span class="who a">ALEX</span>On Home, tap <b>Add tile</b>. Start another call, use <b>Open Quick Settings</b> and tap <b>Share location</b>.'
        : '<span class="who a">ALEX</span>On Home, tap <b>Show me how</b>. Start another call, use <b>Open Control Center</b> and tap <b>Share location</b>.' },
    ];
    steps.forEach((x, i) => { if (x.done) S.storyDone[i] = true; x.done = !!S.storyDone[i]; });
    const cur = steps.findIndex((x) => !x.done);
    const html = steps.map((x, i) => `<li class="${x.done ? 'done' : i === cur ? 'now' : ''}"${i === cur ? ' aria-current="step"' : ''}><span>${x.html}</span></li>`).join('');
    const list = document.getElementById('steps');
    if (list.innerHTML !== html) list.innerHTML = html;

    const setCtl = (id, o) => {
      const el = document.getElementById(id);
      if (!el) return;
      if ('disabled' in o) el.disabled = o.disabled;
      if ('on' in o) { el.classList.toggle('on', o.on); el.setAttribute('aria-pressed', String(o.on)); }
      if ('label' in o) el.querySelector('.lbl').textContent = o.label;
      if ('small' in o) el.querySelector('small').textContent = o.small;
    };
    const callBtn = document.getElementById('ctl-call');
    callBtn.className = `ctl ${S.call.active ? 'end' : 'call'}`;
    setCtl('ctl-call', { label: S.call.active ? 'End the call' : 'Start a call with Mom', small: S.call.active ? mmss(now() - S.call.startedAt) : '', disabled: !S.alex.onboarded && !S.call.active });
    const quickOpen = android ? S.alex.shade === 'qs' : S.alex.cc;
    setCtl('ctl-quick', { disabled: !S.call.active || !S.alex.onboarded, on: quickOpen, label: android ? 'Open Quick Settings' : 'Open Control Center', small: S.call.active ? '' : 'During a call' });
    setCtl('ctl-signal', { disabled: !active(), on: S.world.signalLost, label: S.world.signalLost ? 'Give Alex’s GPS signal back' : 'Lose Alex’s GPS signal' });
    setCtl('ctl-offline', { disabled: !active(), on: S.world.offline, label: S.world.offline ? 'Give Alex’s connection back' : 'Lose Alex’s connection' });
    setCtl('ctl-limit', { disabled: !active() });
    setCtl('ctl-later', { disabled: S.session.status !== 'stopped' || S.mom.screen === 'expired' });
    const onSignup = S.alex.screen === 'signup';
    setCtl('dev-number', { disabled: !(onSignup && S.alex.signup === 'details'), on: S.dev.badNumber });
    setCtl('dev-sendfail', { disabled: !(onSignup && S.alex.signup === 'details'), on: S.dev.sendFail });
    setCtl('dev-expire', { disabled: !(onSignup && S.alex.signup === 'code'), on: S.dev.codeExpired });
    setCtl('dev-broken', {});
    setCtl('dev-mapfail', { disabled: !['page'].includes(S.mom.screen), on: S.mom.mapFailed });
    setCtl('dev-nogeo', { disabled: !['page'].includes(S.mom.screen), on: S.mom.noGeo });

    document.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === S.theme)));
    document.querySelectorAll('[data-platform-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.platformSet === S.platform)));
    document.querySelectorAll('[data-text-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.textSet === S.text)));
    const labels = android
      ? { alex: ['Android phone · the Track Me Live app', "Alex's phone", "Alex's Android phone, Track Me Live app"], mom: ['Android phone · the link in Chrome', "Mom's phone", "Mom's Android phone, the link in Chrome"] }
      : { alex: ['iPhone · the Track Me Live app', "Alex's iPhone", "Alex's iPhone, Track Me Live app"], mom: ['any phone · the link in a browser', "Mom's phone", "Mom's phone, the link in a browser"] };
    for (const who of ['alex', 'mom']) {
      const t = document.querySelector(`.device.${who} .dev-label .t`);
      if (t && t.textContent !== labels[who][0]) t.textContent = labels[who][0];
      const btn = document.querySelector(`[data-show-btn="${who}"] .t`);
      if (btn && btn.textContent !== labels[who][1]) btn.textContent = labels[who][1];
      document.querySelector(`.device.${who}`).setAttribute('aria-label', labels[who][2]);
    }
    document.querySelectorAll('[data-show-btn]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.showBtn === S.show));
      const other = b.dataset.showBtn;
      const pending = other === 'mom' ? S.mom.notif || S.mom.perm : !!S.alex.banner;
      b.querySelector('.badge').hidden = !(pending && S.show !== other);
    });
  }

  // ---------- Actions ----------
  let bannerTimer = null;
  // kind: 'push' is a notification from the system (an iOS banner, an Android heads-up notification),
  // shown only when notifications are allowed; 'app' is the app talking while it's open (a glass
  // capsule on iPhone, a snackbar on Android); 'offer' is the in-app call offer, with its action.
  function alexBanner(title, body, opts) {
    const o = opts || {};
    S.alex.banner = { id: String(Date.now()), title, body, act: o.act || 'dismissBanner', kind: o.kind || 'push', snack: o.snack || '', cta: o.cta || '' };
    clearTimeout(bannerTimer);
    if (!o.sticky) bannerTimer = setTimeout(() => { S.alex.banner = null; render(); }, o.kind === 'offer' ? 8000 : 5200);
  }

  function startCall() {
    S.call.active = true;
    S.call.startedAt = now();
    S.call.ever = true;
    S.call.id += 1;
    if (S.mom.screen === 'lock') S.mom.screen = 'call';
    // The offer appears only while the app is open and not already sharing; a manual share keeps
    // its own rule and never turns into Live Together.
    // Home already shows the on-call card with its own Share button, so the offer skips Home.
    if (S.session.status !== 'active' && S.alex.onboarded && S.alex.settings.offer && ['settings', 'picker', 'ended'].includes(S.alex.screen)) {
      alexBanner('You’re on a call', 'Share your live location with them?', { act: 'openShare', kind: 'offer', cta: 'Share live location' });
    }
  }

  function endCall() {
    const endedId = S.call.id;
    S.call.active = false;
    S.alex.cc = false;
    if (S.alex.shade === 'qs') S.alex.shade = false;
    if (S.alex.screen === 'call') S.alex.screen = active() ? 'live' : 'home';
    if (S.mom.screen === 'call') S.mom.screen = 'lock';
    if (S.alex.banner && S.alex.banner.kind === 'offer') S.alex.banner = null;
    // Only the session's own call matters. On Android without the Phone permission the app can't
    // tell the call ended: those sessions run on a timer with share back off.
    // F-09: on the share screen, a stop rule that followed the call becomes the 30-minute default.
    if (!active() && S.alex.screen === 'share' && S.session.stop === 'call') S.session.stop = 30;
    // The session decided at its start whether the app can see its call end (seesCallEnd).
    if (!active() || S.session.callId !== endedId || !S.session.seesCallEnd) return;
    const wasSharing = S.mom.sharing;
    S.mom.sharing = false;
    S.mom.perm = false;
    if (S.session.stop === 'call') {
      endSession('call');
      if (S.alex.settings.alertCall) alexBanner('Call ended', 'Sharing stopped with the call.');
    } else if (S.alex.settings.alertCall) {
      alexBanner('Call ended', `You’re still sharing until ${fmt(endAt())}.${wasSharing ? ` ${who.Their()} location stopped with the call.` : ''}`);
    }
  }

  function startSession() {
    const s = S.session;
    const prevCall = s.callId;
    s.status = 'active';
    s.n += 1;
    s.viewer = S.alex.viewerName.replace(/\s+/g, ' ').trim().slice(0, 24);
    s.look = currentLook();
    s.precisionNext = null;
    s.startedAt = now();
    s.expiresAt = s.startedAt + LIMIT_MS;
    s.callId = S.call.active ? S.call.id : null;
    if (s.stop === 'call' && s.callId == null) s.stop = 30;
    s.stopAt = s.stop === 'call' ? null : s.stop === 'limit' ? s.expiresAt : Math.min(s.startedAt + s.stop * 60000, s.expiresAt);
    s.viewedAt = null; s.endedAt = null; s.reason = null;
    // Share again during the same call keeps Ask to share used.
    s.askedAt = s.callId != null && s.callId === prevCall && S.askedCall === s.callId ? s.askedAt : null;
    // Can the app see this call end? iPhone always; Android only with the Phone permission now. Share
    // back needs both a call and an app that can see it end; otherwise the share runs on a timer.
    s.seesCallEnd = s.callId != null && (S.platform !== 'android' || S.alex.perm.phone === 'allowed');
    if (!s.seesCallEnd) { s.shareBack = false; if (s.stop === 'call') s.stop = 30; }
    s.stopAt = s.stop === 'call' ? null : s.stop === 'limit' ? s.expiresAt : Math.min(s.startedAt + s.stop * 60000, s.expiresAt);
    // The name is kept tidy for next time.
    S.alex.viewerName = s.viewer;
    S.alex.modal = null;
    S.alex.banner = null;
    S.alex.screen = 'live';
    Object.assign(S.mom, { notif: false, perm: false, sharing: false, denied: false, dismissed: false, everShared: false, sharedAt: null });
    // A page Mom still has open shows the old link's ended state; the new link arrives as a new message.
    if (S.mom.screen === 'page') S.mom.screen = 'ended';
    Object.assign(S.world, { t: M.T_START, trail: [M.bez(M.T_START)], alexLast: now(), signalLost: false, offline: false, lastPing: Date.now(), mom: M.HOME.slice() });
    // Ask for notifications at the moment they're useful: right after the first link goes out.
    if (S.alex.perm.notif === 'unset') S.alex.sys = 'notifPre';
    sendMessage();
  }

  // The link reaches Mom as a message (the prototype follows her phone).
  function sendMessage() {
    setTimeout(() => { if (active()) { S.mom.notif = true; render(); } }, 1400);
  }

  function endSession(reason) {
    const s = S.session;
    s.status = 'stopped';
    s.endedAt = now();
    s.reason = reason;
    S.mom.frozen = { pos: sharedPos(), trail: approx() ? [] : S.world.trail.slice(), approx: approx(), endedAt: s.endedAt, reason };
    S.mom.sharing = false;
    S.mom.perm = false;
    S.world.signalLost = false;
    S.world.offline = false;
    S.alex.modal = null;
    S.alex.alert = null;
    S.alex.menu = null;
    S.alex.island = false;
    S.alex.everEnded = true;
    S.alex.pip = null;
    S.alex.phoneLater = false;
    // Allow Once (iOS) and Only this time (Android) last for that share; Settings then shows Ask next time.
    if (S.alex.perm.loc === 'once') S.alex.perm.loc = 'ask';
    if (S.alex.sys === 'notifPre' || S.alex.sys === 'notifSys') S.alex.sys = null;
    // On the call screen, Alex stays on the call: only the alert says sharing ended.
    if (S.alex.screen !== 'call') S.alex.screen = 'ended';
    if (S.mom.screen === 'page') S.mom.screen = 'ended';
  }

  // Sign-up: check a full code.
  let codeTimer = null;
  function checkCode() {
    const a = S.alex;
    if (a.code.length < 6) return;
    if (S.dev.codeExpired) { a.codeErr = 'expired'; a.code = ''; return; }
    if (a.code !== CODE) { a.codeErr = 'wrong'; a.code = ''; return; }
    a.codeErr = null;
    clearTimeout(codeTimer);
    codeTimer = setTimeout(() => {
      if (S.alex.screen !== 'signup' || S.alex.signup !== 'code') return;
      S.alex.screen = 'picker';
      S.alex.pickerFrom = 'onboarding';
      render();
    }, 900);
  }

  // Text fields: set state while typing (done = false) and tidy it when the field is left (done = true).
  const tidy = (v) => v.replace(/\s+/g, ' ').trim().slice(0, 24);
  const INPUTS = {
    setViewer(el, done) { S.alex.viewerName = done ? tidy(el.value) : el.value.slice(0, 24); if (done && el.value !== S.alex.viewerName) el.value = S.alex.viewerName; },
    setName(el, done) { S.alex.name = tidy(el.value); if (done && el.value !== S.alex.name) el.value = S.alex.name; },
  };

  const ACTIONS = {
    // Alex
    obNext() { if (S.alex.ob < 2) S.alex.ob++; else { S.alex.screen = 'signup'; S.alex.signup = 'details'; } },
    obSkip() { S.alex.screen = 'signup'; S.alex.signup = 'details'; },
    signupBack() {
      clearTimeout(codeTimer);
      if (S.alex.signup === 'code') S.alex.signup = 'details';
      else { S.alex.screen = 'onboarding'; S.alex.ob = 2; }
    },
    sendCode() {
      const a = S.alex;
      // The name people see: 1 to 24 characters after trimming.
      a.nameErr = !a.name.trim();
      if (a.nameErr) { focusNext('alex', '#name-ios'); return; }
      a.numberErr = S.dev.badNumber;
      if (a.numberErr) return;
      // The stage's "Next text fails to send" fails once; Try again works.
      if (S.dev.sendFail) { S.dev.sendFail = false; a.sendErr = true; return; }
      a.sendErr = false;
      Object.assign(a, { signup: 'code', codeFilled: false, code: '', codeErr: null, codeNote: '', resendAt: now() + 30000 });
    },
    resendCode() {
      const a = S.alex;
      S.dev.codeExpired = false;
      Object.assign(a, { code: '', codeErr: null, codeNote: 'New code sent.', resendAt: now() + 30000 });
    },
    fillCode() { const a = S.alex; a.codeErr = null; a.codeNote = ''; a.code = CODE; a.codeFilled = true; checkCode(); },
    typeKey(el) {
      const a = S.alex;
      const k = el.dataset.k;
      if (k === 'del') { a.code = a.code.slice(0, -1); return; }
      if (a.code.length >= 6) return;
      a.codeErr = null;
      a.codeNote = '';
      a.code += k;
      checkCode();
    },
    pickMascot(el) {
      S.alex.mascot = el.dataset.id;
      // A character that can't wear the current accessory drops it.
      if (!accFor().includes(S.alex.accessory)) S.alex.accessory = 'none';
    },
    pickAccessory(el) { S.alex.accessory = accFor().includes(el.dataset.id) ? el.dataset.id : 'none'; },
    pickSet(el) { S.alex.pickSet = el.dataset.id; },
    pickColor(el) { S.alex.color = el.dataset.id; },
    savePicker() {
      const first = !S.alex.onboarded;
      S.alex.onboarded = true;
      S.alex.screen = 'home';
      // During a call, Home's on-call card is the offer.
      if (first && S.alex.banner && S.alex.banner.kind === 'offer') S.alex.banner = null;
    },
    tab(el) {
      const t = el.dataset.tab;
      S.alex.pickerFrom = 'tab';
      S.alex.screen = t === 'mascot' ? 'picker' : t;
    },
    goHome() { S.alex.screen = 'home'; S.alex.menu = null; },
    openShare() {
      if (active()) { S.alex.screen = 'live'; S.alex.banner = null; S.alex.island = false; return; }
      // Location is asked on the first share, never at install. Ask every time (or after Allow Once)
      // goes straight to the system prompt: the person has already seen our explainer.
      const loc = S.alex.perm.loc;
      if (loc === 'unset' || loc === 'denied' || loc === 'ask') {
        S.alex.banner = null;
        S.alex.afterLoc = 'share';
        S.alex.sys = loc === 'unset' ? 'locPre' : loc === 'ask' ? 'locSys' : 'locOff';
        return;
      }
      const st = S.alex.settings;
      // The call is the default rule only during a call; otherwise 30 minutes.
      S.session.stop = S.call.active ? st.defaultStop : st.defaultStop === 'call' ? 30 : st.defaultStop;
      // With Precise off for the app, every share is approximate.
      S.session.precision = S.alex.perm.precise === false ? 'approximate' : st.precision;
      S.session.shareBack = st.shareBack;
      S.alex.banner = null;
      S.alex.screen = 'share';
    },
    openLive() { S.alex.screen = 'live'; S.alex.banner = null; },
    openTimer(el) { S.alex.modal = 'timer'; S.alex.modalFor = el.dataset.for || 'session'; },
    setStop(el) {
      const raw = el.dataset.v;
      const v = raw === 'call' || raw === 'limit' ? raw : Number(raw);
      if (S.alex.modalFor === 'default') S.alex.settings.defaultStop = v;
      else {
        const s = S.session;
        s.stop = v;
        // A timer counts from now, never past the 1-hour limit.
        if (active()) s.stopAt = v === 'call' ? null : v === 'limit' ? s.expiresAt : Math.min(now() + v * 60000, s.expiresAt);
      }
      S.alex.modal = null;
    },
    closeModal() { S.alex.modal = null; },
    // Before sharing it changes at once; while sharing it takes effect from the next ping.
    togglePrecision() {
      const s = S.session;
      const cur = s.precisionNext || s.precision;
      const next = cur === 'precise' ? 'approximate' : 'precise';
      if (!active()) { s.precision = next; return; }
      s.precisionNext = next === s.precision ? null : next;
    },
    setPrecisionNext(el) {
      const s = S.session;
      if (!active()) { s.precision = el.dataset.v; return; }
      s.precisionNext = el.dataset.v === s.precision ? null : el.dataset.v;
    },
    setName(el) {
      const v = el.value.replace(/\s+/g, ' ').trim().slice(0, 24);
      S.alex.name = v;
      S.alex.nameErr = !v;
    },
    // The share screen's Location row: a pull-down menu anchored to the row.
    openMenu(el) {
      const scr = el.closest('.screen');
      const r = el.getBoundingClientRect();
      const sr = scr.getBoundingClientRect();
      const k = sr.width / 390;
      S.alex.menu = el.dataset.menu;
      S.alex.menuAt = { top: Math.round((r.bottom - sr.top) / k) + 4 };
    },
    closeMenu() { S.alex.menu = null; },
    setSessionPrecision(el) {
      if (el.dataset.v === 'precise' && S.alex.perm.precise === false && S.platform !== 'android') return;
      S.session.precision = el.dataset.v;
      S.alex.menu = null;
    },
    // "Who it's for": kept as the last name used for next time.
    setViewer(el) { S.alex.viewerName = el.value.replace(/\s+/g, ' ').trim().slice(0, 24); },
    clearViewer() { S.alex.viewerName = ''; focusNext('alex', '#viewer-ios, #viewer-android'); },
    // At the 1-hour limit: a new session with a new link, sent the usual way.
    shareAgain() {
      S.alex.screen = 'home';
      S.alex.banner = null;
      ACTIONS.openShare();
      if (S.alex.screen === 'share') S.alex.modal = 'sharesheet';
    },
    toggleShareBack(el) { S.session.shareBack = el.checked; },
    openShareSheet() { S.alex.modal = 'sharesheet'; },
    // The share sheet. Choosing a destination (Copy link included) is what sends the link; while
    // sharing, Send link again sends the same link.
    sendTo(el) {
      const to = el.dataset.to;
      if (to === 'Copy') {
        if (!active()) startSession(); else S.alex.modal = null;
        alexBanner('Link copied', 'Paste it wherever you like.', { kind: 'app', snack: 'Link copied. Paste it wherever you like.' });
        return;
      }
      if (to !== 'Mom') { alexBanner('Send it to Mom', 'This prototype follows Mom’s phone, so send the link to Mom.', { kind: 'app', snack: 'This prototype follows Mom’s phone, so send the link to Mom.' }); return; }
      if (active()) { S.alex.modal = null; sendMessage(); return; }
      startSession();
    },
    askShare() {
      S.session.askedAt = now();
      S.askedCall = S.session.callId;
      S.mom.dismissed = false;
      alexBanner(`Asked ${who.them()} to share`, 'They’ll see your request and can say no.', { kind: 'app', snack: `Asked ${who.them()} to share. They can say no.` });
    },
    askStop() { S.alex.alert = 'stop'; },
    cancelAlert() { S.alex.alert = null; },
    confirmStop() { endSession('stopped'); },
    backToCall() { if (S.call.active) { S.alex.screen = 'call'; S.alex.island = false; S.alex.menu = null; S.alex.modal = null; } },
    backToApp() { S.alex.screen = active() ? 'live' : 'home'; S.alex.island = false; },
    toggleIsland() { S.alex.island = !S.alex.island; },
    islandStop() { S.alex.island = false; S.alex.screen = 'live'; S.alex.alert = 'stop'; },
    // Permission prompts
    sysClose() { S.alex.sys = null; S.alex.afterLoc = null; },
    locContinue() { S.alex.sys = 'locSys'; },
    locAllow() { S.alex.perm.loc = 'while'; S.alex.sys = null; afterLocation(); },
    locOnce() { S.alex.perm.loc = 'once'; S.alex.sys = null; afterLocation(); },
    locPrecise() { S.alex.perm.precise = S.alex.perm.precise === false; },
    locDeny() { S.alex.perm.loc = 'denied'; S.alex.sys = 'locOff'; },
    locSettings() { S.alex.perm.loc = 'while'; S.alex.sys = null; afterLocation(); },
    notifContinue() { S.alex.sys = 'notifSys'; },
    notifLater() { S.alex.sys = null; },
    notifAllow() { S.alex.perm.notif = 'allowed'; S.alex.sys = null; },
    notifDeny() { S.alex.perm.notif = 'denied'; S.alex.sys = null; },
    // "Share faster during calls"
    tipLater() { S.alex.tipDone = true; },
    tipHow() { S.alex.modal = 'quickhow'; },
    tipDone() { S.alex.modal = null; S.alex.tipDone = true; },
    // The quick-start control in Control Center (iPhone) opens the app on the share screen.
    ccClose() { S.alex.cc = false; },
    ccShare() { S.alex.cc = false; quickStart(); },
    permLoc() {
      S.alex.afterLoc = null;
      S.alex.sys = { unset: 'locPre', ask: 'locSys', once: 'locSys', denied: 'locOff' }[S.alex.perm.loc] || null;
    },
    permNotif() { S.alex.sys = S.alex.perm.notif === 'unset' ? 'notifPre' : S.alex.perm.notif === 'denied' ? 'notifOff' : null; },
    notifSettings() { S.alex.perm.notif = 'allowed'; S.alex.sys = null; },
    done() { S.alex.screen = 'home'; },
    endCall() { endCall(); },
    dismissBanner() { S.alex.banner = null; },
    setting(el) { S.alex.settings[el.dataset.key] = el.checked; },
    setPrecision(el) { S.alex.settings.precision = el.dataset.v; },
    setTheme(el) { setTheme(el.dataset.v); },
    askDelete() { S.alex.alert = 'delete'; },
    // Delete account and all data: any share stops (Mom's open page shows it ended), the profile goes,
    // and the app starts over at onboarding. The stage's call, theme, platform and text size stay.
    deleteAccount() {
      if (active()) endSession('stopped');
      const keep = { theme: S.theme, platform: S.platform, text: S.text };
      S.alex = fresh().alex;
      Object.assign(S, keep);
      S.alex.screen = 'onboarding';
      S.askedCall = null;
      S.alex.banner = null;
      clearTimeout(bannerTimer);
    },
    // Mom
    openLink() {
      S.mom.notif = false;
      if (!active()) { S.mom.screen = 'expired'; return; }
      S.mom.screen = 'page';
      // The page trades the link for a session first: a short skeleton, never a blank map.
      S.mom.loading = true;
      setTimeout(() => { S.mom.loading = false; render(); }, 700);
      if (!S.session.viewedAt) {
        S.session.viewedAt = now();
        if (S.alex.settings.alertOpened) alexBanner(`${who.They()} opened your link`, callActive() ? 'You’re live on their map until your call ends.' : 'You’re live on their map.', { act: 'openLive' });
      }
    },
    askPermission() { S.mom.perm = true; },
    // Dismissing the browser's prompt (Escape) answers nothing; focus goes back to the button.
    closePerm() { S.mom.perm = false; },
    allowLoc() {
      if (!callActive()) { S.mom.perm = false; return; }
      Object.assign(S.mom, { perm: false, sharing: true, denied: false, everShared: true, sharedAt: now(), frame: 'auto' });
      S.world.momLast = now();
      focusNext('mom', '[data-act="stopMine"]');
      alexBanner(vn() ? `${vn()} is sharing back` : 'They’re sharing back', 'You can both see each other until the call ends.', { act: 'openLive' });
    },
    denyLoc() { S.mom.perm = false; S.mom.denied = true; focusNext('mom', '.shareback.off [data-act="askPermission"]'); },
    dismissShareBack() { S.mom.dismissed = true; focusNext('mom', '[data-act="askPermission"]'); },
    retryMap() { S.mom.mapFailed = false; focusNext('mom', '#vp-h1'); },
    stopMine() {
      S.mom.sharing = false;
      S.mom.dismissed = true;
      focusNext('mom', '#vp-h1');
      alexBanner(`${who.They()} stopped sharing back`, `${vn() ? `${vn()} can` : 'They can'} still see you.`, { act: 'openLive' });
    },
    // Where Alex is: Show Alex frames Alex and pulses the marker; Open in Maps hands the point to Maps.
    showAlex() {
      S.mom.frame = 'alex';
      DEV.mom.map.spot();
      sayIn(DEV.mom.live, `Map centered on ${an()}.`);
    },
    openMaps() { S.mom.mapsAsk = true; },
    closeMaps() { S.mom.mapsAsk = false; },
    mapsOpen() { S.mom.mapsAsk = false; sayIn(DEV.mom.live, 'Opening Maps.'); },
  };

  // Control Center's control and Android's Quick Settings tile both bring the app forward on the
  // share screen (or the live map, if sharing already), through the location prompt if it's needed.
  function quickStart() {
    S.alex.quickUsed = true;
    S.alex.banner = null;
    S.alex.island = false;
    S.alex.pip = null;
    S.alex.modal = null;
    if (['call', 'splash', 'sysperm'].includes(S.alex.screen)) S.alex.screen = 'home';
    ACTIONS.openShare();
  }

  function afterLocation() {
    const next = S.alex.afterLoc;
    S.alex.afterLoc = null;
    if (next === 'share') ACTIONS.openShare();
  }

  function act(name, el) {
    const fn = ACTIONS[name];
    if (!fn) return;
    fn(el);
    render();
  }

  function setTheme(t) {
    S.theme = t;
    try { localStorage.setItem('tml-proto-theme', t); } catch (e) {}
  }

  // Forget what each phone last drew, so the next render rebuilds it.
  function repaint() {
    Object.values(DEV).forEach((d) => { d.lastKey = null; d.lastUi = ''; d.lastTop = null; d.lastBar = ''; d.lastPip = ''; d.modalKey = ''; d.returnTo = null; });
  }

  // Switching platform keeps the session. Prompts that exist on only one platform close,
  // and Android's Settings page hands back to the app.
  // Android's views and styles load on demand: when Android is first chosen, or once the first
  // iPhone view has painted, so the switch stays instant.
  let androidLoad = null;
  function loadAndroid() {
    if (window.TML.android) return Promise.resolve();
    if (androidLoad) return androidLoad;
    const css = new Promise((res) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/android.css'; l.onload = res; l.onerror = res; document.head.appendChild(l); });
    const js = new Promise((res) => { const s = document.createElement('script'); s.src = 'js/android.js'; s.onload = res; s.onerror = res; document.head.appendChild(s); });
    androidLoad = Promise.all([css, js]);
    return androidLoad;
  }

  function setPlatform(p) {
    if (p === S.platform || !['ios', 'android'].includes(p)) return;
    if (p === 'android' && !window.TML.android) { loadAndroid().then(() => { setPlatform(p); render(); fit(); }); return; }
    S.platform = p;
    try { localStorage.setItem('tml-proto-platform', p); } catch (e) {}
    const a = S.alex;
    if (a.sys && !['locPre', 'locSys', 'locOff', 'notifPre', 'notifSys'].includes(a.sys)) a.sys = null;
    if (a.screen === 'sysperm') a.screen = (a.sysPage && a.sysPage.ret) || 'home';
    a.sysPage = null;
    a.shade = false;
    a.cc = false;
    a.menu = null;
    a.island = false;
    // A notification or snackbar from the other platform doesn't carry over.
    a.banner = null;
    a.pip = p === 'android' && a.screen === 'call' && active() ? 'open' : null;
    repaint();
  }

  // ---------- The live tick: clock, pings and timers ----------
  let lastWarned = false;
  function tick() {
    const t = Date.now();
    if (active() && t - S.world.lastPing >= PING_MS) {
      S.world.lastPing = t;
      // A precision change waits for the next ping, then both maps redraw.
      if (S.session.precisionNext) { S.session.precision = S.session.precisionNext; S.session.precisionNext = null; render(); }
      if (!quiet() && S.world.t < M.T_END) {
        S.world.t = Math.min(M.T_END, S.world.t + 0.012);
        S.world.trail.push(M.bez(S.world.t));
        if (S.world.trail.length > 14) S.world.trail.shift();
        S.world.alexLast = now();
      } else if (!quiet()) {
        S.world.alexLast = now();
      }
      if (S.mom.sharing) {
        S.world.mom = [M.HOME[0] + (Math.random() * 6 - 3), M.HOME[1] + (Math.random() * 6 - 3)];
        S.world.momLast = now();
      }
    }
    // The 1-hour limit comes first; a timer can only end sharing sooner.
    if (active() && now() >= S.session.expiresAt) {
      endSession('limit');
      if (S.alex.settings.alertExpiry) alexBanner('Sharing stopped after 1 hour', 'Share again to send a new link.', { act: 'dismissBanner' });
      render();
      return;
    }
    if (active() && S.session.stop !== 'call' && now() >= S.session.stopAt) {
      endSession('timer');
      if (S.alex.settings.alertExpiry) alexBanner('Sharing ended', 'Your timer ran out.');
      render();
      return;
    }
    // The 1-hour warning appears on its own, 5 minutes before the limit.
    if (limitSoon() !== lastWarned) { lastWarned = limitSoon(); render(); }
    // The sign-up countdown reaching zero swaps in "Send a new code".
    if (S.alex.screen === 'signup' && S.alex.signup === 'code' && resendLeft() === 0 && !document.querySelector('[data-act="resendCode"]')) render();
    updateLive();
    const callBtn = document.getElementById('ctl-call');
    if (S.call.active) callBtn.querySelector('small').textContent = mmss(now() - S.call.startedAt);
  }

  // ---------- Fit the phones to the window ----------
  function fit() {
    const devices = document.querySelector('.devices');
    const narrow = window.matchMedia('(max-width: 1180px)').matches;
    const labelH = 40;
    const availH = narrow ? window.innerHeight * 0.86 - labelH : devices.clientHeight - labelH - 8;
    const gap = parseFloat(getComputedStyle(devices).columnGap) || 48;
    const availW = narrow ? devices.clientWidth - 8 : (devices.clientWidth - gap) / 2;
    const s = Math.max(0.42, Math.min(1, availH / 868, availW / 414));
    document.querySelectorAll('.dev-scale').forEach((el) => {
      el.style.width = `${414 * s}px`;
      el.style.height = `${868 * s}px`;
      el.querySelector('.phone').style.transform = `scale(${s})`;
    });
  }

  // ---------- Start ----------
  function boot() {
    S = fresh();
    mount('alex');
    mount('mom');
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', () => { fn(); render(); }); };
    const showPhone = (who) => { if (window.matchMedia('(max-width: 1180px)').matches) S.show = who; };

    on('ctl-call', () => { if (S.call.active) endCall(); else startCall(); });
    on('ctl-signal', () => {
      if (!active()) return;
      S.world.signalLost = !S.world.signalLost;
      if (S.world.signalLost) {
        const body = seesLast();
        alexBanner('No GPS signal', body, { kind: 'app', snack: `No GPS signal. ${body}` });
      } else if (!quiet()) S.world.alexLast = now();
    });
    // Losing the connection is not losing GPS: the phone knows where it is but can't send it.
    on('ctl-offline', () => {
      if (!active()) return;
      S.world.offline = !S.world.offline;
      if (S.world.offline) {
        const body = seesLast();
        alexBanner('No connection', body, { kind: 'app', snack: `No connection. ${body}` });
      } else if (!quiet()) S.world.alexLast = now();
    });
    // Quick start during a call: the iPhone's Control Center, or Android's Quick Settings.
    on('ctl-quick', () => {
      if (!S.call.active || !S.alex.onboarded) return;
      if (S.platform === 'android') S.alex.shade = S.alex.shade === 'qs' ? false : 'qs';
      else S.alex.cc = !S.alex.cc;
      showPhone('alex');
      fit();
    });
    // Testing aid: bring the session to the 1-hour limit in a moment, timers capped with it.
    on('ctl-limit', () => {
      if (!active()) return;
      const s = S.session;
      // Through the 5-minute warning to the limit in a few seconds.
      s.expiresAt = now() + 6000;
      s.startedAt = s.expiresAt - LIMIT_MS;
      if (s.stopAt) s.stopAt = Math.min(s.stopAt, s.expiresAt);
    });
    on('ctl-later', () => { S.mom.notif = false; S.mom.screen = 'expired'; showPhone('mom'); });
    // More states: sign-up and the viewer's page.
    on('dev-number', () => { S.dev.badNumber = !S.dev.badNumber; S.alex.numberErr = false; });
    on('dev-sendfail', () => { S.dev.sendFail = !S.dev.sendFail; });
    on('dev-expire', () => { S.dev.codeExpired = !S.dev.codeExpired; });
    on('dev-broken', () => { S.mom.notif = false; S.mom.screen = 'invalid'; showPhone('mom'); });
    on('dev-mapfail', () => { S.mom.mapFailed = !S.mom.mapFailed; showPhone('mom'); });
    on('dev-nogeo', () => { S.mom.noGeo = !S.mom.noGeo; showPhone('mom'); });
    document.getElementById('restart').addEventListener('click', () => {
      const { theme, platform, text } = S;
      S = fresh();
      Object.assign(S, { theme, platform, text });
      repaint();
      render();
      setTimeout(() => { if (S.alex.screen === 'splash') { S.alex.screen = 'onboarding'; render(); } }, 1700);
    });
    document.querySelectorAll('[data-theme-set]').forEach((b) => b.addEventListener('click', () => { setTheme(b.dataset.themeSet); render(); }));
    document.querySelectorAll('[data-platform-set]').forEach((b) => b.addEventListener('click', () => { setPlatform(b.dataset.platformSet); render(); fit(); }));
    document.querySelectorAll('[data-text-set]').forEach((b) => b.addEventListener('click', () => {
      S.text = b.dataset.textSet;
      try { localStorage.setItem('tml-proto-text', S.text); } catch (e) {}
      repaint();
      render();
    }));
    document.querySelectorAll('[data-show-btn]').forEach((b) => b.addEventListener('click', () => { S.show = b.dataset.showBtn; render(); fit(); }));
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
    window.addEventListener('resize', () => { fit(); render(); });

    const start = () => {
      render();
      fit();
      setInterval(tick, 1000);
      setTimeout(() => { if (S.alex.screen === 'splash') { S.alex.screen = 'onboarding'; render(); } }, 1700);
    };
    if (S.platform === 'android') loadAndroid().then(start);
    else {
      start();
      const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1200));
      requestAnimationFrame(() => idle(() => loadAndroid()));
    }
  }

  // ---------- What js/android.js builds on ----------
  window.TML.accFail = (el) => { ACC_MISSING.add(el.getAttribute('src')); el.style.display = 'none'; };
  // A mascot render that can't load: the Original render, then the flat SVG, then nothing.
  window.TML.mascotFail = (el) => {
    const id = el.dataset.id;
    const src = el.getAttribute('src') || '';
    if (src.includes('/colors/')) el.setAttribute('src', ASSET.mascot(id));
    else if (src.endsWith('.png')) el.setAttribute('src', ASSET.flat(id));
    else el.style.visibility = 'hidden';
  };
  window.TML.core = {
    get S() { return S; },
    M, SETS, MASCOTS, COLORS, ACCESSORIES, ACC_FOR, ASSET, LINK, PHONE, CODE, ACTIONS, DEV, PING_S, ic,
    now, fmt, clock, mmss, ago, minutes, agoSpoken, minutesSpoken, dual, badge, liveBadge, tilesHtml, alexDetailSpoken, focusNext,
    an, currentLook, sessionLook, lookImg, sessionMascotImg, accSrcFor, limitSoon, limitLine, WARN_MS, shareBackPossible, shareBackNote, sbNoteHtml, frameMap, bandOf,
    mascotName, mascotSrc, mascotLabel, hueFilter, mascotImg, accLayer, accFor, accName, accSrc, pickSet, swatchFor,
    active, callActive, alexPos, sharedPos, approx, quiet, stopAt, endAt, stopLabel, stopShort, stopOptions, shareSheetUntil,
    distance, distanceSpoken, momState, distTile, islandShort, islandSub, alexDetail, statusWord,
    link, linkFor, esc, vn, who, viewerMark, liveSub, endedWhy, deletedBy, resendLeft,
    viewerParts, expiredPage, invalidPage, mapView, alexBanner, bannerText, afterLocation, quickStart, render, bind, sendMessage,
  };

  document.addEventListener('DOMContentLoaded', boot);
})();
