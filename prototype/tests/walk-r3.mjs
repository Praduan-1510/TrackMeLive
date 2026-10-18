// Round 3: spec, design and asset review fixes, on either platform (iPhone-only checks skip on Android).
// node walk-r3.mjs <out-dir> [light|dark] [ios|android]
import { chromium } from 'playwright-core';
import { finish } from './finish.mjs';
import { readFileSync } from 'node:fs';

const OUT = process.argv[2] || '.';
const theme = process.argv[3] || 'light';
const platform = process.argv[4] || 'ios';
const android = platform === 'android';
const tag = `r3-${platform}-${theme}`;
const URL = process.env.PROTO_URL || new globalThis.URL('../index.html', import.meta.url).href;

const b = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [];
const errors = [];
const check = (name, ok, extra = '') => checks.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== '' ? ` (${extra})` : ''}`);
const A = (s) => `.screen[data-device="alex"] ${s}`;
const Mo = (s) => `.screen[data-device="mom"] ${s}`;
let page;
let n = 0;
const wait = (ms) => page.waitForTimeout(ms);
const click = async (s, after = 450) => { await page.click(s, { timeout: 4000 }); await wait(after); };
const shot = async (name) => { await wait(400); n += 1; await page.locator('.devices').screenshot({ path: `${OUT}/${tag}-${String(n).padStart(2, '0')}-${name}.png` }); };
const count = (s) => page.locator(s).count();
const txt = (s) => page.locator(s).first().innerText();
const S = (f) => page.evaluate(f);

async function fresh(opts = {}) {
  const ctx = await b.newContext({ viewport: { width: opts.width || 1440, height: 900 }, colorScheme: theme });
  await ctx.addInitScript(([p, t]) => { try { localStorage.setItem('tml-proto-platform', p); localStorage.setItem('tml-proto-text', t); localStorage.setItem('tml-proto-theme', 'system'); } catch (e) {} }, [opts.platform || platform, opts.text || 'default']);
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(URL);
  await wait(2200);
  return ctx;
}
async function signup(name) {
  await click(A('[data-act="obSkip"]'));
  if (name !== undefined) {
    const field = A(android ? '#name-android' : '#name-ios');
    await page.fill(field, name);
    await page.locator(field).blur();
    await wait(300);
  }
  await click(A('[data-act="sendCode"]'));
  if (await count(A('[data-act="fillCode"]'))) { await click(A('[data-act="fillCode"]'), 1500); await click(A('[data-act="savePicker"]')); }
}
async function share(opts = {}) {
  if (opts.call !== false) {
    if (!(await S(() => window.TML.core.S.call.active))) await click('#ctl-call', 500);
    await click(A(android ? '.a-card.call [data-act="openShare"]' : '.callcard [data-act="openShare"]'));
  } else await click(A(android ? '.a-cta[data-act="openShare"]' : '.home-cta[data-act="openShare"]'));
  if (await count(A('[data-act="locContinue"]'))) {
    await click(A('[data-act="locContinue"]'));
    if (android) {
      await click(A('[data-act="aLocWhile"]'));
      if (await count(A('[data-act="aPhoneContinue"]'))) { await click(A('[data-act="aPhoneContinue"]')); await click(A('[data-act="aPhoneAllow"]')); }
    } else {
      if (opts.preciseOff) { await click(A('[data-act="locPrecise"]'), 300); }
      await click(A('[data-act="locAllow"]'));
    }
  }
  if (opts.beforeSend) await opts.beforeSend();
  await click(A('[data-act="openShareSheet"]'));
  await click(A(android ? '.ss-person[data-to="Mom"]' : '.contact[data-to="Mom"]'), 1700);
  if (await count(A('[data-act="notifLater"]'))) await click(A('[data-act="notifLater"]'), 300);
  await click(Mo('[data-act="openLink"]'), 1100);
}

// ---------- Static and stage ----------
let ctx = await fresh();
const html = readFileSync(new globalThis.URL('../index.html', import.meta.url), 'utf8');
check('R3-08 index.html doesn’t load Android’s files up front', !/<link[^>]+android\.css|<script[^>]+android\.js/.test(html));
const dusk = await S(() => window.TML.core.COLORS.find((c) => c.id === 'dusk').swatch);
check('R3-D14 the Dusk swatch is the measured render color', dusk === '#7A91C5', dusk);
await ctx.close();
ctx = await fresh({ width: 600 });
check('R3-D12 at 640px and below, the switches are in the story panel', (await page.locator('.narrow-switches [data-platform-set="android"]').isVisible()) && (await page.locator('.narrow-switches [data-theme-set="dark"]').isVisible()));
await ctx.close();

// ---------- Sign-up name, share screen label ----------
ctx = await fresh();
await click(A('[data-act="obSkip"]'));
const nameField = A(android ? '#name-android' : '#name-ios');
check('R3-12 the name field is editable, 24 characters at most', (await count(nameField)) === 1 && (await page.getAttribute(nameField, 'maxlength')) === '24');
await page.fill(nameField, '   ');
await page.locator(nameField).blur();
await click(A('[data-act="sendCode"]'));
check('R3-12 an empty name is refused', (await S(() => window.TML.core.S.alex.signup)) === 'details' && /Enter your name/.test(await page.locator(A('.scr')).innerText()));
await shot('name-empty');
await page.fill(nameField, '  Sam   Lee  ');
await page.locator(nameField).blur();
await wait(300);
check('R3-12 the name is trimmed', (await S(() => window.TML.core.S.alex.name)) === 'Sam Lee');
await click(A('[data-act="sendCode"]'));
await click(A('[data-act="fillCode"]'), 1500);
await click(A('[data-act="savePicker"]'));
if (!android) check('R3-12 Home greets by name', /Hi, Sam Lee/.test(await txt(A('h1'))));
await click('#ctl-call', 500);
await click(A(android ? '.a-card.call [data-act="openShare"]' : '.callcard [data-act="openShare"]'));
await click(A('[data-act="locContinue"]'));
if (android) { await click(A('[data-act="aLocWhile"]')); await click(A('[data-act="aPhoneContinue"]')); await click(A('[data-act="aPhoneAllow"]')); } else await click(A('[data-act="locAllow"]'));
const lbl = await page.locator(`label[for="${android ? 'viewer-android' : 'viewer-ios'}"]`).innerText();
check('R3-15 “Who it’s for (optional)” on both platforms', lbl.trim() === 'Who it’s for (optional)', lbl);
await click(A('[data-act="openShareSheet"]'));
await click(A(android ? '.ss-person[data-to="Mom"]' : '.contact[data-to="Mom"]'), 1700);
if (await count(A('[data-act="notifLater"]'))) await click(A('[data-act="notifLater"]'), 300);
await click(Mo('[data-act="openLink"]'), 1100);
check('R3-12 Mom’s page uses the name', /Sam Lee is sharing their location with you/.test(await txt(Mo('h1'))));
await ctx.close();

// ---------- A live session: snapshot, arrow, precision, tiles, warning ----------
ctx = await fresh();
await signup();
await share();
if (!android) check('R3-03 the location arrow shows in the iPhone status bar while sharing', await page.locator(A('.statusbar .sb-loc')).isVisible());
const look0 = await S(() => ({ ...window.TML.core.S.session.look }));
// R3-02: change the mascot mid-session; Mom's marker keeps the snapshot.
await click(A(android ? '[data-act="goHome"]' : '[data-act="goHome"]'));
await click(A('[data-act="tab"][data-tab="mascot"]'));
await click(A('[data-act="pickMascot"][data-id="ghost"]'));
await click(A('[data-act="savePicker"]'));
const momSrc = await page.locator(Mo('.map-layer .mk.sharer .disc img')).first().getAttribute('src');
check('R3-02 Mom’s marker keeps the mascot the session started with', look0.mascot === 'fox' && /\/fox\.png$/.test(momSrc), momSrc);
const alexSrc = await page.locator(A('.map-layer .mk.sharer .disc img')).first().getAttribute('src');
check('R3-02 Alex’s own map keeps it too, so both maps match', /\/fox\.png$/.test(alexSrc), alexSrc);
if (!android) check('R3-03 the arrow stays on every screen while sharing', await page.locator(A('.statusbar .sb-loc')).isVisible());
await click(A(android ? '.a-card.live' : '.callcard.live'));
// R3-D03: share back possible during the session's own call
check('R3-D03 the distance tile waits for Mom while share back is possible', (await txt(A('.tiles .tile:first-child b'))) === 'Waiting');
// R3-13: precision mid-session
const toApprox = android ? A('[data-act="aTogglePrecision"][data-v="approximate"]') : A('.loc-row [data-act="togglePrecision"]');
await click(toApprox, 200);
const pending = await S(() => [window.TML.core.S.session.precision, window.TML.core.S.session.precisionNext]);
check('R3-13 the change waits for the next update', pending[0] === 'precise' && pending[1] === 'approximate', pending.join(' -> '));
if (!android) check('R3-13 the control says so', /From the next update/.test(await txt(A('.loc-row'))));
await wait(3800);
const after = await S(() => window.TML.core.S.session.precision);
check('R3-13 it takes effect at the next ping: Mom’s circle appears', after === 'approximate' && (await page.locator(Mo('.map-layer .mk.sharer.approx .area')).isVisible()), after);
await shot('approximate-mid-session');
await click(android ? A('[data-act="aTogglePrecision"][data-v="precise"]') : A('.loc-row [data-act="togglePrecision"]'), 200);
await wait(3800);
check('R3-13 and back to Precise', (await S(() => window.TML.core.S.session.precision)) === 'precise' && (await count(Mo('.map-layer .mk.sharer.approx'))) === 0);
// R3-D07: Alex's own markers sit in the open band
const band = await page.evaluate(() => {
  const s = document.querySelector('.screen[data-device="alex"]');
  const bar = s.querySelector('.glassbar, .a-mapbar');
  const sheet = s.querySelector('.sheet, .a-bsheet');
  const disc = s.querySelector('.map-layer .mk.sharer .disc').getBoundingClientRect();
  const cy = disc.top + disc.height / 2;
  return { inside: cy > bar.getBoundingClientRect().bottom && cy < sheet.getBoundingClientRect().top, cy: Math.round(cy) };
});
check('R3-D07 Alex’s marker sits between the bar and the sheet', band.inside, JSON.stringify(band));
// R3-10: the 1-hour warning, passed through by the jump
await click('#ctl-limit', 1200);
const warnLine = await txt(A('.scr'));
check('R3-10 the warning line shows before the limit', /Sharing stops at \d+:\d\d (am|pm) · 1-hour limit/.test(warnLine));
if (!android) {
  await click(A('.statusbar [data-act="backToCall"]'), 500);
  check('R3-10 the Live Activity carries the warning', /1-hour limit/.test(await txt(A('[data-bind="islandSub"], .island'))) || /1-hour limit/.test(await S(() => window.TML.core.islandSub())));
  await click(A('[data-act="toggleIsland"]'));
  await shot('island-warning');
  await click(A('[data-act="backToApp"]'));
}
await shot('limit-warning');
await wait(6500);
check('R3-04 Mom hears “Sharing ended” after the limit (not “stopped”)', (await page.evaluate(() => document.querySelector('.screen[data-device="mom"] .sr-alert').textContent)) === 'Sharing ended.');
await ctx.close();

// ---------- Share back impossible: the tile says not shared ----------
ctx = await fresh();
await signup();
await share({ call: false });
check('R3-D03 a manual share: “—” / not shared', (await txt(A('.tiles .tile:first-child b'))) === '—' && /not shared/.test(await txt(A('.tiles .tile:first-child'))));
await ctx.close();

if (!android) {
  // ---------- iPhone-only details ----------
  ctx = await fresh();
  await signup();
  // R3-D01: the scroll edge covers the status bar
  await click(A('[data-act="tab"][data-tab="settings"]'));
  await page.locator(A('.scr')).evaluate((e) => { e.scrollTop = 400; e.dispatchEvent(new Event('scroll')); });
  await wait(400);
  const edge = await page.evaluate(() => { const s = document.querySelector('.screen[data-device="alex"]'); const k = s.getBoundingClientRect().width / 390; const r = s.querySelector('.ios-edge').getBoundingClientRect(); return { top: Math.round((r.top - s.getBoundingClientRect().top) / k), h: Math.round(r.height / k) }; });
  check('R3-D01 the scroll edge sits at the top of the screen', Math.abs(edge.top) <= 1, JSON.stringify(edge));
  check('R3-11 Settings notes that Live Activities are optional', /If Live Activities are off, sharing still works/.test(await txt(A('.scr'))));
  await shot('settings-scrolled');
  // R3-D06: Save above the tab bar at rest
  await click(A('[data-act="tab"][data-tab="mascot"]'));
  const save = await page.evaluate(() => { const s = document.querySelector('.screen[data-device="alex"]'); const sv = s.querySelector('[data-act="savePicker"]').getBoundingClientRect(); const tb = s.querySelector('.tabbar').getBoundingClientRect(); return { above: sv.bottom <= tb.top + 1, onScreen: sv.top >= s.getBoundingClientRect().top }; });
  check('R3-D06 Save sits above the tab bar at rest', save.above && save.onScreen, JSON.stringify(save));
  await shot('mascot-tab');
  // R3-D04 / R3-D05 / R3-09: Control Center during a call
  await click(A('[data-act="tab"][data-tab="settings"]'));
  await click('#ctl-call', 500);
  check('R3-D04 the in-app offer shows on Settings during a call', (await count(A('.offer'))) === 1);
  await click('#ctl-quick', 600);
  check('R3-D05 no banner over Control Center', (await count(A('.offer, .toast, .banner'))) === 0);
  const cc = await page.locator(A('.cc-tml b')).evaluate((e) => ({ ellipsis: getComputedStyle(e).textOverflow === 'ellipsis', fits: e.scrollWidth <= e.clientWidth + 1, text: e.textContent }));
  check('R3-09 the Control Center label never shows an ellipsis', !cc.ellipsis && cc.fits && cc.text === 'Share location', JSON.stringify(cc));
  await shot('control-center');
  await click(A('[data-act="ccClose"]'));
  await click('#ctl-call', 500);
  await ctx.close();
  // R3-05: the prompt's Precise switch
  ctx = await fresh();
  await signup();
  await click('#ctl-call', 500);
  await click(A('.callcard [data-act="openShare"]'));
  await click(A('[data-act="locContinue"]'));
  await click(A('[data-act="locPrecise"]'), 300);
  check('R3-05 Precise: Off on the prompt', (await txt(A('.sysmap .prec'))).trim() === 'Precise: Off' && (await page.getAttribute(A('.sysmap .prec'), 'aria-checked')) === 'false');
  await shot('prompt-precise-off');
  await click(A('[data-act="locAllow"]'));
  check('R3-05 the share starts approximate', (await S(() => window.TML.core.S.session.precision)) === 'approximate' && /Approximate/.test(await txt(A('[data-act="openMenu"]'))));
  await click(A('[data-act="goHome"]'));
  await click(A('[data-act="tab"][data-tab="settings"]'));
  check('R3-05 Settings shows Precise: Off', /Precise: Off/.test(await txt(A('[data-act="permLoc"]'))));
  await ctx.close();
  // R3-D15: the lock screen clock is the system font; R3-D09: no marker while loading
  ctx = await fresh();
  const font = await page.locator(Mo('.lockscreen .time')).evaluate((e) => getComputedStyle(e).fontFamily);
  check('R3-D15 the lock screen clock uses the system font', !/Gabarito/.test(font), font);
  await signup();
  await click('#ctl-call', 500);
  await click(A('.callcard [data-act="openShare"]'));
  await click(A('[data-act="locContinue"]'));
  await click(A('[data-act="locAllow"]'));
  await click(A('[data-act="openShareSheet"]'));
  await click(A('.contact[data-to="Mom"]'), 1700);
  await click(A('[data-act="notifLater"]'), 300);
  await page.click(Mo('[data-act="openLink"]'));
  await wait(150);
  check('R3-D09 no Alex marker while Mom’s page loads', !(await page.locator(Mo('.map-layer .mk.sharer .disc')).isVisible()));
  await wait(900);
  check('R3-D09 the marker appears once loaded', await page.locator(Mo('.map-layer .mk.sharer .disc')).isVisible());
  // R3-D08: at 200% the in-app message sits under the bar, never over it
  await ctx.close();
  ctx = await fresh({ text: 'xl' });
  await signup();
  await share();
  await click(A('[data-act="askShare"]'), 300);
  const toast = await page.evaluate(() => { const s = document.querySelector('.screen[data-device="alex"]'); const t = s.querySelector('.toast'); const bar = s.querySelector('.glassbar'); return t ? { below: t.getBoundingClientRect().top >= bar.getBoundingClientRect().bottom - 1 } : { below: true, none: true }; });
  check('R3-D08 at 200% the message sits under the bar', toast.below, JSON.stringify(toast));
  await shot('xl-toast');
  await ctx.close();
} else {
  // R3-08: Android loads on demand from an iPhone first view
  ctx = await fresh({ platform: 'ios' });
  await page.click('[data-platform-set="android"]');
  await wait(1200);
  check('R3-08 switching to Android loads its views', (await S(() => !!window.TML.android)) && (await page.getAttribute('body', 'data-platform')) === 'android' && (await count(A('.a-statusbar .sb'))) === 1);
  await ctx.close();
}

// ---------- Functional QA fixes ----------
ctx = await fresh();
await signup();
// F-05: the first tap after typing a name lands; F-12: the initial comes from the raw name
await click('#ctl-call', 500);
await click(A(android ? '.a-card.call [data-act="openShare"]' : '.callcard [data-act="openShare"]'));
await click(A('[data-act="locContinue"]'));
if (android) { await click(A('[data-act="aLocWhile"]')); await click(A('[data-act="aPhoneContinue"]')); await click(A('[data-act="aPhoneAllow"]')); } else await click(A('[data-act="locAllow"]'));
const vf = A(android ? '#viewer-android' : '#viewer-ios');
await page.fill(vf, '&Ana');
await page.click(A('[data-act="openShareSheet"]'));
await wait(500);
check('F-05 the first tap after typing a name opens the share sheet', (await S(() => window.TML.core.S.alex.modal)) === 'sharesheet');
await click(A(android ? '.ss-person[data-to="Mom"]' : '.contact[data-to="Mom"]'), 1700);
if (await count(A('[data-act="notifLater"]'))) await click(A('[data-act="notifLater"]'), 300);
check('F-12 a name starting with a symbol gets the person icon, never an entity piece', (await count(A('.people .person:nth-child(2) .av .person-ic'))) === 1 && !/&/.test(await txt(A('.people .person:nth-child(2) .av'))));
check('F-08 the live bar says “On a call”, with no name', /On a call\b/.test(await txt(A('.glassbar, .a-mapbar'))) && !/On a call with/.test(await txt(A('.glassbar, .a-mapbar'))));
if (!android) {
  // F-07: before the link is opened, the Live Activity doesn't claim anyone is watching
  await click(A('.statusbar [data-act="backToCall"]'), 500);
  await click(A('[data-act="toggleIsland"]'));
  check('F-07 the Live Activity says the link isn’t opened yet', /not opened yet/.test(await txt(A('.island.open'))) && !/watching/.test(await txt(A('.island.open'))));
  await click(A('[data-act="backToApp"]'));
}
// F-10: losing GPS before the link is opened stays truthful
await click('#ctl-signal', 700);
check('F-10 before the link is opened, the copy says they will see the last spot', /when they open the link/.test(await txt(A('.sheet .sub, .a-bsheet .sub'))));
await click('#ctl-signal', 500);
// F-03: a timer ending while Alex is on the call screen keeps the call screen
await click(A('[data-act="openTimer"]'));
await click(A('[data-act="setStop"][data-v="15"]'));
await page.evaluate(() => { const s = window.TML.core.S.session; s.stopAt = window.TML.core.now() + 2500; });
await click(android ? A('.a-btn.call[data-act="aBackToCall"]') : A('.statusbar [data-act="backToCall"]'), 400);
await wait(3500);
check('F-03 when sharing ends during the call, Alex stays on the call screen', (await S(() => [window.TML.core.S.alex.screen, window.TML.core.S.session.status].join(' '))) === 'call stopped');
await ctx.close();
// F-11: Back while the code is being checked
ctx = await fresh();
await click(A('[data-act="obSkip"]'));
await click(A('[data-act="sendCode"]'));
await page.click(A('[data-act="fillCode"]'));
await wait(200);
await click(A(android ? '[data-act="signupBack"]' : '[data-act="signupBack"]'), 1200);
check('F-11 Back during the code check stays on sign-up', (await S(() => window.TML.core.S.alex.screen)) === 'signup');
await ctx.close();
// F-14 delete; F-16 steps stay done; F-17 the guard on Stop sharing my location; F-13 notifications off
ctx = await fresh();
await signup();
await share();
await click(Mo('[data-act="askPermission"]'));
await page.click(Mo('[data-act="allowLoc"]'));
await wait(120);
if (await count(Mo('[data-act="stopMine"]'))) await page.click(Mo('[data-act="stopMine"]'));
await wait(400);
check('F-17 a double tap on Allow doesn’t stop sharing back', await S(() => window.TML.core.S.mom.sharing));
const doneBefore = await page.locator('#steps li.done').count();
await click(A('[data-act="askStop"]'));
await click(A('[data-act="confirmStop"]'), 600);
await click(A('[data-act="done"]'));
await share();
check('F-16 steps already done stay done on a later share', (await page.locator('#steps li.done').count()) >= doneBefore, `${doneBefore} -> ${await page.locator('#steps li.done').count()}`);
await click(A(android ? '[data-act="goHome"]' : '[data-act="goHome"]'));
await click(A('[data-act="tab"][data-tab="settings"]'));
await click(A('[data-act="askDelete"]'));
await click(A('[data-act="deleteAccount"]'), 700);
const del = await S(() => ({ screen: window.TML.core.S.alex.screen, status: window.TML.core.S.session.status, mom: window.TML.core.S.mom.screen, onboarded: window.TML.core.S.alex.onboarded }));
check('F-14 Delete stops sharing, clears the profile and starts over', del.screen === 'onboarding' && del.status === 'stopped' && del.mom === 'ended' && !del.onboarded, JSON.stringify(del));
check('F-14 Mom’s open page shows Alex stopped sharing', /stopped sharing at/.test(await txt(Mo('h1'))));
await ctx.close();
if (!android) {
  ctx = await fresh();
  await signup();
  await share();
  await click(A('[data-act="goHome"]'));
  await page.evaluate(() => { window.TML.core.S.alex.perm.notif = 'denied'; });
  await click(A('[data-act="tab"][data-tab="settings"]'));
  await click(A('[data-act="permNotif"]'));
  check('F-13 Notifications off explains how to turn them on', /Notifications are off/.test(await txt(A('.alert'))));
  await click(A('[data-act="notifSettings"]'));
  check('F-13 and Open Settings turns them on', (await S(() => window.TML.core.S.alex.perm.notif)) === 'allowed');
  await ctx.close();
}

await b.close();
console.log(checks.join('\n'));
console.log(errors.length ? errors.join('\n') : 'no errors');

await finish(checks, errors);
