/* Track Me Live click-through prototype: the Android version of both phones.
   Same state, same flows and the same app content as the iPhone version (js/app.js), drawn as a
   Material 3 app in our tokens, with Android's own chrome: status bar, gesture handle, heads-up
   notifications, snackbars, the system permission dialogs and Settings, picture-in-picture,
   Gboard, the sharesheet, Google Phone's call screen, the lock screen and Chrome. */
(function () {
  'use strict';

  const C = window.TML.core;
  const M = C.M;
  const A = C.ACTIONS;
  const LOGO = C.ASSET.logo;

  // Material Symbols Rounded, outlined or filled.
  const I = (name, cls) => `<span class="ms${cls ? ` ${cls}` : ''}" aria-hidden="true">${name}</span>`;
  const IF = (name, cls) => I(name, `fill${cls ? ` ${cls}` : ''}`);
  // The Callout in one color, for the status bar and notification headers (Android's small icon).
  const MARK = '<svg class="mono-mark" viewBox="22 11 87.5 101.5" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M52.32 91.59 A40 40 0 1 0 29.75 70.9 Q32.39 88.89 29.1 104 Q29 109 33.01 106.01 Q41.61 97.24 52.32 91.59 Z M90.25 54 A24.25 24.25 0 1 0 41.75 54 A24.25 24.25 0 1 0 90.25 54 Z M83.75 54 A17.75 17.75 0 1 0 48.25 54 A17.75 17.75 0 1 0 83.75 54 Z M76.5 54 A10.5 10.5 0 1 0 55.5 54 A10.5 10.5 0 1 0 76.5 54 Z"/></svg>';
  const appIcon = (cls) => `<span class="a-appicon${cls ? ` ${cls}` : ''}"><img src="${LOGO('app-icon-default.svg')}" alt=""></span>`;
  const PIP_W = 156;
  const PIP_H = 208;

  const granted = (loc) => ['while', 'once'].includes(loc);
  const inApp = () => !['call', 'sysperm'].includes(C.S.alex.screen);
  const until = () => (C.S.session.stop === 'call' ? 'Until the call ends' : `Until ${C.fmt(C.stopAt())}`);

  // ---------- Building blocks ----------
  const topbar = (o) => `<div class="a-top">${o.back ? `<button class="a-iconbtn" type="button" data-act="${o.back}" aria-label="${o.backLabel || 'Back'}">${I('arrow_back')}</button>` : '<span class="a-top-gap"></span>'}${o.title ? `<h1 class="a-top-title">${o.title}</h1>` : '<span class="a-top-title"></span>'}${o.trail || ''}</div>`;

  const navbar = (cur) => `<nav class="a-nav" aria-label="Navigation">${[['home', 'home', 'Home'], ['mascot', 'face', 'Mascot'], ['settings', 'settings', 'Settings']]
    .map(([id, icon, label]) => `<button type="button" data-act="tab" data-tab="${id}" ${cur === id ? 'aria-current="page"' : ''}><span class="ind">${cur === id ? IF(icon) : I(icon)}</span><span class="lb">${label}</span></button>`).join('')}</nav>`;

  // Material 3 switch with icons on the thumb.
  const sw = (attrs, checked, label, variant) => `<span class="a-switch${variant ? ` ${variant}` : ''}"><input type="checkbox" role="switch" ${attrs} ${checked ? 'checked' : ''} aria-label="${label}"><span class="tr"></span><span class="th">${I('check', 'on')}${I('close', 'off')}</span></span>`;

  // One list item: leading icon, headline, supporting text, trailing control.
  const li = (o) => {
    const tag = o.tag || (o.act ? 'button' : 'div');
    const attrs = o.act ? `type="button" data-act="${o.act}"${o.data || ''}` : o.attrs || '';
    return `<${tag} class="a-li${o.sp ? ' two' : ''}${o.cls ? ` ${o.cls}` : ''}" ${attrs}>${o.lead ? `<span class="lead">${o.lead}</span>` : ''}<span class="tx"><span class="hl">${o.hl}</span>${o.sp ? `<span class="sp">${o.sp}</span>` : ''}</span>${o.trail || ''}</${tag}>`;
  };

  // Segmented buttons. The group is a size container: when the labels no longer fit side by side (large
  // text), the segments stack into one column instead of cutting a label short (android.css).
  const seg = (act, val, opts, label, attr = 'v', cls = '') => `<div class="a-seg${cls ? ` ${cls}` : ''}" role="group" aria-label="${label}"><div class="a-seg-in">${opts.map(([v, l]) => `<button type="button" data-act="${act}" data-${attr}="${v}" aria-pressed="${v === val}">${v === val ? I('check') : ''}<span>${l}</span></button>`).join('')}</div></div>`;

  // Material 3 top app bar for top-level scrolling screens: one solid band from the status bar down.
  // At rest it shows the 28/36 headline; once the content scrolls under it, the title collapses to
  // 22/28 and the band takes the raised surface (chrome() sets .a-scrolled).
  const appBar = (title) => `<div class="a-appbar"><h1 class="a-appbar-t">${title}</h1></div>`;

  // The user's own name, as given at sign-up (1 to 24 characters), escaped: C.an(), shared with iOS.
  const myName = () => (C.an ? C.an() : C.esc((C.S.alex.name || 'Alex').trim() || 'Alex'));
  const myInitial = () => C.esc(((C.S.alex.name || '').trim() || 'Alex').charAt(0).toUpperCase());

  const page = (o) => ({ key: `a-${o.key}`, cls: `a-page${o.cls ? ` ${o.cls}` : ''}`, html: o.html, after: o.after || '', darkChrome: !!o.dark, withMap: !!o.withMap });

  // ---------- Alex: the app ----------
  function viewAlex() {
    switch (C.S.alex.screen) {
      case 'splash': return viewSplash();
      case 'onboarding': return viewOnboarding();
      case 'signup': return viewSignup();
      case 'picker': return viewPicker();
      case 'share': return viewShare();
      case 'live': return viewLive();
      case 'ended': return viewEnded();
      case 'settings': return viewSettings();
      case 'call': return viewCall('alex');
      case 'sysperm': return viewSysPage();
      default: return viewHome();
    }
  }

  // Android 12+ splash screen: the adaptive icon in its circle, the wordmark as the branding image.
  function viewSplash() {
    const t = C.S.theme;
    const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    return page({
      key: 'splash', cls: 'a-splash',
      html: `<span class="a-splash-icon">${appIcon()}</span><img class="a-splash-brand" src="${LOGO(dark ? 'wordmark-on-dark.svg' : 'wordmark.svg')}" alt="Track Me Live">`,
    });
  }

  function viewOnboarding() {
    const S = C.S;
    const i = S.alex.ob;
    const pages = [
      {
        art: `<span class="glow"></span><img class="hero" src="${C.ASSET.mascot('fox')}" alt="" data-id="fox" onerror="TML.mascotFail(this)">`,
        title: 'Share where you are, the moment you’re on the phone.',
        body: '<p class="a-ob-body">One tap during a call, and the person you’re talking to can follow you live. They don’t need the app.</p>',
      },
      {
        // An illustration: the words below say what it shows, so screen readers skip it.
        art: `<div class="a-ob-map" aria-hidden="true">
            ${M.svg('120 120 300 255')}
            <div class="mk sharer" style="left:${(M.bez(0.66)[0] - 120) * 1.1}px;top:${(M.bez(0.66)[1] - 120) * 1.1}px"><div class="halo"></div><div class="disc"><img src="${C.ASSET.mascot('fox')}" alt="" data-id="fox" onerror="TML.mascotFail(this)"></div></div>
            <div class="mk viewer" style="left:${(M.HOME[0] - 120) * 1.1}px;top:${(M.HOME[1] - 120) * 1.1 + 30}px"><div class="halo"></div><div class="disc">M</div></div>
          </div>`,
        title: 'Live Together',
        body: '<p class="a-ob-body">While you talk, they can share back. You both see one map until the call ends.</p>',
      },
      {
        art: `<span class="glow"></span><img src="${LOGO('mark.svg')}" alt="" style="position:relative;width:140px">`,
        title: 'Private by default',
        body: `<div class="a-ob-list">
            <div>${I('shield')}<span>Nothing is shared until you tap Share.</span></div>
            <div>${I('schedule')}<span>Sharing stops when the call ends, or when your timer runs out.</span></div>
            <div>${I('delete')}<span>Location points are deleted 24 hours after you stop.</span></div>
          </div>`,
      },
    ];
    const p = pages[i];
    return page({
      key: `ob-${i}`, cls: 'a-ob',
      html: `<div class="a-top"><span class="a-top-gap"></span><span class="a-top-title"></span>${i < 2 ? '<button class="a-btn text" type="button" data-act="obSkip">Skip</button>' : ''}</div>
        <div class="a-content">
          <div class="ob-art a-ob-art">${p.art}</div>
          <h1 class="a-ob-title">${p.title}</h1>${p.body}
          <div class="grow"></div>
          <div class="a-dots" aria-hidden="true">${pages.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
          <button class="a-btn filled lg block" type="button" data-act="obNext">${i < 2 ? 'Continue' : 'Get started'}</button>
        </div>`,
    });
  }

  // Sign-up: outlined text fields, then the code with Gboard and Android's SMS autofill chip.
  // A wrong or expired code says so; a new code can be sent after 30 seconds.
  function viewSignup() {
    const S = C.S;
    const a = S.alex;
    if (a.signup === 'details') {
      const number = S.dev.badNumber ? '(415) 555-01' : C.PHONE;
      return page({
        key: 'signup-details',
        html: `${topbar({ back: 'signupBack' })}
          <div class="a-content scroll">
            <h1 class="a-hl">Create your account</h1>
            <p class="a-lede">Your name goes on your live map. Your number keeps the account yours.</p>
            <div class="a-field a-vfield a-namefield${a.nameErr ? ' bad' : ''}"><label class="a-flabel" for="name-android">Name</label><input id="name-android" type="text" data-input="setName" value="${C.esc(a.name || '')}" maxlength="24" autocomplete="given-name" autocapitalize="words" spellcheck="false" aria-describedby="${a.nameErr ? 'name-err' : 'name-help'}"${a.nameErr ? ' aria-invalid="true"' : ''}></div>
            ${a.nameErr ? `<p class="a-err" id="name-err">${IF('error')}<span>Enter your name. It’s what people see when you share.</span></p>` : '<p class="a-help" id="name-help">Up to 24 characters.</p>'}
            <div class="a-field${a.numberErr ? ' bad' : ''}"><span class="a-flabel">Mobile number</span><span class="a-fval"><span class="a-cc">US +1${I('arrow_drop_down')}</span><span class="tnum" ${a.numberErr ? 'aria-describedby="num-err"' : ''}>${number}</span></span></div>
            ${a.numberErr ? `<p class="a-err" id="num-err">${IF('error')}<span>Enter your full mobile number, like ${C.PHONE}.</span></p>` : '<p class="a-help">People you share with see your name and mascot, never your number.</p>'}
            ${a.sendErr ? `<p class="a-err">${IF('error')}<span>We couldn’t send the code. Check your connection, then try again.</span></p>` : ''}
            <div class="grow"></div>
            <button class="a-btn filled lg block" type="button" data-act="sendCode">${a.sendErr ? 'Try again' : 'Send code'}</button>
            <p class="a-fine">We’ll text you a 6-digit code. Message and data rates may apply.</p>
          </div>`,
      });
    }
    const code = a.code;
    const left = C.resendLeft();
    const msg = a.codeErr === 'wrong' ? `<p class="a-err center" id="code-err">${IF('error')}<span>That code didn’t work. Check the text and try again.</span></p>`
      : a.codeErr === 'expired' ? `<p class="a-err center" id="code-err">${IF('error')}<span>That code has expired. Send a new one.</span></p>`
      : code.length === 6 ? '<p class="a-help center">Checking the code…</p>'
      : a.codeNote ? `<p class="a-help center">${a.codeNote}</p>` : '';
    const resend = a.codeErr === 'expired' || left === 0
      ? '<button class="a-btn text a-resend" type="button" data-act="resendCode">Send a new code</button>'
      : `<p class="a-help center" data-bind="resend">You can send a new code in 0:${String(left).padStart(2, '0')}.</p>`;
    const keys = [['1'], ['2'], ['3'], ['−', 'fn', ''], ['4'], ['5'], ['6'], [I('space_bar'), 'fn', ''], ['7'], ['8'], ['9'], [I('backspace'), 'fn', 'del'], [',', 'fn', ''], ['0'], ['.', 'fn', ''], [I('check'), 'go', '']];
    return page({
      key: 'signup-code', cls: 'a-code',
      html: `${topbar({ back: 'signupBack' })}
        <div class="a-content">
          <h1 class="a-hl">Enter the code</h1>
          <p class="a-lede">Sent by text to +1 <span class="tnum">${C.PHONE}</span>.</p>
          <div class="a-otp${a.codeErr ? ' bad' : ''}" role="group" aria-label="6-digit code" ${a.codeErr ? 'aria-describedby="code-err"' : ''}>${[0, 1, 2, 3, 4, 5].map((k) => `<span class="${code[k] ? 'on' : k === code.length ? 'cur' : ''}">${code[k] || ''}</span>`).join('')}</div>
          ${msg}${resend}
          <div class="grow"></div>
        </div>
        <div class="a-kb">
          <div class="a-kb-strip">
            <span class="a-kb-tool" aria-hidden="true">${I('apps')}</span>
            <button class="a-kb-otp" type="button" data-act="fillCode" ${code.length === 6 || a.codeErr === 'expired' ? 'disabled' : ''} aria-label="Fill in code ${C.CODE} from Messages">${IF('sms')}<b class="tnum">${C.CODE}</b></button>
            <span class="a-kb-tool" aria-hidden="true">${I('mic')}</span>
          </div>
          <div class="a-kb-keys">${keys.map(([k, c, v]) => {
            const val = v === undefined ? k : v;
            return val ? `<button type="button" class="${c || ''}" data-act="typeKey" data-k="${val}" ${val === 'del' ? 'aria-label="Delete"' : ''}>${k}</button>` : `<span class="${c || ''}" aria-hidden="true">${k}</span>`;
          }).join('')}</div>
        </div>`,
    });
  }

  function viewPicker() {
    const S = C.S;
    const fromTab = S.alex.pickerFrom === 'tab';
    const accs = C.accFor();
    const sets = C.SETS.map((t) => [t.id, t.name]);
    return page({
      key: `picker-${fromTab}`, cls: fromTab ? 'tabbed' : '',
      html: `${appBar('Your mascot')}<div class="a-content scroll">
          <p class="a-lede first">It marks where you are on the map, for you and whoever follows you.</p>
          <div class="pick-stage a-stage"><span class="glow"></span>${C.mascotImg('stage-img', 160).replace('alt=""', `alt="${C.mascotLabel()}"`)}</div>
          <h2 class="a-label">Character</h2>
          ${seg('pickSet', C.pickSet(), sets, 'Character set', 'id', 'three')}
          <div class="a-pick-grid" role="group" aria-label="Character">${C.MASCOTS.filter((m) => m.set === C.pickSet()).map((m) => `<button class="a-pick" type="button" data-act="pickMascot" data-id="${m.id}" aria-pressed="${m.id === S.alex.mascot}"><img src="${C.ASSET.mascot(m.id, S.alex.color)}" alt="" data-id="${m.id}" onerror="TML.mascotFail(this)">${m.name}${m.id === S.alex.mascot ? `<span class="pick-check">${I('check')}</span>` : ''}</button>`).join('')}</div>
          <h2 class="a-label">Color</h2>
          <div class="a-swatches" role="group" aria-label="Color">${C.COLORS.map((c) => `<button class="a-swatch" type="button" data-act="pickColor" data-id="${c.id}" aria-pressed="${c.id === S.alex.color}" aria-label="${c.name}" style="background:${C.swatchFor(c)}">${c.id === S.alex.color ? I('check') : ''}</button>`).join('')}</div>
          <h2 class="a-label">Accessory</h2>
          ${accs.length
            ? `<div class="a-chips" role="group" aria-label="Accessory">${['none', ...accs].map((id) => `<button class="a-chip" type="button" data-act="pickAccessory" data-id="${id}" aria-pressed="${id === S.alex.accessory}">${id === S.alex.accessory ? I('check') : ''}${C.accName(id)}</button>`).join('')}</div>`
            : '<p class="a-acc-none">The astronaut’s helmet doesn’t take accessories.</p>'}
        </div>
        <div class="a-bottom${fromTab ? ' over-nav' : ''}"><button class="a-btn filled lg block" type="button" data-act="savePicker">${fromTab ? 'Save' : 'Continue'}</button></div>`,
      after: fromTab ? navbar('mascot') : '',
    });
  }

  function viewHome() {
    const S = C.S;
    const c = S.call.active;
    const live = C.active();
    let card;
    if (live) {
      card = `<button class="a-card live" type="button" data-act="openLive">
          <span class="a-card-row">${C.badge('live', 'LIVE', 'Sharing live', true)}<b>${C.vn() ? `Sharing with ${C.vn()}` : 'Sharing live'}</b></span>
          <span class="a-card-tx">${S.mom.sharing ? 'You’re both live. ' : ''}Tap to open the map.</span>${I('chevron_right', 'go')}</button>`;
    } else if (c) {
      card = `<div class="a-card call">
          <div class="a-card-row"><span class="calldot"></span><b>On a call · <span class="tnum" data-bind="calltime">00:00</span></b></div>
          <p class="a-card-tx">Share your location with the person you’re talking to. They don’t need the app.</p>
          <button class="a-btn filled lg block" type="button" data-act="openShare">${IF('near_me')}Share live location</button></div>`;
    } else {
      card = `<div class="a-card">
          <div class="a-card-row muted">${I('call')}Not on a call</div>
          <p class="a-card-tx muted">When you’re on a call with Track Me Live open, we’ll offer to share your location. You can also add a one-tap control.</p></div>`;
    }
    // After the first share, and never during a call: add the Quick Settings tile for next time.
    const tipCard = S.alex.everEnded && !S.alex.tipDone && !c && !live
      ? `<div class="a-card tip">
          <div class="a-card-row"><span class="ask-ic">${IF('near_me')}</span><b>Share faster during calls</b></div>
          <p class="a-card-tx muted">Add the Share location tile to Quick Settings. During a call, swipe down and tap it to open the share screen.</p>
          <div class="a-card-acts"><button class="a-btn text" type="button" data-act="tipLater">Not now</button><button class="a-btn tonal" type="button" data-act="aTileAsk">Add tile</button></div>
        </div>`
      : '';
    return page({
      key: 'home', cls: 'tabbed',
      html: `<div class="a-content scroll">
          <p class="a-kicker">Good evening</p>
          <h1 class="a-hl big">Hi, ${myName()}</h1>
          ${card}${tipCard}
          <div class="hero-card a-hero">
            <div class="art">${C.mascotImg()}</div>
            <div><div class="t1">${C.mascotName()}</div><p class="a-hero-tx">Your marker on the map.</p>
            <span class="pill ${live ? 'live' : 'seen'}"><span class="d"></span>${live ? 'Sharing live' : 'Not sharing'}</span></div>
          </div>
          ${!c && !live ? `<button class="a-btn filled lg block a-cta" type="button" data-act="openShare">${IF('near_me')}Share live location</button><p class="a-fine">You’ll choose who gets the link.</p>` : ''}
        </div>`,
      after: navbar('home'),
    });
  }

  // Without the Phone permission the app can't tell when a call ends: sharing runs on a timer
  // and share back stays off, because it must never outlive the call.
  const blind = () => C.S.call.active && C.S.alex.perm.phone !== 'allowed';

  function viewShare() {
    const S = C.S;
    const c = S.call.active;
    const st = S.session;
    const noPhone = blind();
    const start = M.bez(M.T_START);
    const vb = [start[0] - 150, start[1] - 88];
    return page({
      key: 'share',
      html: `${topbar({ back: 'goHome', backLabel: 'Home', trail: c ? '<span class="pill call a-trailpill"><span class="d"></span>On a call · <span data-bind="calltime">00:00</span></span>' : '' })}
        <div class="a-content scroll">
          <h1 class="a-hl">Share where you are</h1>
          <p class="a-lede">${c ? 'The person you’re talking to follows you live in their browser. No app needed.' : 'Whoever gets the link follows you live in their browser. No app needed.'}</p>
          <div class="share-preview a-preview">
            ${M.svg(`${vb[0]} ${vb[1]} 358 210`)}
            <div class="mk sharer${st.precision === 'approximate' ? ' approx' : ''}" aria-hidden="true" style="left:150px;top:88px"><div class="area"></div><div class="halo"></div><div class="disc">${C.mascotImg()}</div><div class="name"><span>You</span></div></div>
            ${c && st.shareBack && !noPhone ? `<div class="ghost-mk" aria-hidden="true">+</div><div class="ghost-lbl"><span>${C.esc(S.alex.viewerName.trim()) || 'Them'}</span></div>` : ''}
            <div class="cap">${c && st.shareBack && !noPhone ? `${C.badge('together', 'LIVE TOGETHER', 'Live Together')}<span>You both see one map</span>` : `${C.badge('live', 'LIVE', 'Sharing live', true)}<span>They see you move as you go</span>`}</div>
          </div>
          <div class="a-field a-vfield"><label class="a-flabel" for="viewer-android">Who it’s for (optional)</label><input id="viewer-android" type="text" data-input="setViewer" value="${C.esc(S.alex.viewerName)}" placeholder="Name" maxlength="24" autocomplete="off" spellcheck="false"><button class="a-iconbtn" type="button" data-act="clearViewer" data-clear-for="viewer-android" aria-label="Clear the name"${S.alex.viewerName.trim() ? '' : ' hidden'}>${IF('cancel')}</button></div>
          <p class="a-help">Only you see the name. They see your name and mascot.</p>
          <div class="a-group a-share-list">
            ${li({ act: 'openTimer', lead: I('timer'), hl: 'Stops', sp: C.stopLabel(st.stop) })}
            <div class="a-li stack lead-row"><span class="lead">${I('my_location')}</span><span class="tx"><span class="hl">Location</span>${seg('aSetSessionPrecision', st.precision, [['precise', 'Precise'], ['approximate', 'Approximate']], 'Location detail')}</span></div>
            ${c && !noPhone ? li({ tag: 'label', lead: I('group'), hl: 'Let them share back', sp: 'Only during this call.', trail: sw('data-change="toggleShareBack"', st.shareBack, 'Let them share back', 'viewer') }) : ''}
          </div>
          ${noPhone ? `<p class="a-note">${I('info')}<span>Without Phone access, sharing stops on a timer and they can’t share back.</span></p>` : ''}
        </div>
        <div class="a-bottom">
          <button class="a-btn filled lg block" type="button" data-act="openShareSheet">${IF('near_me')}Share live location</button>
          <p class="a-fine">Next, choose who gets the link.</p>
        </div>`,
    });
  }

  function viewLive() {
    const S = C.S;
    const c = C.callActive();
    const lost = C.quiet();
    const ms = C.momState();
    const together = S.mom.sharing;
    // Back to call needs the Phone permission; without it, the status bar's call chip returns to the call.
    const back = c && S.alex.perm.phone === 'allowed' ? `<button class="a-btn call" type="button" data-act="aBackToCall">${IF('call')}Back to call</button>` : '';
    const bar = c
      ? `<button class="a-iconbtn" type="button" data-act="goHome" aria-label="Home">${I('arrow_back')}</button><span class="calldot" aria-hidden="true"></span><div class="txt"><span class="t1">On a call</span><span class="t2"><span data-bind="calltime">00:00</span></span></div>${back}`
      : `<button class="a-iconbtn" type="button" data-act="goHome" aria-label="Home">${I('arrow_back')}</button><div class="av sharer bar-av" aria-hidden="true">${C.sessionMascotImg('', 30)}</div><div class="txt"><span class="t1">Sharing live</span><span class="t2">Stops at ${C.fmt(C.endAt())}</span></div>`;
    // Location detail, mid-session: the change waits for the next ping, so the control shows the
    // choice that's coming and says when it takes effect.
    const s = S.session;
    const precNow = s.precisionNext || s.precision;
    const prec = `<div class="a-live-prec">
            <div class="a-live-prec-row"><span class="lbl" aria-hidden="true">${I('my_location')}Location</span>${seg('aTogglePrecision', precNow, [['precise', 'Precise'], ['approximate', 'Approximate']], 'Location detail')}</div>
            ${s.precisionNext ? `<p class="a-prec-note">${I('schedule')}<span>${s.precisionNext === 'approximate' ? 'Approximate' : 'Precise'} from the next update</span></p>` : ''}
          </div>`;
    // 1-hour warning: a quiet line, 5 minutes before the limit. No sound and no way to extend.
    const limit = C.limitSoon() ? `<p class="a-limit">${I('timer')}<span>${C.limitLine().replace('1-hour limit', '<span class="nw">1-hour limit</span>')}</span></p>` : '';
    return page({
      key: 'live', cls: `a-live${together ? ' together' : ''}`, withMap: true,
      html: `<div class="a-mapbar">${bar}</div>
        <div class="a-mapgap" aria-hidden="true"></div>
        <div class="a-bsheet">
          <div class="a-handle" aria-hidden="true"></div>
          <div class="head">
            <div class="title"><h2 tabindex="-1">${together ? 'Live Together' : 'Sharing live'}</h2>${C.liveBadge()}</div>
            <p class="sub">${C.liveSub()}</p>${limit}
          </div>
          ${C.tilesHtml()}
          <div class="people">
            <div class="person"><div class="av sharer" aria-hidden="true">${C.sessionMascotImg()}</div><div class="txt"><span class="t1">You</span><span class="t2">${C.dual(C.alexDetail(), C.alexDetailSpoken(), 'alexDetail', 'alexDetailSr')}</span></div>
              <span class="st ${lost ? 'idle' : 'sharer'}"><span class="d" aria-hidden="true"></span>${lost ? 'Last seen' : 'Live'}</span></div>
            <div class="person"><div class="av ${ms.av}" aria-hidden="true">${C.viewerMark()}</div><div class="txt"><span class="t1">${C.who.label()}</span><span class="t2">${ms.t2}</span></div>
              ${ms.canAsk ? '<button class="a-btn ask" type="button" data-act="askShare">Ask to share</button>' : `<span class="st ${ms.st}"><span class="d" aria-hidden="true"></span>${ms.word}</span>`}</div>
            ${C.sbNoteHtml()}
          </div>
          ${prec}
          <div class="a-actions">
            <button class="a-btn tonal" type="button" data-act="openTimer">${I('timer')}Change timer</button>
            <button class="a-btn tonal" type="button" data-act="openShareSheet">${I('share')}Send link again</button>
          </div>
          <div class="a-stopbar"><button class="a-btn danger lg block" type="button" data-act="askStop">${IF('stop_circle')}Stop sharing</button></div>
        </div>`,
    });
  }

  function viewEnded() {
    const s = C.S.session;
    const why = C.endedWhy(s);
    const limit = s.reason === 'limit';
    const n = C.vn();
    const row = (k, v) => `<div class="a-li"><span class="tx"><span class="hl muted">${k}</span></span><b>${v}</b></div>`;
    return page({
      key: 'ended',
      html: `<div class="a-content">
          <div class="grow"></div>
          <div class="a-ended-art" aria-hidden="true">${C.sessionMascotImg('', 124, 'opacity:.85;')}</div>
          <h1 class="a-hl center" tabindex="-1">${limit ? 'Sharing stopped after 1 hour' : 'Sharing ended'}</h1>
          <p class="a-lede center">${why}</p>
          <div class="a-group a-summary">
            ${n ? row('Shared with', n) : ''}${row('Shared for', C.minutes(s.endedAt - s.startedAt))}
            ${row(n ? `${n} opened it` : 'Link opened', s.viewedAt ? C.fmt(s.viewedAt) : 'Not opened')}${row(n ? `${n} shared back` : 'Shared back', C.S.mom.everShared ? 'Yes' : 'No')}
          </div>
          <p class="a-fine">${C.deletedBy(s)}</p>
          <div class="grow"></div>
          ${limit
            ? `<button class="a-btn filled lg block" type="button" data-act="shareAgain">${IF('near_me')}Share again</button><button class="a-btn text block a-done" type="button" data-act="done">Done</button>`
            : '<button class="a-btn filled lg block" type="button" data-act="done">Done</button>'}
        </div>`,
    });
  }

  function viewSettings() {
    const S = C.S;
    const st = S.alex.settings;
    const p = S.alex.perm;
    const swRow = (key, label, sub) => li({ tag: 'label', hl: label, sp: sub, trail: sw(`data-change="setting" data-key="${key}"`, st[key], label) });
    const locWord = { unset: 'Not set', while: 'While using the app', once: 'Only this time', ask: 'Ask every time', denied: 'Don’t allow' }[p.loc];
    const phoneWord = p.phone === 'allowed' ? 'Allowed' : 'Not allowed';
    const notifWord = { unset: 'Not set', allowed: 'Allowed', denied: 'Off' }[p.notif];
    return page({
      key: 'settings', cls: 'tabbed',
      html: `${appBar('Settings')}<div class="a-content scroll">
          <h2 class="a-sec first">Sharing</h2>
          <div class="a-group">
            ${swRow('offer', 'Offer to share when I’m on a call', 'When Track Me Live is open')}
            <div class="a-li stack"><span class="hl">Location detail</span>${seg('aSetPrecision', st.precision, [['precise', 'Precise'], ['approximate', 'Approximate']], 'Location detail')}</div>
            ${li({ act: 'openTimer', data: ' data-for="default"', hl: 'Default stop time', sp: C.stopLabel(st.defaultStop) })}
          </div>
          <h2 class="a-sec">Live Together</h2>
          <div class="a-group">${swRow('shareBack', 'Let people share back', 'Only during a call. Off for each call if you turn it off.')}</div>
          <h2 class="a-sec">Alerts</h2>
          <div class="a-group">${swRow('alertOpened', 'When my link is opened')}${swRow('alertCall', 'When a call ends while I’m sharing')}${swRow('alertExpiry', 'When sharing expires')}</div>
          <h2 class="a-sec">Appearance</h2>
          <div class="a-group"><div class="a-li stack">${seg('setTheme', S.theme, [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], 'Appearance', 'v', 'three')}</div></div>
          <h2 class="a-sec">Permissions</h2>
          <div class="a-group">
            ${li({ act: 'aPermLoc', lead: I('location_on'), hl: 'Location', sp: locWord })}
            ${li({ act: 'aPermPhone', lead: I('call'), hl: 'Phone', sp: `${phoneWord} · so sharing can stop when your call ends` })}
            ${li({ act: 'aPermNotif', lead: I('notifications'), hl: 'Notifications', sp: notifWord })}
          </div>
          <p class="a-foot">Sharing starts while the app is open and keeps going in the background until it stops.</p>
          <p class="a-foot">If picture-in-picture is off, sharing still works and the ongoing notification shows it.</p>
          <h2 class="a-sec">Your data</h2>
          <div class="a-group">${li({ act: 'askDelete', cls: 'danger', lead: I('delete'), hl: 'Delete account and all data' })}</div>
          <p class="a-foot">Location points are deleted 24 hours after a session ends. Session details are kept for 30 days, then deleted.</p>
        </div>`,
      after: navbar('settings'),
    });
  }

  // Google Phone's in-call screen: the phone's own UI, so it stays dark in both themes.
  function viewCall(who) {
    const name = who === 'alex' ? 'Mom' : myName();
    const btns = [['mic_off', 'Mute'], ['dialpad', 'Keypad'], ['volume_up', 'Speaker'], ['add_call', 'Add call'], ['pause', 'Hold'], ['videocam', 'Video']];
    return page({
      key: `${who}-call`, cls: 'a-call', dark: true,
      html: `<div class="a-call-head">
          <span class="a-call-av" aria-hidden="true">${who === 'alex' ? 'M' : myInitial()}</span>
          <h1 class="a-call-name">${name}</h1>
          <p class="a-call-sub">Mobile · <span class="tnum" data-bind="calltime">00:00</span></p>
        </div>
        <div class="grow"></div>
        <div class="a-call-grid" aria-hidden="true">${btns.map(([icon, l]) => `<span class="cb"><span class="ci">${I(icon)}</span>${l}</span>`).join('')}</div>
        <button class="a-endcall" type="button" data-act="endCall" aria-label="End call">${IF('call_end')}</button>`,
    });
  }

  // Android's Settings app: the app's location, phone or notification permission page.
  // A system screen, so it uses a monochrome system palette, not our brand colors.
  function viewSysPage() {
    const S = C.S;
    const pg = S.alex.sysPage || { kind: 'location' };
    const p = S.alex.perm;
    const radio = (v, label, on, sub) => `<button class="a-li${sub ? ' two' : ''}" type="button" role="radio" aria-checked="${on}" data-act="aSysSet" data-v="${v}"><span class="a-radio${on ? ' on' : ''}" aria-hidden="true"></span><span class="tx"><span class="hl">${label}</span>${sub ? `<span class="sp">${sub}</span>` : ''}</span></button>`;
    let title;
    let body;
    if (pg.kind === 'phone') {
      title = 'Phone permission';
      body = `<h2 class="a-sys-sec">Phone access for this app</h2>
        <div class="a-group" role="radiogroup" aria-label="Phone access">${radio('allow', 'Allow', p.phone === 'allowed')}${radio('deny', 'Don’t allow', p.phone !== 'allowed')}</div>`;
    } else if (pg.kind === 'notifications') {
      const on = p.notif === 'allowed';
      // Each category is a notification channel; the app's own alert switches turn the same ones on and off.
      const st = S.alex.settings;
      const cat = (key, label, sub) => li({ tag: 'label', hl: label, sp: sub, cls: on ? '' : 'off', trail: sw(`data-change="setting" data-key="${key}" ${on ? '' : 'disabled'}`, on && st[key] !== false, label) });
      title = 'Notifications';
      body = `<div class="a-group">${li({ tag: 'label', cls: 'master', hl: 'All Track Me Live notifications', trail: sw('data-change="aSysNotif"', on, 'All Track Me Live notifications') })}</div>
        <h2 class="a-sys-sec">Categories</h2>
        <div class="a-group">${cat('ongoing', 'Sharing in progress', 'Silent')}${cat('alertOpened', 'Link opened', 'Alerting')}${cat('alertCall', 'Call ended', 'Alerting')}${cat('alertExpiry', 'Sharing expired', 'Alerting')}</div>`;
    } else {
      title = 'Location permission';
      const loc = p.loc === 'once' ? 'while' : p.loc;
      body = `<h2 class="a-sys-sec">Location access for this app</h2>
        <div class="a-group" role="radiogroup" aria-label="Location access">
          ${radio('while', 'Allow only while using the app', loc === 'while')}
          ${radio('ask', 'Ask every time', loc === 'ask')}${radio('deny', 'Don’t allow', loc === 'denied' || loc === 'unset')}
        </div>
        <div class="a-group">${li({ tag: 'label', hl: 'Use precise location', sp: 'When precise location is off, apps can access your approximate location', cls: granted(p.loc) ? '' : 'off', trail: sw(`data-change="aSysPrecise" ${granted(p.loc) ? '' : 'disabled'}`, p.precise && granted(p.loc), 'Use precise location') })}</div>`;
    }
    return page({
      key: `sys-${pg.kind}`, cls: 'a-sys',
      html: `${topbar({ back: 'aSysBack' })}
        <div class="a-content scroll">
          <h1 class="a-sys-title">${title}</h1>
          <div class="a-sys-app">${appIcon()}<span>Track Me Live</span></div>
          ${body}
          <p class="a-sys-foot">${I('info')}<span>${pg.kind === 'location' ? 'Location may also come from Wi-Fi and nearby devices.' : pg.kind === 'phone' ? 'Apps with this permission can see whether you’re on a call.' : 'Notifications appear in the status bar and on the lock screen.'}</span></p>
        </div>`,
    });
  }

  // ---------- Alex: overlays ----------
  function topAlex() {
    const S = C.S;
    const a = S.alex;
    let html = '';
    if (a.modal === 'timer') {
      const forDefault = a.modalFor === 'default';
      const cur = forDefault ? a.settings.defaultStop : S.session.stop;
      // Without the Phone permission there's no call to follow, so no "When the call ends".
      const opts = C.stopOptions(forDefault).filter((v) => forDefault || v !== 'call' || !blind());
      const callOk = opts.includes('call') && !forDefault;
      const title = forDefault ? 'Default stop time' : 'When sharing stops';
      html += `<div class="a-scrim" data-act="closeModal"></div>
        <div class="a-msheet" role="dialog" aria-modal="true" aria-labelledby="tm-t" data-esc="closeModal">
          <div class="a-handle" aria-hidden="true"></div>
          <h2 class="a-sheet-title" id="tm-t">${title}</h2>
          <div class="a-radios" role="radiogroup" aria-labelledby="tm-t">${opts.map((v) => { const on = String(v) === String(cur); return `<button class="a-li" type="button" role="radio" aria-checked="${on}" data-act="setStop" data-v="${v}"${on ? ' data-autofocus' : ''}><span class="a-radio${on ? ' on' : ''}" aria-hidden="true"></span><span class="tx"><span class="hl">${C.stopLabel(v)}</span></span></button>`; }).join('')}</div>
          <p class="a-fine">Sharing never runs longer than 1 hour.${callOk ? ' If the call drops and you’ve set a timer, sharing continues until it runs out.' : ''}${S.call.active && blind() && !forDefault ? ' Without Phone access, Track Me Live can’t tell when your call ends.' : ''}</p>
        </div>`;
    }
    if (a.modal === 'sharesheet') html += sharesheet();
    if (a.alert === 'stop') {
      html += dialog({
        label: 'Stop sharing?', title: 'Stop sharing your location?',
        body: S.session.viewedAt ? `${C.vn() ? `${C.vn()} will` : 'They’ll'} see that sharing ended.` : 'Your link will stop working.',
        acts: [['Cancel', 'cancelAlert'], ['Stop', 'confirmStop', 'danger']],
        // The mini map's Stop opens the app with this dialog's Stop right where the finger was, so a
        // second tap of a double tap is ignored (data-guard: 500 ms after the screen changes).
        guard: Date.now() - pipStopAt < 1500,
      });
    }
    if (a.alert === 'delete') {
      html += dialog({
        label: 'Delete account?', icon: 'delete', title: 'Delete your account?',
        body: 'This deletes your profile, mascot and every session right away. You can’t undo it.',
        acts: [['Cancel', 'cancelAlert'], ['Delete', 'deleteAccount', 'danger']],
      });
    }
    html += sysPrompt();
    html += bannerAlex();
    if (a.shade) html += shade();
    return html;
  }

  const dialog = (o) => `<div class="a-scrim"></div>
    <div class="a-dialog${o.icon ? ' has-icon' : ''}" role="alertdialog" aria-modal="true" aria-labelledby="dl-t" aria-describedby="dl-d" data-esc="${o.acts[0][1]}">
      ${o.icon ? `<span class="a-dialog-ic" aria-hidden="true">${I(o.icon)}</span>` : ''}
      <h2 id="dl-t">${o.title}</h2><p id="dl-d">${o.body}</p>
      <div class="acts">${o.acts.map(([l, act, cls], i) => `<button class="a-btn text${cls ? ` ${cls}` : ''}" type="button" data-act="${act}"${i === 0 ? ' data-autofocus' : ''}${cls === 'danger' && o.guard ? ' data-guard' : ''}>${l}</button>`).join('')}</div>
    </div>`;

  // Our own explainer before each system prompt: a modal bottom sheet.
  const explainer = (o) => `<div class="a-scrim"></div>
    <div class="a-msheet a-explain" role="dialog" aria-modal="true" aria-labelledby="ex-t" aria-describedby="ex-d" data-esc="${o.noAct}">
      <div class="a-handle" aria-hidden="true"></div>
      <div class="ask-art a-ask-art"><span>${IF(o.icon)}</span></div>
      <h2 id="ex-t">${o.title}</h2><p class="lead" id="ex-d">${o.body}</p>
      ${o.rows ? `<div class="a-explain-rows">${o.rows.map(([icon, t, s]) => `<div class="row">${I(icon)}<div><b>${t}</b><span>${s}</span></div></div>`).join('')}</div>` : ''}
      ${o.note ? `<p class="a-fine">${o.note}</p>` : ''}
      <button class="a-btn filled lg block" type="button" data-act="${o.yesAct}">${o.yes}</button>
      <button class="a-btn text block" type="button" data-act="${o.noAct}">Not now</button>
    </div>`;

  // Android's own permission dialog (Android 14 to 16): stacked, grouped buttons.
  const sysDialog = (o) => `<div class="a-scrim"></div>
    <div class="a-sysdlg" role="alertdialog" aria-modal="true" aria-labelledby="${o.idp || 'sd'}-t"${o.esc ? ` data-esc="${o.esc}"` : ''}>
      <span class="sic" aria-hidden="true">${IF(o.icon)}</span>
      <h2 id="${o.idp || 'sd'}-t">${o.title}</h2>
      ${o.extra || ''}
      <div class="a-sysbtns">${o.btns.map(([l, act]) => `<button type="button" data-act="${act}">${l}</button>`).join('')}</div>
    </div>`;

  function locationChoice() {
    const ch = C.S.alex.locChoice;
    const p = M.bez(M.T_START);
    const opt = (v, label, vb) => `<button type="button" role="radio" aria-checked="${ch === v}" data-act="aLocChoice" data-v="${v}" class="${ch === v ? 'on' : ''}">
        <span class="pimg ${v}">${M.svg(vb)}<span class="mark"></span></span><span class="plb">${label}</span></button>`;
    return `<div class="a-prec" role="radiogroup" aria-label="Location accuracy">
        ${opt('precise', 'Precise', `${p[0] - 45} ${p[1] - 45} 90 90`)}${opt('approximate', 'Approximate', `${p[0] - 150} ${p[1] - 150} 300 300`)}
      </div>`;
  }

  function sysPrompt() {
    const S = C.S;
    switch (S.alex.sys) {
      case 'locPre':
        return explainer({ icon: 'near_me', title: 'Allow location to share', body: 'Track Me Live uses your location only while you’re sharing. Nobody sees it until you send your link, and it stops when you do.', yes: 'Continue', yesAct: 'locContinue', noAct: 'sysClose' });
      case 'locSys':
        return sysDialog({
          label: 'Location permission', icon: 'location_on', title: 'Allow <b>Track Me Live</b> to access this device’s location?', extra: locationChoice(),
          btns: [['While using the app', 'aLocWhile'], ['Only this time', 'aLocOnce'], ['Don’t allow', 'locDeny']],
        });
      case 'aLocUpgrade':
        return sysDialog({
          label: 'Precise location', icon: 'location_on', title: 'Allow <b>Track Me Live</b> to access this device’s precise location?',
          extra: `<div class="a-prec single"><span class="on"><span class="pimg precise">${M.svg(`${M.bez(M.T_START)[0] - 45} ${M.bez(M.T_START)[1] - 45} 90 90`)}<span class="mark"></span></span><span class="plb">Precise</span></span></div>`,
          btns: [['Change to precise location', 'aUpgradeYes'], ['Keep approximate location', 'aUpgradeNo']],
        });
      case 'locOff':
        return dialog({
          label: 'Location is off', icon: 'location_off', title: 'Location is off for Track Me Live',
          body: 'To share where you are, allow location in Settings. It’s only used while you share.',
          acts: [['Not now', 'sysClose'], ['Open settings', 'aSysLoc']],
        });
      case 'notifPre':
        return explainer({ icon: 'notifications_active', title: C.vn() ? `Know when ${C.vn()} opens it` : 'Know when your link is opened', body: 'Turn on alerts to hear when your link is opened, when a call ends while you’re sharing, and when sharing stops.', yes: 'Turn on alerts', yesAct: 'notifContinue', noAct: 'notifLater' });
      case 'notifSys':
        return sysDialog({ label: 'Notifications permission', icon: 'notifications', title: 'Allow <b>Track Me Live</b> to send you notifications?', btns: [['Allow', 'notifAllow'], ['Don’t allow', 'notifDeny']] });
      case 'aPhonePre':
        return explainer({
          icon: 'call', title: 'Let sharing stop with your call',
          body: 'So sharing can stop when your call ends, Track Me Live checks whether you’re on a call. It never makes, reads or records calls.',
          note: 'Android calls this permission “make and manage phone calls”.',
          yes: 'Continue', yesAct: 'aPhoneContinue', noAct: 'aPhoneLater',
        });
      case 'aPhoneSys':
        return sysDialog({ label: 'Phone permission', icon: 'call', title: 'Allow <b>Track Me Live</b> to make and manage phone calls?', btns: [['Allow', 'aPhoneAllow'], ['Don’t allow', 'aPhoneDeny']] });
      case 'aTileSys':
        // Android 13+ asks before an app adds its tile (StatusBarManager.requestAddTileService).
        return `<div class="a-scrim"></div>
          <div class="a-dialog a-tiledlg" role="alertdialog" aria-modal="true" aria-labelledby="dl-t" aria-describedby="dl-d" data-esc="aTileNo">
            <h2 id="dl-t">Add tile to Quick Settings?</h2><p id="dl-d">Track Me Live wants to add this tile to Quick Settings.</p>
            <div class="a-tile-prev" aria-hidden="true">${qsTile(false)}</div>
            <div class="acts"><button class="a-btn text" type="button" data-act="aTileNo" data-autofocus>Don’t add</button><button class="a-btn text" type="button" data-act="aTileAdd">Add tile</button></div>
          </div>`;
      default:
        return '';
    }
  }

  // Android's sharesheet: the link preview with Copy, direct-share people, then apps.
  function sharesheet() {
    const S = C.S;
    const people = ['Mom', 'Dad', 'Sam', 'Priya'];
    const apps = [['sms', 'Messages', 'Mom'], ['mail', 'Email', 'Mail'], ['nearby', 'Quick Share', 'Quick Share'], ['sticky_note_2', 'Notes', 'Notes']];
    const live = C.active();
    const lnk = live ? C.link() : C.linkFor(S.session.n + 1);
    // The link preview carries the mascot the session started with (Send link again), or the one
    // the next session will take.
    const thumb = live ? C.sessionMascotImg('', 44) : C.mascotImg('', 44);
    return `<div class="a-scrim" data-act="closeModal"></div>
      <div class="a-msheet a-sharesheet" role="dialog" aria-modal="true" aria-label="Share" data-esc="closeModal">
        <div class="a-handle" aria-hidden="true"></div>
        <div class="ss-prev"><div class="ss-thumb" aria-hidden="true">${thumb}</div><div class="tx"><b>${myName()} · Live location</b><span>${lnk} · ${C.shareSheetUntil()}</span></div></div>
        <div class="ss-chips"><button class="a-chip" type="button" data-act="sendTo" data-to="Copy">${I('content_copy')}Copy</button></div>
        <div class="ss-row">${people.map((n) => `<button class="ss-person" type="button" data-act="sendTo" data-to="${n}"><span class="ph">${n[0]}<span class="badge-app">${IF('sms')}</span></span><span class="nm">${n}</span></button>`).join('')}</div>
        <div class="ss-div"></div>
        <div class="ss-row apps">${apps.map(([icon, label, to]) => `<button class="ss-app" type="button" data-act="sendTo" data-to="${to}"><span class="sq">${IF(icon)}</span><span class="nm">${label}</span></button>`).join('')}</div>
      </div>`;
  }

  // Notifications from the server become heads-up notifications; things the app says while
  // it's open become snackbars. Android 13+ shows no notifications until they're allowed.
  function bannerAlex() {
    const S = C.S;
    const b = S.alex.banner;
    if (!b) return '';
    const snack = (text, act, label) => `<div class="a-snack" data-banner="${b.id}" aria-hidden="true"><span>${text}</span>${act ? `<button class="a-snack-act" type="button" data-act="${act}">${label}</button>` : ''}</div>`;
    // Home's on-call card is the offer, so the offer's snackbar never shows there too.
    if (b.kind === 'offer') return inApp() && S.alex.screen !== 'home' ? snack(`${b.title}. ${b.body}`, b.act, 'Share') : '';
    if (b.kind === 'app') return inApp() ? snack(b.snack || b.title) : '';
    if (S.alex.perm.notif !== 'allowed') return inApp() ? snack(`${b.title}. ${b.body}`) : '';
    return headsUp({ id: b.id, act: b.act, icon: MARK, app: 'Track Me Live', title: b.title, body: b.body });
  }

  const headsUp = (o) => `<div class="a-hun${o.cls ? ` ${o.cls}` : ''}" data-banner="${o.id || ''}">
      <button class="a-hun-main" type="button" data-act="${o.act}">
        <span class="hdr"><span class="nic${o.icCls ? ` ${o.icCls}` : ''}">${o.icon}</span><span class="app">${o.app}</span><span class="sep">•</span><span>now</span>${I('expand_more', 'exp')}</span>
        <span class="row">${o.avatar ? `<span class="nav" aria-hidden="true">${o.avatar}</span>` : ''}<span class="tx"><b>${o.title}</b><span>${o.body}</span></span></span>
      </button>
      ${o.acts ? `<div class="acts">${o.acts.map(([l, act]) => `<button type="button" data-act="${act}">${l}</button>`).join('')}</div>` : ''}
    </div>`;

  // The ongoing notification's title: "Sharing your location with Mom", or without a name.
  const sharingWith = () => `Sharing your location${C.vn() ? ` with ${C.vn()}` : ''}`;

  // A Quick Settings tile. Track Me Live's opens the app on the share screen (the live map while sharing).
  function qsTile(on, act) {
    const S = C.S;
    const sharing = C.active();
    const inner = `<span class="qi">${MARK}</span><span class="ql"><b>Share location</b><small>${sharing ? 'Sharing now' : 'Track Me Live'}</small></span>`;
    return act
      ? `<button class="a-qt tml${sharing ? ' on' : ''}" type="button" data-act="${act}" aria-label="Share location, Track Me Live${sharing ? ', sharing now' : ''}">${inner}</button>`
      : `<span class="a-qt tml${on ? ' on' : ''}">${inner}</span>`;
  }

  // The notification shade (from the status bar) and Quick Settings (fully pulled down): system tiles,
  // the ongoing call, and our foreground-service notification while sharing.
  function shade() {
    const S = C.S;
    const mode = S.alex.shade;
    const live = C.active();
    const allowed = S.alex.perm.notif === 'allowed' && S.alex.settings.ongoing !== false;
    const sys = (icon, label, sub, on) => `<span class="a-qt${on ? ' on' : ''}" aria-hidden="true"><span class="qi">${IF(icon)}</span><span class="ql"><b>${label}</b><small>${sub}</small></span></span>`;
    const tiles = mode === 'qs'
      ? `<div class="a-qs-bright" aria-hidden="true"><span class="fill">${IF('light_mode')}</span></div>
        <div class="a-qs">${sys('wifi', 'Internet', 'Home Wi-Fi', true)}${sys('bluetooth', 'Bluetooth', 'On', true)}${qsTile(false, 'aQsTile')}${sys('flashlight_on', 'Flashlight', 'Off')}${sys('do_not_disturb_on', 'Do Not Disturb', 'Off')}${sys('airplanemode_active', 'Airplane mode', 'Off')}</div>`
      : `<div class="a-qs-row">${[['wifi', true], ['bluetooth', true], ['flashlight_on'], ['do_not_disturb_on'], ['airplanemode_active']].map(([i, on]) => `<span class="${on ? 'on' : ''}" aria-hidden="true">${IF(i)}</span>`).join('')}<button class="${live ? 'on' : ''}" type="button" data-act="aQsTile" aria-label="Share location, Track Me Live">${MARK}</button></div>`;
    const callN = S.call.active
      ? `<div class="a-ntf"><button class="a-ntf-main" type="button" data-act="aShadeToCall" aria-label="Ongoing call with Mom. Return to the call"><span class="hdr"><span class="nic call">${IF('call')}</span><span class="app">Phone</span><span class="sep">•</span><span class="tnum" data-bind="calltime">00:00</span></span>
          <span class="row"><span class="tx"><b>Mom</b><span>Ongoing call</span></span></span></button>
          <div class="acts"><button class="hang" type="button" data-act="aShadeHangUp">Hang up</button></div></div>`
      : '';
    const ours = live && allowed
      ? `<div class="a-ntf ongoing">
          <button class="a-ntf-main" type="button" data-act="aNotifOpen" aria-label="${sharingWith()}. Open Track Me Live">
            <span class="hdr"><span class="nic">${MARK}</span><span class="app">Track Me Live</span><span class="sep">•</span><span>Sharing location</span></span>
            <span class="row"><span class="tx"><b>${sharingWith()}</b><span data-bind="islandSub">${C.islandSub()}</span></span><span class="lg av sharer" aria-hidden="true">${C.sessionMascotImg('', 30)}</span></span>
          </button>
          <div class="acts"><button type="button" data-act="aNotifOpen">Open</button><button class="stop" type="button" data-act="aNotifStop">Stop sharing</button></div>
        </div>`
      : '';
    // Without notification permission, Android lists the running service under "active apps" instead.
    const activeApps = live && !allowed
      ? `<div class="a-active"><span class="lbl">1 app is active</span><div class="a-active-row">${appIcon()}<span class="tx"><b>Track Me Live</b><span>Active since ${C.fmt(S.session.startedAt)}</span></span><button class="a-btn tonal" type="button" data-act="aNotifStop">Stop</button></div></div>`
      : '';
    return `<div class="a-shade ${mode}" role="dialog" aria-modal="true" aria-label="${mode === 'qs' ? 'Quick Settings' : 'Notifications'}" data-esc="aShade">
        <button class="a-shade-bg" type="button" data-act="aShade" aria-label="Close"></button>
        <div class="a-shade-in">
          <div class="a-shade-head"><span class="t tnum" data-bind="clock">${C.clock(C.now())}</span><span class="d">Sat, Oct 17</span></div>
          ${tiles}
          <div class="a-ntfs">${callN}${ours}${!callN && !ours && !activeApps ? '<p class="a-none">No notifications</p>' : ''}</div>
          ${activeApps}
        </div>
      </div>`;
  }

  // ---------- Mom: the link in Chrome ----------
  // The link page is a website: inline SVG icons, never the icon font.
  const chromeBar = () => `<div class="a-chromebar" aria-hidden="true"><div class="a-omni">${I('tune')}<span>trackme.live</span></div><span class="a-tabsw" aria-hidden="true"><i>1</i></span><span class="a-chrome-more" aria-hidden="true">${I('more_vert')}</span></div>`;

  function viewMom() {
    const S = C.S;
    const m = S.mom;
    if (m.screen === 'call') return viewCall('mom');
    if (m.screen === 'expired' || m.screen === 'invalid') return { key: `a-${m.screen}`, cls: 'expired a-web', browser: true, docTitle: `${m.screen === 'invalid' ? 'This link doesn’t work' : 'Location no longer shared'} · Track Me Live`, html: `${m.screen === 'invalid' ? C.invalidPage() : C.expiredPage()}${chromeBar()}` };
    if (m.screen === 'page' || m.screen === 'ended') {
      const p = C.viewerParts(C.ic);
      return { key: `a-${p.key}`, cls: 'a-web', withMap: true, browser: true, dim: p.ended, mapFailed: p.mapFailed, docTitle: p.docTitle, html: `${p.page}${chromeBar()}` };
    }
    const n = m.notif;
    return {
      key: 'a-lock', cls: `a-lock${n ? ' has-n' : ''}`, darkChrome: true,
      html: `<div class="wall" data-theme="dark" aria-hidden="true">${M.svg('0 0 390 844')}</div>
        <div class="a-lk-date">Sat, Oct 17</div>
        <div class="a-lk-clock tnum"><span data-bind="aLockH">9</span><span data-bind="aLockM">38</span></div>
        <div class="a-lk-bottom" aria-hidden="true"><span class="sc">${I('flashlight_on')}</span><span class="hint">${IF('lock')}</span><span class="sc">${I('photo_camera')}</span></div>`,
    };
  }

  function topMom() {
    const S = C.S;
    let html = '';
    if (S.mom.perm) {
      // Chrome's own permission dialog, with Chrome's one-time option.
      html += sysDialog({
        label: 'Location permission', icon: 'location_on', title: 'trackme.live wants to use your device’s location',
        btns: [['While visiting the site', 'allowLoc'], ['This time only', 'aAllowLocOnce'], ['Never allow', 'denyLoc']], esc: 'closePerm', idp: 'csd',
      }).replace('class="a-sysdlg"', 'class="a-sysdlg chrome"');
    }
    if (S.mom.notif) {
      // Google Messages: a conversation notification from Alex.
      const o = {
        act: 'openLink', icon: IF('chat'), icCls: 'msg', app: 'Messages', title: myName(), avatar: myInitial(),
        body: `I’m sharing my live location with you${S.call.active ? ' while we talk' : ''}. <u>${C.link()}</u>`,
      };
      html += S.mom.screen === 'lock' ? headsUp({ ...o, cls: 'lockn' }) : headsUp(o);
    }
    return html;
  }

  // ---------- OS chrome: status bar, picture-in-picture, snackbar position ----------
  const SIG = '<svg class="sb-sig" viewBox="0 0 16 16" aria-hidden="true"><path d="M14.5 1.5 V14.5 H1.5 Z" fill="currentColor"/></svg>';
  const WIFI = '<svg class="sb-wifi" viewBox="0 0 18 14" aria-hidden="true"><path d="M9 13.4 L0.6 4.6 A12.6 12.6 0 0 1 17.4 4.6 Z" fill="currentColor"/></svg>';
  const BATT = '<svg class="sb-batt" viewBox="0 0 26 13" aria-hidden="true"><rect x="0.75" y="0.75" width="21.5" height="11.5" rx="3.6" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".4"/><rect x="2.6" y="2.6" width="14" height="7.8" rx="2" fill="currentColor"/><path d="M23.6 4.4 a1.6 1.6 0 0 1 0 4.2 Z" fill="currentColor" opacity=".4"/></svg>';

  function statusBar(who) {
    const S = C.S;
    const left = [];
    const right = [];
    const screen = who === 'alex' ? S.alex.screen : S.mom.screen;
    // Android 12+ puts an ongoing call in a green chip when you're outside the Phone app; tapping it
    // returns to the call.
    const chip = S.call.active && screen !== 'call' && screen !== 'lock';
    if (who === 'alex') {
      if (C.active() && S.alex.perm.notif === 'allowed' && S.alex.settings.ongoing !== false) left.push(`<span class="a-sbic">${MARK}</span>`);
      if (C.active() && !C.quiet()) right.push(IF('location_on', 'sb-loc'));
    } else {
      if (S.mom.notif && screen !== 'lock') left.push(`<span class="a-sbic">${IF('chat')}</span>`);
      if (S.mom.sharing) right.push(IF('location_on', 'sb-loc'));
    }
    const chipHtml = chip
      ? (who === 'alex'
        ? `<button class="a-callchip-hit" type="button" data-act="aBackToCall" aria-label="Return to the call"><span class="a-callchip">${IF('call')}<span class="tnum" data-bind="calltime">00:00</span></span></button>`
        : `<span class="a-callchip">${IF('call')}<span class="tnum" data-bind="calltime">00:00</span></span>`)
      : '';
    const shadeable = who === 'alex' && (C.active() || S.call.active) && !S.alex.sys && !S.alex.alert && !S.alex.modal && screen !== 'sysperm';
    const open = shadeable || (S.alex.shade && who === 'alex');
    const inner = `<span class="l"><span class="tnum" data-bind="clock">9:38</span>${chipHtml}${left.join('')}</span><span class="r">${right.join('')}${WIFI}${SIG}${BATT}</span>`;
    return `<div class="sb">${open ? `<button class="sb-hit" type="button" data-act="aShade" aria-label="${S.alex.shade ? 'Close notifications' : 'Open notifications'}"></button>` : ''}${inner}</div>`;
  }

  const pipOn = () => {
    const S = C.S;
    return S.alex.screen === 'call' && C.active() && (S.alex.pip === 'open' || S.alex.pip === 'menu');
  };

  function pipUi() {
    const S = C.S;
    const lost = C.quiet();
    const badge = C.liveBadge();
    const cap = lost ? `<span class="pip-cap">Last seen ${C.fmt(S.world.alexLast)}</span>` : '';
    if (S.alex.pip === 'menu') {
      const c = (act, icon, label, desc) => `<button class="pip-c" type="button" data-act="${act}" aria-label="${desc}">${icon}<span>${label}</span></button>`;
      return `${badge}${cap}<div class="pip-menu">
          <button class="pip-bg" type="button" data-act="aPipTap" aria-label="Hide controls"></button>
          <div class="pip-row">${c('aPipExpand', I('open_in_full'), 'Open', 'Open the map')}${c('aPipStop', IF('stop_circle'), 'Stop', 'Stop sharing')}${c('aPipClose', I('close'), 'Close', 'Close the mini map')}</div>
        </div>`;
    }
    return `${badge}${cap}<button class="pip-hit" type="button" data-act="aPipTap" aria-label="Mini map: ${C.vn() ? `sharing with ${C.vn()}` : 'sharing your location'}${S.mom.sharing ? `, ${C.distanceSpoken()} apart` : ''}. Show controls"></button>`;
  }

  // Frame Alex (and Mom, once she shares back) inside the mini map.
  function fitPip(d) {
    const S = C.S;
    const host = d.screen.querySelector('.pip-map');
    const pts = [C.sharedPos()];
    if (S.mom.sharing) pts.push(S.world.mom);
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    const x0 = Math.min(...xs); const x1 = Math.max(...xs);
    const y0 = Math.min(...ys); const y1 = Math.max(...ys);
    const s = Math.min(PIP_W / Math.max(x1 - x0 + 140, 150), PIP_H / Math.max(y1 - y0 + 130, 200), 1);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2 + 6;
    host.style.transform = `translate(${(PIP_W / 2 - cx * s).toFixed(1)}px, ${(PIP_H / 2 - cy * s).toFixed(1)}px) scale(${s.toFixed(3)})`;
    host.style.setProperty('--pip-k', (0.8 / s).toFixed(3));
    host.style.setProperty('--pip-kc', (0.86 / s).toFixed(3));
  }

  function chrome(who, d, v) {
    d.screen.classList.toggle('shade-open', who === 'alex' && !!C.S.alex.shade);
    const bar = statusBar(who);
    if (bar !== d.lastBar) { d.screen.querySelector('.a-statusbar').innerHTML = bar; d.lastBar = bar; }
    if (who === 'alex') {
      const pip = d.screen.querySelector('.pip');
      const on = pipOn();
      pip.hidden = !on;
      pip.classList.toggle('on', on);
      pip.classList.toggle('menu', on && C.S.alex.pip === 'menu');
      if (on) {
        const ui = pipUi();
        if (ui !== d.lastPip) { pip.querySelector('.pip-ui').innerHTML = ui; d.lastPip = ui; }
        d.pipMap.update(C.mapView('alex'));
        fitPip(d);
      } else d.lastPip = '';
    }
    keepScroll(d, v);
    if (!d.screen.offsetParent) return;
    // The navigation bar's real height, so a pinned button can sit on top of it at any text size.
    const nav = d.ui.querySelector('.a-nav');
    if (nav) d.screen.style.setProperty('--a-nav-h', `${nav.offsetHeight}px`);
    placeSnack(d);
    if (who === 'alex') frameAlex(d);
  }

  // Positions in the screen's own px (the stage may scale the phone).
  const geo = (d) => { const sr = d.screen.getBoundingClientRect(); return { sr, k: sr.width / 390 || 1 }; };
  const topOf = (g, el) => (el.getBoundingClientRect().top - g.sr.top) / g.k;
  const bottomOf = (g, el) => (el.getBoundingClientRect().bottom - g.sr.top) / g.k;
  const shown = (el) => !!(el && el.getClientRects().length);

  // Snackbars sit above the navigation bar, the bottom sheet or a pinned bottom button, never over
  // them, and never over the top bar (Back to call): with large text, when the sheet leaves no room,
  // the snackbar sits just under the measured bar instead.
  function placeSnack(d) {
    const g = geo(d);
    const H = d.screen.clientHeight;
    const lows = [...d.ui.querySelectorAll('.a-nav, .a-bsheet, .a-bottom, .a-content:not(.scroll) > .a-btn.lg')].filter(shown).map((el) => [el, topOf(g, el)]);
    const low = lows.sort((x, y) => x[1] - y[1])[0];
    const floor = low ? low[1] : H - 40;
    const highs = [...d.ui.querySelectorAll('.a-mapbar, .a-top, .a-appbar')].filter(shown).map((el) => bottomOf(g, el));
    const ceiling = Math.max(40, ...highs) + 8;
    const snack = d.top.querySelector('.a-snack');
    const h = snack ? snack.offsetHeight : 48;
    const onMapSheet = !!low && low[0].classList.contains('a-bsheet');
    let lift = H - floor + 12;
    const top = H - lift - h;
    // Above the live sheet the snackbar shares the map band with the people on it; it needs to leave
    // them room (about one marker and its name).
    if (top < ceiling || (onMapSheet && top - ceiling < 120)) {
      // No room between the bar and the sheet (large text): the snackbar lies on the sheet, just under
      // its top edge, so it covers neither the bar nor the people on the map. Elsewhere it sits right
      // under the bar.
      const onSheet = H - floor - 8 - h;
      lift = onMapSheet && onSheet >= 0 ? onSheet : H - ceiling - h;
    }
    d.screen.style.setProperty('--a-snack-b', `${Math.round(Math.max(0, lift))}px`);
  }

  // Alex's live map frames Alex (and Mom, once she shares back) in the band the top bar, the sheet
  // and any snackbar leave open, as Mom's page does: markers and their names never slide under them.
  function frameAlex(d) {
    const S = C.S;
    if (S.alex.screen !== 'live' || !d.screen.classList.contains('with-map')) return;
    const b = C.bandOf(d, '.a-mapbar', '.a-bsheet');
    if (!b) return;
    let bottom = b.bottom;
    const snack = d.top.querySelector('.a-snack');
    if (shown(snack)) {
      const t = topOf(geo(d), snack);
      if (t > b.top + 60) bottom = Math.min(bottom, t - 8);
    }
    const pts = [C.sharedPos()];
    if (S.mom.sharing) pts.push(S.world.mom);
    // Each point needs its disc above it and its name capsule below it (both grow with the text size,
    // so they're measured). frameMap fits points into its band less 130 and centers them 10 below its
    // middle, so hand it the band that puts every disc and name inside the open one.
    const g = geo(d);
    let up = 30;
    let down = 58;
    d.mapHost.querySelectorAll('.mk').forEach((mk) => {
      if (mk.style.display === 'none') return;
      const at = mk.getBoundingClientRect().top;
      const parts = [mk.querySelector('.disc'), mk.querySelector('.name span')].filter(shown).map((el) => el.getBoundingClientRect());
      if (!parts.length) return;
      up = Math.max(up, (at - Math.min(...parts.map((r) => r.top))) / g.k + 4);
      down = Math.max(down, (Math.max(...parts.map((r) => r.bottom)) - at) / g.k + 4);
    });
    const t1 = b.top + up;
    const b1 = bottom - down;
    const inner = Math.max(b1 - t1, 20);
    const span = inner + 130;
    const top = (t1 + b1) / 2 - 10 - span / 2;
    C.frameMap(d, top, top + span, pts);
  }

  // A re-render rebuilds the screen; a scrolling screen (Settings, the picker, the live sheet at large
  // sizes) keeps its place, and the top app bar collapses once content scrolls under it.
  function keepScroll(d, v) {
    const el = d.ui.querySelector('.a-content.scroll, .a-bsheet');
    const scr = d.ui.querySelector('.scr');
    if (!el || !scr) { d.aScroll = null; return; }
    const same = d.aScroll && d.aScroll.key === v.key;
    if (d.aScroll && d.aScroll.el === el) return;
    if (same && d.aScroll.top) el.scrollTop = d.aScroll.top;
    const st = { key: v.key, el, top: el.scrollTop };
    d.aScroll = st;
    const sync = () => {
      st.top = el.scrollTop;
      scr.classList.toggle('a-scrolled', el.scrollTop > 4);
    };
    sync();
    el.addEventListener('scroll', sync, { passive: true });
  }

  function updateLive() {
    const t = new Date(C.now());
    C.bind('aLockH', String(t.getHours() % 12 || 12));
    C.bind('aLockM', String(t.getMinutes()).padStart(2, '0'));
    const d = C.DEV.alex;
    if (d && pipOn()) {
      d.pipMap.update(C.mapView('alex'));
      fitPip(d);
    }
    if (d && C.S.platform === 'android' && d.screen.offsetParent) frameAlex(d);
  }

  // ---------- Actions ----------
  let pipTimer = null;
  let pipStopAt = 0;
  function armPipMenu() {
    clearTimeout(pipTimer);
    // Android hides the picture-in-picture controls after a few seconds.
    if (C.S.alex.pip === 'menu') pipTimer = setTimeout(() => { if (C.S.alex.pip === 'menu') { C.S.alex.pip = 'open'; C.render(); } }, 6000);
  }

  function openSys(kind, from) {
    const a = C.S.alex;
    a.sysPage = { kind, from, ret: a.screen === 'sysperm' ? (a.sysPage && a.sysPage.ret) || 'home' : a.screen };
    a.screen = 'sysperm';
    a.sys = null;
    a.banner = null;
    a.shade = false;
  }

  function grantLocation(kind) {
    const a = C.S.alex;
    a.perm.loc = kind;
    a.perm.precise = a.locChoice === 'precise';
    if (!a.perm.precise) a.settings.precision = 'approximate';
    a.sys = null;
    C.afterLocation();
  }

  // The first share started during a call also asks for Phone, after location, so sharing can stop
  // with the call. Turned down, the share runs on a timer instead.
  const baseOpenShare = A.openShare;
  A.openShare = function openShare() {
    const S = C.S;
    const a = S.alex;
    if (S.platform !== 'android' || C.active() || !granted(a.perm.loc)) { baseOpenShare(); return; }
    if (S.call.active && a.perm.phone === 'unset' && !a.phoneLater) {
      a.banner = null;
      a.afterLoc = 'share';
      a.sys = 'aPhonePre';
      return;
    }
    baseOpenShare();
    if (a.screen === 'share' && blind()) {
      if (S.session.stop === 'call') S.session.stop = 30;
      S.session.shareBack = false;
    }
  };

  // A call can start while the share screen is already open (no Phone question then). The Share tap
  // checks again: during a call, the first share asks for Phone, and without it the share runs on a
  // timer with share back off, since share back must never outlive the call (FSD 8 and 9).
  const baseOpenShareSheet = A.openShareSheet;
  A.openShareSheet = function openShareSheet(el) {
    const S = C.S;
    const a = S.alex;
    const fresh = S.platform === 'android' && !C.active() && a.screen === 'share';
    if (fresh && S.call.active && a.perm.phone === 'unset' && !a.phoneLater) {
      a.banner = null;
      a.afterLoc = 'sheet';
      a.sys = 'aPhonePre';
      return;
    }
    if (fresh && blind()) {
      if (S.session.stop === 'call') S.session.stop = 30;
      S.session.shareBack = false;
    }
    baseOpenShareSheet(el);
  };
  // After the Phone question: back to where it was asked (the share screen, or the Share tap).
  const afterPhone = () => {
    const a = C.S.alex;
    if (a.afterLoc === 'sheet') { a.afterLoc = null; A.openShareSheet(); return; }
    if (a.afterLoc === 'share') C.afterLocation();
  };

  // Sign-up needs a name: 1 to 24 characters after trimming. The field stops typing at 24 (maxlength);
  // an empty name says so under the field and keeps the focus there.
  const baseSendCode = A.sendCode;
  A.sendCode = function sendCode(el) {
    const a = C.S.alex;
    if (C.S.platform === 'android' && !String(a.name || '').trim()) {
      a.nameErr = true;
      C.focusNext('alex', '#name-android');
      return;
    }
    baseSendCode(el);
  };

  Object.assign(A, {
    // Leaving the app for the call opens the picture-in-picture mini map.
    aBackToCall() { const S = C.S; const a = S.alex; if (!S.call.active) return; a.screen = 'call'; a.island = false; a.shade = false; a.modal = null; a.pip = C.active() ? 'open' : null; },
    aShadeToCall() { A.aBackToCall(); },
    aPipTap() { const a = C.S.alex; a.pip = a.pip === 'menu' ? 'open' : 'menu'; armPipMenu(); },
    aPipExpand() { C.S.alex.pip = null; A.backToApp(); },
    // Closing the mini map keeps sharing on; the ongoing notification stays.
    aPipClose() { C.S.alex.pip = 'closed'; },
    // Stop sharing opens the app to confirm.
    aPipStop() { C.S.alex.pip = null; pipStopAt = Date.now(); A.islandStop(); },
    // The notification shade from the status bar, and Quick Settings with the Track Me Live tile.
    aShade() { const a = C.S.alex; a.shade = a.shade ? false : 'shade'; },
    aQsTile() { C.S.alex.shade = false; C.quickStart(); },
    aNotifOpen() { const a = C.S.alex; a.shade = false; a.pip = null; A.backToApp(); },
    aNotifStop() { const a = C.S.alex; a.shade = false; a.pip = null; A.islandStop(); },
    aShadeHangUp() { C.S.alex.shade = false; A.endCall(); },
    // Location
    aLocChoice(el) { C.S.alex.locChoice = el.dataset.v; },
    aLocWhile() { grantLocation('while'); },
    aLocOnce() { grantLocation('once'); },
    aSysLoc() { openSys('location', 'denied'); },
    // The live screen's Location detail (segmented buttons, data-v), or a plain toggle without one.
    // While sharing, the change waits for the next ping (S.session.precisionNext). Precise needs the
    // system's precise location first.
    aTogglePrecision(el) {
      const S = C.S;
      const s = S.session;
      const cur = s.precisionNext || s.precision;
      const want = el && el.dataset && el.dataset.v ? el.dataset.v : cur === 'precise' ? 'approximate' : 'precise';
      if (want === cur) return;
      if (want === 'precise' && !S.alex.perm.precise) { S.alex.sys = 'aLocUpgrade'; return; }
      if (el && el.dataset && el.dataset.v) A.setPrecisionNext(el); else A.togglePrecision();
    },
    // The share screen's Location: segmented buttons, with the system's precise request when needed.
    aSetSessionPrecision(el) {
      const S = C.S;
      if (el.dataset.v === 'precise' && !S.alex.perm.precise && granted(S.alex.perm.loc)) { S.alex.sys = 'aLocUpgrade'; return; }
      S.session.precision = el.dataset.v;
    },
    aSetPrecision(el) {
      const S = C.S;
      if (el.dataset.v === 'precise' && !S.alex.perm.precise && granted(S.alex.perm.loc)) { S.alex.sys = 'aLocUpgrade'; return; }
      S.alex.settings.precision = el.dataset.v;
    },
    aUpgradeYes() {
      const S = C.S;
      S.alex.perm.precise = true;
      S.alex.settings.precision = 'precise';
      if (S.alex.screen === 'share') S.session.precision = 'precise';
      // Mid-session, Precise starts at the next ping like any other change.
      if (S.alex.screen === 'live' && C.active()) S.session.precisionNext = S.session.precision === 'precise' ? null : 'precise';
      S.alex.sys = null;
    },
    aUpgradeNo() { C.S.alex.sys = null; },
    // "Share faster during calls": Android's own dialog adds the tile.
    aTileAsk() { C.S.alex.sys = 'aTileSys'; },
    aTileAdd() {
      const a = C.S.alex;
      a.sys = null;
      a.tipDone = true;
      a.tileAdded = true;
      C.alexBanner('Tile added', 'During a call, swipe down and tap Share location.', { kind: 'app', snack: 'Tile added. During a call, swipe down and tap Share location.' });
    },
    aTileNo() { const a = C.S.alex; a.sys = null; a.tipDone = true; },
    // Phone, asked at the first share during a call (or from Settings)
    aPhoneContinue() { C.S.alex.sys = 'aPhoneSys'; },
    aPhoneLater() { const a = C.S.alex; a.sys = null; if (a.afterLoc === 'share' || a.afterLoc === 'sheet') { a.phoneLater = true; afterPhone(); } },
    aPhoneAllow() { const a = C.S.alex; a.perm.phone = 'allowed'; a.sys = null; afterPhone(); },
    aPhoneDeny() { const a = C.S.alex; a.perm.phone = 'denied'; a.sys = null; afterPhone(); },
    // Settings rows
    aPermLoc() { const a = C.S.alex; if (a.perm.loc === 'unset') { a.afterLoc = null; a.sys = 'locPre'; } else openSys('location', 'settings'); },
    aPermPhone() { const a = C.S.alex; a.afterLoc = null; if (a.perm.phone === 'unset') a.sys = 'aPhonePre'; else openSys('phone', 'settings'); },
    aPermNotif() { const a = C.S.alex; if (a.perm.notif === 'unset') a.sys = 'notifPre'; else openSys('notifications', 'settings'); },
    // The system Settings page
    aSysSet(el) {
      const a = C.S.alex;
      const v = el.dataset.v;
      if (a.sysPage && a.sysPage.kind === 'phone') { a.perm.phone = v === 'allow' ? 'allowed' : 'denied'; return; }
      a.perm.loc = { while: 'while', ask: 'ask', deny: 'denied' }[v];
      if (!granted(a.perm.loc)) return;
      if (!a.perm.precise) a.settings.precision = 'approximate';
    },
    aSysPrecise(el) {
      const a = C.S.alex;
      a.perm.precise = el.checked;
      if (!el.checked) a.settings.precision = 'approximate';
    },
    aSysNotif(el) { C.S.alex.perm.notif = el.checked ? 'allowed' : 'denied'; },
    aSysBack() {
      const a = C.S.alex;
      const pg = a.sysPage || { ret: 'home' };
      a.sysPage = null;
      a.screen = pg.ret || 'home';
      if (pg.from === 'denied') {
        if (granted(a.perm.loc)) C.afterLocation(); else a.afterLoc = null;
      }
    },
    // Mom: Chrome's "This time only"
    aAllowLocOnce() { A.allowLoc(); },
  });

  window.TML.android = { viewAlex, topAlex, viewMom, topMom, chrome, updateLive };
})();
