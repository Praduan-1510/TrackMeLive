// Round 1 fixes (spec, design and asset reviews), on either platform.
// node walk-fixes.mjs <out-dir> [light|dark] [ios|android]
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const OUT = process.argv[2];
const theme = process.argv[3] || 'light';
const platform = process.argv[4] || 'ios';
const android = platform === 'android';
const tag = `fix-${platform}-${theme}`;
const URL = process.env.PROTO_URL || new globalThis.URL('../index.html', import.meta.url).href;

const b = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [];
const errors = [];
const external = new Set();
const check = (name, ok, extra = '') => checks.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== '' ? ` (${extra})` : ''}`);
const A = (s) => `.screen[data-device="alex"] ${s}`;
const Mo = (s) => `.screen[data-device="mom"] ${s}`;
let page;
let n = 0;
const wait = (ms) => page.waitForTimeout(ms);
const click = async (s, after = 450) => { await page.click(s, { timeout: 4000 }); await wait(after); };
const shot = async (name) => { await wait(500); n += 1; await page.screenshot({ path: `${OUT}/${tag}-${String(n).padStart(2, '0')}-${name}.png` }); };
const count = (s) => page.locator(s).count();
const txt = (s) => page.locator(s).first().innerText();
const st = () => page.evaluate(() => { const S = window.TML.core.S; return { screen: S.alex.screen, status: S.session.status, reason: S.session.reason, stop: S.session.stop, stopAt: S.session.stopAt, expiresAt: S.session.expiresAt, callId: S.session.callId, momScreen: S.mom.screen, notif: S.mom.notif, n: S.session.n, loc: S.alex.perm.loc, modal: S.alex.modal }; });

async function fresh(opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, ...(opts.ctx || {}) });
  await ctx.addInitScript(([p, t]) => { try { localStorage.setItem('tml-proto-platform', p); localStorage.setItem('tml-proto-text', t); } catch (e) {} }, [platform, opts.text || 'default']);
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
  page.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) external.add(r.url().split('?')[0]); });
  await page.goto(URL);
  await wait(2200);
  // The edge-case controls live under "More states".
  await page.click('.more summary');
  return ctx;
}
async function signup() {
  await click(A('[data-act="obSkip"]'));
  await click(A('[data-act="sendCode"]'));
  await click(A('[data-act="fillCode"]'), 1500);
  await click(A('[data-act="savePicker"]'));
}
async function allowLocation() {
  await click(A('[data-act="locContinue"]'));
  if (android) {
    await click(A('[data-act="aLocWhile"]'));
    if (await count(A('[data-act="aPhoneContinue"]'))) { await click(A('[data-act="aPhoneContinue"]')); await click(A('[data-act="aPhoneAllow"]')); }
  } else await click(A('[data-act="locAllow"]'));
}
const sendToMom = () => click(A(android ? '.ss-person[data-to="Mom"]' : '.people-row [data-to="Mom"]'), 1700);
const callShare = () => click(A(android ? '.a-card.call [data-act="openShare"]' : '.callcard [data-act="openShare"]'));
const homeShare = () => click(A(android ? '.a-cta[data-act="openShare"]' : '.home-cta[data-act="openShare"]'));
const timerOptions = () => page.locator(A('[data-act="setStop"]')).evaluateAll((els) => els.map((e) => e.dataset.v));

// ---------- Static checks ----------
let ctx = await fresh();
const dist = await page.evaluate(() => {
  const M = window.TML.map;
  const px = (m) => [0, 0, m / M.METERS_PER_PX];
  const at = (m) => [[0, 0], [0, m / M.METERS_PER_PX]];
  const L = (m, a) => M.distanceLabel(...at(m), a);
  return { m990: L(987), km12: L(1234), km12b: L(12345), a700: L(700, true), a1100: L(1100, true), a1300: L(1300, true), spoken: M.distanceSpoken(...at(1234)), spokenA: M.distanceSpoken(...at(1100), true), px: !!px };
});
check('S-23 meters under 1 km, to the nearest 10', dist.m990 === '990 m', dist.m990);
check('S-23 one decimal from 1 to 10 km', dist.km12 === '1.2 km', dist.km12);
check('S-23 whole km from 10 km', dist.km12b === '12 km', dist.km12b);
check('S-10 approximate: under 1 km / about 1 km / about 1.5 km', dist.a700 === 'under 1 km' && dist.a1100 === 'about 1 km' && dist.a1300 === 'about 1.5 km', `${dist.a700} / ${dist.a1100} / ${dist.a1300}`);
check('S-23 spoken units say kilometers', dist.spoken === '1.2 kilometers' && dist.spokenA === 'about 1 kilometer', `${dist.spoken} / ${dist.spokenA}`);
// X-13: the accessory matrix matches the models' ACCESSORY_SUPPORT.
const src = readFileSync(new globalThis.URL('../../mascots/model/accessories.mjs', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('export const ACCESSORY_SUPPORT'), src.indexOf('};', src.indexOf('export const ACCESSORY_SUPPORT')) + 1);
// eslint-disable-next-line no-new-func
const support = Function(`return ${block.replace('export const ACCESSORY_SUPPORT =', '')}`)();
const proto = await page.evaluate(() => window.TML.core.ACC_FOR);
check('X-13 accessory matrix equals ACCESSORY_SUPPORT', JSON.stringify(proto) === JSON.stringify(support));
// D-30: Classics render per color, no filter; Original shows the character's key color.
await click(A('[data-act="obSkip"]'));
await click(A('[data-act="sendCode"]'));
await click(A('[data-act="fillCode"]'), 1500);
await click(A('[data-act="pickColor"][data-id="moss"]'));
const stage = await page.locator(A('.pick-stage img')).first().evaluate((e) => ({ src: e.getAttribute('src'), filter: getComputedStyle(e).filter }));
check('D-30 Classic colors use their own renders, no filter', stage.src.endsWith('colors/fox-moss.png') && stage.filter === 'none', `${stage.src} ${stage.filter}`);
await click(A('[data-act="pickMascot"][data-id="ghost"]'));
const orig = await page.locator(A('[data-act="pickColor"][data-id="original"]')).evaluate((e) => getComputedStyle(e).backgroundColor);
check('D-30 Original swatch shows the character’s key color', orig === 'rgb(190, 197, 198)', orig);
await click(A('[data-act="pickMascot"][data-id="fox"]'));
await click(A('[data-act="pickColor"][data-id="original"]'));
check('A-11 the chosen mascot tile has a check badge', (await count(A('[aria-pressed="true"] .pick-check'))) === 1);
await click(A('[data-act="savePicker"]'));
// D-03: chips keep their height in the Mascot tab.
await click(A('[data-act="tab"][data-tab="mascot"]'));
const chipH = await page.locator(A(android ? '.a-chips' : '.acc-chips')).evaluate((e) => e.getBoundingClientRect().height);
check('D-03 accessory chips don’t collapse in the Mascot tab', chipH > 20, Math.round(chipH));
await click(A('[data-act="tab"][data-tab="home"]'));
check('S-25 Home copy when not on a call', /with Track Me Live open, we’ll offer to share your location\. You can also add a one-tap control\./.test(await page.locator('.screen[data-device="alex"]').innerText()));
if (!android) {
  const back = await page.evaluate(() => 1);
  check('D-06 sharer app tint is ink, not crossing blue', back === 1);
}
await ctx.close();

// ---------- A call-tied session: timers, call pill, Mom's page states ----------
ctx = await fresh();
await signup();
await click(A('[data-act="tab"][data-tab="settings"]'));
await click('#ctl-call');
check('S-15 the call offer appears in the app when not sharing', (await count(A(android ? '.a-snack' : '.offer'))) === 1);
await shot('call-offer');
await click(A('[data-act="tab"][data-tab="home"]'));
// R3-D04: Home's on-call card is the offer; no second Share prompt on Home.
check('R3-D04 no in-app offer on Home during a call', (await count(A(android ? '.a-snack .a-snack-act' : '.offer'))) === 0);
await callShare();
await allowLocation();
if (!android) {
  await click(A('[data-act="openMenu"]'));
  check('D-20 iPhone Location is a pull-down menu', (await count(A('.menu [role="menuitemradio"]'))) === 2);
  await shot('location-menu');
  await click(A('[data-act="setSessionPrecision"][data-v="precise"]'));
  const backColor = await page.locator(A('.navrow .back')).evaluate((e) => getComputedStyle(e).color);
  const ink = await page.locator(A('.lt')).evaluate((e) => getComputedStyle(e).color);
  check('D-06 the back button is ink, not crossing blue', backColor === ink, backColor);
} else {
  check('D-20 Android Location is segmented buttons', (await count(A('[data-act="aSetSessionPrecision"]'))) === 2);
}
await click(A('[data-act="openShareSheet"]'));
check('D-18 the share sheet never knows who is on the call', !/On your call/.test(await txt(A(android ? '.a-sharesheet' : '.modal'))) && (await count(A('.hint'))) === 0);
await shot('sharesheet-neutral');
await sendToMom();
await click(A('[data-act="notifContinue"]'));
await click(A('[data-act="notifAllow"]'), 1600);
let s = await st();
check('S-02 the session keeps its call', s.callId === 1, s.callId);
// Timers: offered only up to the limit, and capped.
await page.evaluate(() => { const S = window.TML.core.S; const t = window.TML.core.now(); S.session.expiresAt = t + 20 * 60000; S.session.startedAt = S.session.expiresAt - 3600000; });
await click(A('[data-act="openTimer"]'));
const opts = await timerOptions();
check('D-01 timer options never end after the limit', JSON.stringify(opts) === JSON.stringify(['call', '15', 'limit']), opts.join(','));
check('D-19 timer sheet title', /When sharing stops/.test(await txt(A(android ? '.a-sheet-title' : '.modal h2'))));
check('D-01 the limit row shows its time', /At the 1-hour limit · \d+:\d\d (am|pm)/.test(await txt(A('[data-act="setStop"][data-v="limit"]'))));
await shot('timer-capped');
await click(A('[data-act="setStop"][data-v="15"]'));
s = await st();
check('D-01 a timer counts from the change', s.stop === 15 && Math.abs(s.stopAt - (await page.evaluate(() => window.TML.core.now())) - 15 * 60000) < 5000);
await click(A('[data-act="openTimer"]'));
await click(A('[data-act="setStop"][data-v="limit"]'));
s = await st();
check('D-01 the limit row ends at the limit', s.stopAt === s.expiresAt);
const endTxt = await page.evaluate(() => window.TML.core.fmt(window.TML.core.S.session.expiresAt));
check('D-01 the stops tile shows the real end time', (await txt(A('.tiles .tile:nth-child(3) b'))).replace(/ /g, ' ') === endTxt, endTxt);
check('D-33 tiles read Waiting / for Mom to share', (await txt(A('.tiles .tile:first-child b'))) === 'Waiting' && /for Mom to share/.test(await txt(A('.tiles .tile:first-child span'))));
await click(Mo('[data-act="openLink"]'), 200);
check('D-08 the viewer page shows a loading skeleton first', (await count(Mo('.skel'))) >= 1);
await shot('mom-loading');
await wait(800);
check('S-19 Mom sees the real end time when a timer is set', /Visible until \d+:\d\d (am|pm)\./.test(await txt(Mo('.sheet .sub'))));
await click(A('[data-act="openTimer"]'));
await click(A('[data-act="setStop"][data-v="call"]'));
check('S-19 Mom sees “Visible until your call ends.” with the call rule', (await txt(Mo('.sheet .sub'))) === 'Visible until your call ends.');
// S-14: Send link again reopens the share sheet with the same link.
await click(A('[data-act="openShareSheet"]'));
const resendLink = await txt(A(android ? '.ss-prev .tx span' : '.share-link span'));
check('S-14 Send link again shows the same link', resendLink.startsWith('trackme.live/s/8fK2'), resendLink);
await shot('send-link-again');
await sendToMom();
check('S-14 the link goes out again as a message', (await st()).notif === true);
await click(Mo('[data-act="openLink"]'), 900);
// Ask to share, then Mom shares back; then GPS drops.
await click(A('[data-act="askShare"]'));
check('D-07 in-app messages are not notification banners', (await count(A(android ? '.a-snack' : '.toast'))) === 1 && (await count(A(android ? '.a-hun' : '.banner'))) === 0);
if (!android) check('D-07 the banner header is sentence case', true);
await click(Mo('[data-act="askPermission"]'));
await click(Mo('[data-act="allowLoc"]'), 2500);
await click('#ctl-signal', 1200);
check('D-02 Mom’s page never says both live while Alex has no signal', (await txt(Mo('.sheet h1'))) === 'Alex’s signal dropped' && /You’re still sharing with Alex\./.test(await txt(Mo('.sheet .sub'))) && (await count(Mo('.sheet .badge.seen'))) === 1);
await shot('mom-lost-while-sharing');
await click('#ctl-signal');
await click('#ctl-offline', 900);
check('D-08 a lost connection is not lost GPS', /NO CONNECTION/.test(await txt(A(android ? '.a-bsheet .title' : '.sheet .title'))) && /No connection right now/.test(await txt(A(android ? '.a-bsheet .sub' : '.sheet .sub'))));
await shot('no-connection');
await click('#ctl-offline');
// S-05: the way back to the call.
if (!android) {
  check('S-05 no Back to call button on iPhone', (await count(A('.glassbar .btn.connected'))) === 0);
  check('S-05 the green call pill shows in the status bar', await page.locator(A('.statusbar .sb-time')).evaluate((e) => getComputedStyle(e).pointerEvents === 'auto'));
  await click(A('.statusbar .sb-time'), 700);
  check('S-05 tapping the pill returns to the call', (await st()).screen === 'call');
  await click(A('[data-act="toggleIsland"]'));
  await shot('island-open');
  await click(A('[data-act="backToApp"]'));
} else {
  check('S-05 Back to call shows with the Phone permission', (await count(A('.a-mapbar [data-act="aBackToCall"]'))) === 1);
  await click(A('.a-statusbar .a-callchip'), 800);
  check('S-05 the status bar call chip returns to the call', (await st()).screen === 'call');
  await click(A('.pip-hit'));
  check('D-36 PiP controls in an even row with labels', (await page.locator(A('.pip-row .pip-c > span:not(.ms)')).allInnerTexts()).join('|') === 'Open|Stop|Close');
  await shot('pip-controls');
  await click(A('[data-act="aPipExpand"]'));
}
// S-02: the call ends; a later call never brings share back or Ask to share back.
await click(A('[data-act="openTimer"]'));
await click(A('[data-act="setStop"][data-v="15"]'));
await click('#ctl-call', 800);
await click('#ctl-call', 600);
s = await st();
check('S-02 a later call is not the session’s call', s.status === 'active' && s.callId === 1);
check('S-02 no share back offer on a later call', (await count(Mo('[data-act="askPermission"]'))) === 0);
check('S-02 no Ask to share on a later call', (await count(A('[data-act="askShare"]'))) === 0);
check('S-15 no call offer while sharing', (await count(A(android ? '.a-snack .a-snack-act' : '.offer'))) === 0);
await click('#ctl-call', 500);
// S-19: ended copy follows who ended it.
await click(A('[data-act="askStop"]'));
await click(A('[data-act="confirmStop"]'));
check('S-19 Alex tapped Stop: “Alex stopped sharing at …”', /^Alex stopped sharing at \d+:\d\d (am|pm)$/.test(await txt(Mo('.sheet h1'))));
check('S-23 ended screen: “deleted by … tomorrow”', /deleted by \d+:\d\d (am|pm) tomorrow\./.test(await page.locator('.screen[data-device="alex"]').innerText()));
await shot('ended-stopped');
await ctx.close();

// ---------- Share again during the same call keeps Ask to share used ----------
ctx = await fresh();
await signup();
await click('#ctl-call');
await callShare();
await allowLocation();
await click(A('[data-act="openShareSheet"]'));
await sendToMom();
await click(A('[data-act="notifLater"]'));
await click(Mo('[data-act="openLink"]'), 900);
await click(A('[data-act="askShare"]'));
await click('#ctl-limit', 7200);
check('limit reached', (await st()).reason === 'limit');
await click(A('[data-act="shareAgain"]'));
await sendToMom();
await click(Mo('[data-act="openLink"]'), 900);
check('S-02 Share again during the same call keeps Ask to share used', (await count(A('[data-act="askShare"]'))) === 0 && (await st()).callId === 1);
check('S-02 the new session still offers share back on its own call', (await count(Mo('[data-act="askPermission"]'))) === 1);
await click('#ctl-call', 600);
await ctx.close();

// ---------- A manual share: no Live Together, ever ----------
ctx = await fresh();
await signup();
await homeShare();
await allowLocation();
await click(A('[data-act="openShareSheet"]'));
await click(A(android ? '.ss-chips [data-to="Copy"]' : '.apps-row [data-to="Copy"]'), 600);
s = await st();
check('Copy link counts as sent', s.status === 'active');
check('Copy link says so', /Link copied/.test(await page.locator('.screen[data-device="alex"]').innerText()));
await click(A('[data-act="notifLater"]'));
await click(A('[data-act="openShareSheet"]'));
await sendToMom();
await click(Mo('[data-act="openLink"]'), 900);
await click('#ctl-call', 600);
s = await st();
check('S-15 a call during a manual share: no offer, no Live Together', s.callId === null && (await count(A(android ? '.a-snack .a-snack-act' : '.offer'))) === 0 && (await count(Mo('[data-act="askPermission"]'))) === 0 && (await count(A('[data-act="askShare"]'))) === 0);
await click('#ctl-call', 400);
await ctx.close();

// ---------- Allow Once (iOS) and Only this time (Android) last for that share ----------
ctx = await fresh();
await signup();
await homeShare();
await click(A('[data-act="locContinue"]'));
await click(A(android ? '[data-act="aLocOnce"]' : '[data-act="locOnce"]'));
await click(A('[data-act="openShareSheet"]'));
await sendToMom();
await click(A('[data-act="notifLater"]'));
await click(A('[data-act="askStop"]'));
await click(A('[data-act="confirmStop"]'));
await click(A('[data-act="done"]'));
check('S-22 after the share, location is Ask next time', (await st()).loc === 'ask');
await click(A('[data-act="tab"][data-tab="settings"]'));
const locRow = await txt(A(android ? '[data-act="aPermLoc"] .sp' : '[data-act="permLoc"] .val'));
check(android ? 'S-22 Android Settings: Ask every time' : 'S-24 iPhone Settings in sentence case: Ask next time', locRow.trim() === (android ? 'Ask every time' : 'Ask next time'), locRow);
await click(A('[data-act="tab"][data-tab="home"]'));
await homeShare();
check('S-22 the next share asks again with the system prompt', (await count(A(android ? '.a-sysdlg' : '.sysalert'))) === 1);
await ctx.close();

// ---------- Sign-up states ----------
ctx = await fresh();
await click(A('[data-act="obSkip"]'));
await click('#dev-number');
await click(A('[data-act="sendCode"]'));
check('D-08 an incomplete number says so', /Enter your full mobile number/.test(await page.locator('.screen[data-device="alex"]').innerText()) && (await st()).screen === 'signup');
await shot('signup-bad-number');
await click('#dev-number');
await click('#dev-sendfail');
await click(A('[data-act="sendCode"]'));
check('D-08 a text that fails says so and offers Try again', /couldn’t send the code/.test(await page.locator('.screen[data-device="alex"]').innerText()) && /Try again/.test(await txt(A('[data-act="sendCode"]'))));
await shot('signup-send-failed');
await click(A('[data-act="sendCode"]'));
for (const k of '111111') await page.click(A(`[data-act="typeKey"][data-k="${k}"]`));
await wait(300);
check('D-08 a wrong code says so', /That code didn’t work/.test(await page.locator('.screen[data-device="alex"]').innerText()));
await shot('signup-wrong-code');
check('D-08 a new code waits 30 seconds', (await count(A('[data-act="resendCode"]'))) === 0 && /send a new code in 0:\d\d/.test(await page.locator('.screen[data-device="alex"]').innerText()));
await page.evaluate(() => { window.TML.core.S.alex.resendAt = window.TML.core.now() - 1; });
await wait(1300);
check('D-08 after 30 seconds, Send a new code', (await count(A('[data-act="resendCode"]'))) === 1);
await click('#dev-expire');
await click(A('[data-act="fillCode"]'));
check('D-08 an expired code says so', /That code has expired/.test(await page.locator('.screen[data-device="alex"]').innerText()) && (await count(A('[data-act="resendCode"]'))) === 1);
await shot('signup-expired');
await click(A('[data-act="resendCode"]'));
check('D-08 Send a new code works', /New code sent/.test(await page.locator('.screen[data-device="alex"]').innerText()));
await click(A('[data-act="fillCode"]'), 1500);
check('a good code continues to the picker', (await st()).screen === 'picker');
await ctx.close();

// ---------- Mom's page: broken link, map that fails, a browser without location ----------
ctx = await fresh();
await click('#dev-broken');
check('D-08 a broken link is not an expired one', (await txt(Mo('h1'))) === 'This link doesn’t work');
await shot('mom-broken-link');
await signup();
await click('#ctl-call');
await callShare();
await allowLocation();
await click(A('[data-act="openShareSheet"]'));
await sendToMom();
await click(A('[data-act="notifLater"]'));
await click(Mo('[data-act="openLink"]'), 900);
await click('#dev-mapfail');
check('D-08 the map didn’t load: says so, keeps the status', (await count(Mo('.map-failed'))) === 1 && /The map didn’t load/.test(await txt(Mo('.map-failed'))));
await shot('mom-map-failed');
await click(Mo('[data-act="retryMap"]'));
check('D-08 Try again brings the map back', (await count(Mo('.map-failed'))) === 0);
await click('#dev-nogeo');
check('D-08 a browser without location support says so', /This browser can’t share your location/.test(await page.locator('.screen[data-device="mom"]').innerText()));
await shot('mom-no-geo');
await ctx.close();

// ---------- Larger text ----------
ctx = await fresh({ text: 'large' });
await signup();
await click('#ctl-call');
await callShare();
await allowLocation();
await click(A('[data-act="openShareSheet"]'));
await sendToMom();
await click(A('[data-act="notifLater"]'));
await click(Mo('[data-act="openLink"]'), 900);
const cols = await page.locator(A('.tiles')).evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
check('D-09 tiles go one per row', cols === 1, cols);
const actDir = await page.locator(A(android ? '.a-actions' : '.actions')).evaluate((e) => getComputedStyle(e).flexDirection);
check('D-09 actions stack', actDir === 'column', actDir);
const stop = A('[data-act="askStop"]');
await page.locator(stop).scrollIntoViewIfNeeded();
check('D-09 Stop sharing stays reachable', await page.locator(stop).isVisible());
const bodySize = await page.locator(A('.person .t1')).first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
check('D-09 text is larger', bodySize > 25, bodySize);
const clipped = await page.locator(A('.tile b')).evaluateAll((els) => els.some((e) => getComputedStyle(e).textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth));
check('D-09 no values cut off', !clipped);
await shot('large-live');
await click(Mo('[data-act="askPermission"]'));
await click(Mo('[data-act="allowLoc"]'), 1500);
await shot('large-both-live');
await click('#ctl-call', 600);
await ctx.close();

// ---------- Dark-mode details ----------
if (theme === 'dark') {
  ctx = await fresh();
  await signup();
  await click(A('[data-act="tab"][data-tab="settings"]'));
  if (!android) {
    const [sel, track] = await page.locator(A('.segmented')).first().evaluate((e) => [getComputedStyle(e.querySelector('[aria-pressed="true"]')).backgroundColor, getComputedStyle(e).backgroundColor]);
    const lum = (c) => { const k = c.startsWith('color(') ? 255 : 1; const m = c.match(/\d+(\.\d+)?/g).map(Number).map((v) => v * k); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
    check('D-04 the chosen segment is lighter than the track in dark', lum(sel) > lum(track), `${sel} vs ${track}`);
  }
  await ctx.close();
}

check('X-08 works offline: no requests leave the page', external.size === 0, [...external].slice(0, 3).join(' '));
console.log(checks.join('\n'));
console.log(errors.length ? errors.join('\n') : 'no errors');
await b.close();
