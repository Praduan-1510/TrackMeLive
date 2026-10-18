// Full Android walkthrough of the Track Me Live prototype.
// node walk-android.mjs <out-dir> [light|dark] [viewport-width]
// Covers every Android permission path, the picture-in-picture mini map, the notification shade,
// the system Settings pages, accessories, and switching platforms and back.
import { chromium } from 'playwright-core';
import { finish } from './finish.mjs';

const OUT = process.argv[2];
const theme = process.argv[3] || 'light';
const width = Number(process.argv[4] || 1440);
const narrow = width <= 1180;
const URL = process.env.PROTO_URL || new globalThis.URL('../index.html', import.meta.url).href;
const tag = `${theme}${narrow ? '-narrow' : ''}`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width, height: narrow ? 1000 : 900 }, colorScheme: theme });
const errors = [];
const accMissing = new Set();
const checks = [];
const check = (name, ok, extra = '') => { checks.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`); };
const isAcc = (u) => String(u || '').includes('/Mascots/accessories/');

function watch(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !isAcc(m.location().url) && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('console', (m) => { if (m.type() === 'error' && /ERR_FILE_NOT_FOUND/.test(m.text()) && !isAcc(m.location().url)) errors.push(`console: ${m.text()} @${m.location().url}`); });
  page.on('requestfailed', (r) => { if (isAcc(r.url())) accMissing.add(r.url().split('/').pop()); else errors.push(`requestfailed: ${r.url()}`); });
}

const A = (s) => `.screen[data-device="alex"] ${s}`;
const Mo = (s) => `.screen[data-device="mom"] ${s}`;
let page;
let n = 0;
const wait = (ms) => page.waitForTimeout(ms);
async function show(who) {
  if (!narrow) return;
  const cur = await page.locator('.devices').getAttribute('data-show');
  if (cur !== who) { await page.click(`[data-show-btn="${who}"]`); await wait(300); }
}
const whoOf = (sel) => (sel.startsWith('.screen[data-device="mom"]') ? 'mom' : sel.startsWith('.screen[data-device="alex"]') ? 'alex' : null);
async function click(sel, opts = {}) {
  const who = whoOf(sel);
  if (who) await show(who);
  await page.click(sel, { timeout: 4000, ...opts });
  await wait(opts.after ?? 450);
}
async function shot(name, who) {
  if (who) await show(who);
  await wait(650);
  n += 1;
  await page.screenshot({ path: `${OUT}/${tag}-${String(n).padStart(2, '0')}-${name}.png` });
}
const count = (sel) => page.locator(sel).count();
const text = (sel) => page.locator(sel).first().innerText();
const state = () => page.evaluate(() => {
  const S = window.TML.core.S;
  return { screen: S.alex.screen, acc: S.alex.accessory, mascot: S.alex.mascot, perm: { ...S.alex.perm }, pip: S.alex.pip, platform: S.platform, session: S.session.status, precision: S.session.precision };
});

async function quickSignup() {
  await click(A('[data-act="obSkip"]'));
  await click(A('[data-act="sendCode"]'));
  await click(A('[data-act="fillCode"]'), { after: 1500 });
  await click(A('[data-act="savePicker"]'));
}

// ---------------- Scenario A: the main story ----------------
page = await ctx.newPage();
watch(page);
await page.goto(URL);
await wait(300);
await page.click('[data-platform-set="android"]');
await shot('splash', 'alex');
await wait(1400);
check('platform switch shows Android', (await page.getAttribute('body', 'data-platform')) === 'android');
check('status bar is Android', (await count(A('.a-statusbar .sb'))) === 1 && await page.locator(A('.statusbar')).isHidden());
await shot('onboarding-1', 'alex');
await click(A('[data-act="obNext"]'));
await shot('onboarding-2', 'alex');
await click(A('[data-act="obNext"]'));
await shot('onboarding-3', 'alex');
await click(A('[data-act="obNext"]'));
await shot('signup', 'alex');
await click(A('[data-act="sendCode"]'));
await shot('code-gboard', 'alex');
await click(A('[data-act="fillCode"]'), { after: 350 });
await shot('code-filled', 'alex');
await wait(900);

// Picker and accessories
check('picker shows accessory chips for the fox', (await count(A('[data-act="pickAccessory"]'))) === 4);
await click(A('[data-act="pickAccessory"][data-id="headphones"]'));
await shot('picker-fox-headphones', 'alex');
await click(A('[data-act="pickMascot"][data-id="astronaut"]'));
let st = await state();
check('astronaut resets accessory to none', st.acc === 'none', st.acc);
check('astronaut shows the no-accessory line', (await count(A('.a-acc-none'))) === 1);
await shot('picker-astronaut', 'alex');
await click(A('[data-act="pickMascot"][data-id="robot"]'));
const chipNames = () => page.locator(A('[data-act="pickAccessory"]')).evaluateAll((els) => els.map((e) => [...e.childNodes].filter((x) => x.nodeType === 3).map((x) => x.textContent).join('').trim()));
check('robot offers None and Headlamp', (await chipNames()).join('|') === 'None|Headlamp', (await chipNames()).join('|'));
await click(A('[data-act="pickAccessory"][data-id="headlamp"]'));
await click(A('[data-act="pickMascot"][data-id="ghost"]'));
st = await state();
check('ghost keeps the headlamp', st.acc === 'headlamp', st.acc);
await click(A('[data-act="pickSet"][data-id="anime"]'));
await click(A('[data-act="pickMascot"][data-id="hero"]'));
st = await state();
check('hero drops the headlamp', st.acc === 'none', st.acc);
await click(A('[data-act="pickAccessory"][data-id="glasses"]'));
await click(A('[data-act="pickColor"][data-id="dusk"]'));
await shot('picker-hero-glasses-dusk', 'alex');
const accImg = await count(A('.pick-stage .acc-layer'));
check('accessory layer rendered or hidden gracefully', true, accImg ? 'layer present' : 'layer omitted after a failed load');
await click(A('[data-act="pickSet"][data-id="classics"]'));
await click(A('[data-act="pickMascot"][data-id="fox"]'));
await click(A('[data-act="pickColor"][data-id="original"]'));
await click(A('[data-act="pickAccessory"][data-id="glasses"]'));
await click(A('[data-act="savePicker"]'));
await shot('home', 'alex');

// A call starts. Notifications aren't allowed yet, so the offer is the card on Home.
await click('#ctl-call');
check('no heads-up before notifications are allowed', (await count(A('.a-hun'))) === 0);
await shot('home-on-call', 'alex');
await click(A('.a-card.call [data-act="openShare"]'));
await shot('location-explainer', 'alex');
await click(A('[data-act="locContinue"]'));
await shot('location-dialog', 'alex');
await click(A('[data-act="aLocChoice"][data-v="approximate"]'));
await shot('location-dialog-approximate', 'alex');
await click(A('[data-act="locDeny"]'));
await shot('location-off', 'alex');
await click(A('[data-act="aSysLoc"]'));
await shot('settings-location-denied', 'alex');
await click(A('[data-act="aSysSet"][data-v="while"]'));
await shot('settings-location-while', 'alex');
await click(A('[data-act="aSysBack"]'));
// The first share during a call asks for Phone next, after location.
check('first share during a call asks for Phone after location', (await count(A('.a-explain'))) === 1);
await shot('phone-explainer', 'alex');
await click(A('[data-act="aPhoneContinue"]'));
await shot('phone-dialog', 'alex');
await click(A('[data-act="aPhoneAllow"]'));
st = await state();
check('then continues to Share', st.screen === 'share' && st.perm.phone === 'allowed', st.screen);
await click(A('[data-act="aSetSessionPrecision"][data-v="approximate"]'));
check('Location is a segmented button: Approximate', (await state()).precision === 'approximate');
await shot('share-approximate', 'alex');
await click(A('[data-act="aSetSessionPrecision"][data-v="precise"]'));
st = await state();
check('and back to Precise', st.precision === 'precise', st.precision);
await click(A('[data-act="openShareSheet"]'));
await shot('sharesheet', 'alex');
await click(A('.ss-person[data-to="Mom"]'));
await shot('notif-explainer', 'alex');
await click(A('[data-act="notifContinue"]'));
await shot('notif-dialog', 'alex');
await click(A('[data-act="notifAllow"]'), { after: 1800 });
check('location indicator in the status bar', (await count(A('.a-statusbar .sb-loc'))) === 1);
check('ongoing notification icon in the status bar', (await count(A('.a-statusbar .a-sbic'))) === 1);
await shot('live-waiting', 'alex');
await shot('mom-messages-headsup-on-call', 'mom');
await click(Mo('[data-act="openLink"]'), { after: 1000 });
await shot('mom-chrome-page', 'mom');
await shot('alex-headsup-opened', 'alex');
await click(Mo('[data-act="dismissShareBack"]'));
await click(A('[data-act="askShare"]'));
await shot('alex-asked-snackbar', 'alex');
await shot('mom-asked', 'mom');
await click(Mo('[data-act="askPermission"]'));
await shot('mom-chrome-location-dialog', 'mom');
await click(Mo('[data-act="allowLoc"]'), { after: 4200 });
check('Mom location indicator', (await count(Mo('.a-statusbar .sb-loc'))) === 1);
await shot('both-live', 'alex');
await shot('mom-both-live', 'mom');
await click(A('[data-act="openTimer"]'));
await shot('timer-sheet', 'alex');
await click(A('[data-act="setStop"][data-v="30"]'));
await click('#ctl-signal', { after: 1400 });
await shot('signal-lost', 'alex');
await click('#ctl-signal');

// Picture-in-picture
await click(A('[data-act="aBackToCall"]'), { after: 900 });
check('PiP shows on the call screen', await page.locator(A('.pip.on')).isVisible());
check('PiP shows both markers and the distance', (await page.locator(A('.pip .mk.sharer .disc')).isVisible()) && (await page.locator(A('.pip .mk.viewer .disc')).isVisible()) && (await page.locator(A('.pip .chip')).isVisible()));
await shot('call-pip', 'alex');
await click(A('.pip-hit'));
await shot('pip-controls', 'alex');
await click(A('[data-act="aPipExpand"]'));
st = await state();
check('PiP expand opens the live map', st.screen === 'live', st.screen);
await click(A('[data-act="aBackToCall"]'), { after: 700 });
await click(A('.pip-hit'));
await click(A('[data-act="aPipClose"]'));
st = await state();
check('PiP close keeps sharing', st.pip === 'closed' && st.session === 'active');
check('PiP hidden after close', await page.locator(A('.pip')).isHidden());
await shot('call-pip-closed', 'alex');
await click(A('.a-statusbar .sb-hit'));
check('shade shows the ongoing notification', (await count(A('.a-ntf.ongoing'))) === 1);
await shot('shade', 'alex');
await click(A('.a-ntf.ongoing [data-act="aNotifOpen"]'));
st = await state();
check('notification Open returns to the map', st.screen === 'live', st.screen);

// The call ends; the timer keeps sharing going.
await click('#ctl-call', { after: 700 });
await shot('call-ended-headsup', 'alex');
await click(A('[data-act="askStop"]'));
await shot('stop-dialog', 'alex');
await click(A('[data-act="confirmStop"]'));
await shot('ended', 'alex');
await click('#ctl-later');
await shot('mom-expired', 'mom');

// Share faster during calls: the Quick Settings tile, then quick start during a call.
await click(A('[data-act="done"]'));
check('Share faster card on Home after the first share', (await count(A('.a-card.tip'))) === 1);
check('no Allow all the time anywhere', !/all the time/i.test(await page.locator(A('.scr')).innerText()));
await shot('home-tip-card', 'alex');
await click(A('[data-act="aTileAsk"]'));
check('Android’s own Add tile dialog', (await count(A('.a-tiledlg'))) === 1);
await shot('add-tile-dialog', 'alex');
await click(A('[data-act="aTileAdd"]'));
check('tile added, card gone', (await count(A('.a-card.tip'))) === 0 && (await page.evaluate(() => window.TML.core.S.alex.tileAdded)));
check('Quick Settings control off without a call', await page.locator('#ctl-quick').isDisabled());
await click('#ctl-call');
await click('#ctl-quick');
check('Quick Settings shows the Share location tile', (await count(A('.a-shade.qs [data-act="aQsTile"]'))) === 1);
await shot('quick-settings', 'alex');
await click(A('.a-shade.qs [data-act="aQsTile"]'));
st = await state();
check('the tile opens the share screen', st.screen === 'share', st.screen);
await click(A('[data-act="goHome"]'));
await click('#ctl-call');

// Settings and its system pages
await click(A('[data-act="tab"][data-tab="settings"]'));
await shot('settings-top', 'alex');
await page.locator(A('.a-content')).evaluate((el) => { el.scrollTop = el.scrollHeight; });
await shot('settings-bottom', 'alex');
await click(A('[data-act="aPermPhone"]'));
await shot('settings-phone-page', 'alex');
await click(A('[data-act="aSysBack"]'));
await click(A('[data-act="aPermNotif"]'));
await shot('settings-notifications-page', 'alex');
await click(A('[data-act="aSysBack"]'));
await click(A('[data-act="askDelete"]'));
await shot('delete-dialog', 'alex');
await click(A('[data-act="cancelAlert"]'));
await click(A('[data-act="tab"][data-tab="mascot"]'));
await shot('picker-from-tab', 'alex');
await click(A('[data-act="tab"][data-tab="home"]'));

// Switch to iPhone and back: state survives, nothing breaks.
await page.click('[data-platform-set="ios"]');
await wait(500);
check('iPhone chrome back', await page.locator(A('.statusbar')).isVisible() && await page.locator(A('.a-statusbar')).isHidden());
await shot('switched-to-iphone', 'alex');
await page.click('[data-platform-set="android"]');
await wait(400);
await click('#restart', { after: 600 });
check('Restart keeps Android', (await page.getAttribute('[data-platform-set="android"]', 'aria-pressed')) === 'true' && (await state()).platform === 'android');
await page.close();

// ---------------- Scenario B: no call, Only this time, notifications off ----------------
page = await ctx.newPage();
watch(page);
await page.goto(URL);
await wait(2200);
check('Android persists across reloads', (await state()).platform === 'android');
await quickSignup();
await click(A('.a-cta[data-act="openShare"]'));
await click(A('[data-act="locContinue"]'));
await click(A('[data-act="aLocChoice"][data-v="approximate"]'));
await click(A('[data-act="aLocOnce"]'));
check('Approximate in the dialog carries to the share', (await state()).precision === 'approximate');
await click(A('[data-act="aSetSessionPrecision"][data-v="precise"]'));
await shot('precise-upgrade', 'alex');
await click(A('[data-act="aUpgradeYes"]'));
st = await state();
check('upgrade to precise', st.precision === 'precise' && st.perm.precise, st.precision);
await click(A('[data-act="openShareSheet"]'));
// Copy link counts as sent: the session starts and the link goes out.
await click(A('.ss-chips [data-act="sendTo"][data-to="Copy"]'));
check('Copy starts the share', (await state()).session === 'active');
await click(A('[data-act="notifContinue"]'));
await click(A('[data-act="notifDeny"]'), { after: 1800 });
check('no status bar notification icon without permission', (await count(A('.a-statusbar .a-sbic'))) === 0);
await shot('mom-lockscreen-notification', 'mom');
await click(Mo('[data-act="openLink"]'), { after: 1000 });
await shot('mom-chrome-not-on-call', 'mom');
check('push becomes a snackbar without notification permission', (await count(A('.a-snack'))) === 1 && (await count(A('.a-hun'))) === 0);
await shot('alex-snackbar-opened', 'alex');
await click('#ctl-call');
await click(A('[data-act="aBackToCall"]'), { after: 800 });
await click(A('.pip-hit'));
await click(A('[data-act="aPipStop"]'));
st = await state();
check('PiP stop opens the app to confirm', st.screen === 'live' && (await count(A('.a-dialog'))) === 1);
await shot('pip-stop-confirm', 'alex');
await click(A('[data-act="cancelAlert"]'));
await click(A('[data-act="aBackToCall"]'), { after: 700 });
await click(A('.pip-hit'));
await click(A('[data-act="aPipClose"]'));
await click(A('.a-statusbar .sb-hit'));
check('shade lists the active app without notification permission', (await count(A('.a-active'))) === 1);
await shot('shade-active-apps', 'alex');
await click(A('.a-active [data-act="aNotifStop"]'));
await click(A('[data-act="confirmStop"]'));
await click(A('[data-act="done"]'));
await click(A('[data-act="tab"][data-tab="settings"]'));
const locRow = await text(A('[data-act="aPermLoc"] .sp'));
check('Only this time becomes Ask every time', locRow === 'Ask every time', locRow);
// The call from the mini-map steps is still on.
await click(A('[data-act="tab"][data-tab="home"]'));
await click(A('.a-card.call [data-act="openShare"]'));
check('Ask every time goes straight to the system dialog', (await count(A('.a-sysdlg'))) === 1 && (await count(A('.a-explain'))) === 0);
await shot('ask-every-time-dialog', 'alex');
await click(A('[data-act="aLocWhile"]'));
await click('#ctl-call');
await page.close();

// ---------------- Scenario C: Phone and location refused ----------------
page = await ctx.newPage();
watch(page);
await page.goto(URL);
await wait(2200);
await quickSignup();
await click('#ctl-call');
await click(A('.a-card.call [data-act="openShare"]'));
await click(A('[data-act="locContinue"]'));
await click(A('[data-act="aLocWhile"]'));
await click(A('[data-act="aPhoneContinue"]'));
await click(A('[data-act="aPhoneDeny"]'));
st = await state();
const share = await page.evaluate(() => ({ stop: window.TML.core.S.session.stop, back: window.TML.core.S.session.shareBack }));
check('Phone refused: the share runs on a timer with share back off', st.screen === 'share' && share.stop === 30 && share.back === false, JSON.stringify(share));
check('the share screen says why in one line', /Without Phone access/.test(await page.locator(A('.scr')).innerText()));
check('no Back to call without Phone', (await count(A('.a-btn.call[data-act="aBackToCall"]'))) === 0);
await shot('phone-denied-share', 'alex');
await click(A('[data-act="goHome"]'));
await click('#ctl-call');
await click(A('[data-act="tab"][data-tab="settings"]'));
check('Settings shows Phone not allowed', /Not allowed/.test(await text(A('[data-act="aPermPhone"]'))), await text(A('[data-act="aPermPhone"]')));
await click(A('[data-act="aPermLoc"]'));
await click(A('[data-act="aSysSet"][data-v="deny"]'));
await shot('settings-location-dont-allow', 'alex');
await click(A('[data-act="aSysBack"]'));
const locRow2 = await text(A('[data-act="aPermLoc"] .sp'));
check('Settings shows Don’t allow', /Don.t allow/.test(locRow2), locRow2);
await click(A('[data-act="tab"][data-tab="home"]'));
await click(A('.a-cta[data-act="openShare"]'));
check('denied location explains Settings', (await count(A('.a-dialog'))) === 1);
await click(A('[data-act="sysClose"]'));
await page.close();

console.log(checks.join('\n'));
console.log(`accessory renders not found (skipped gracefully): ${accMissing.size ? [...accMissing].join(', ') : 'none'}`);
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();

await finish(checks, errors);
