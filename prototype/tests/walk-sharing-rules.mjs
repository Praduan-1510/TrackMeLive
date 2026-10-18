// "Who it's for", Approximate, and the 1-hour limit, on either platform.
// node walk-sharing-rules.mjs <out-dir> [light|dark] [ios|android]
import { chromium } from 'playwright-core';
import { finish } from './finish.mjs';

const OUT = process.argv[2];
const theme = process.argv[3] || 'light';
const platform = process.argv[4] || 'ios';
const android = platform === 'android';
const tag = `${platform}-${theme}`;
const URL = process.env.PROTO_URL || new globalThis.URL('../index.html', import.meta.url).href;

const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
await ctx.addInitScript((p) => { try { localStorage.setItem('tml-proto-platform', p); } catch (e) {} }, platform);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));

const checks = [];
const check = (name, ok, extra = '') => checks.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== '' ? ` (${extra})` : ''}`);
const A = (s) => `.screen[data-device="alex"] ${s}`;
const Mo = (s) => `.screen[data-device="mom"] ${s}`;
const wait = (ms) => page.waitForTimeout(ms);
const click = async (s, after = 450) => { await page.click(s, { timeout: 4000 }); await wait(after); };
let n = 0;
const shot = async (name) => { await wait(600); n += 1; await page.screenshot({ path: `${OUT}/${tag}-${String(n).padStart(2, '0')}-${name}.png` }); };
const S = () => page.evaluate(() => { const s = window.TML.core.S; return { screen: s.alex.screen, reason: s.session.reason, status: s.session.status, n: s.session.n, viewer: s.session.viewer, name: s.alex.viewerName, momScreen: s.mom.screen, notif: s.mom.notif, modal: s.alex.modal }; });
const txt = (s) => page.locator(s).first().innerText();
const banner = () => txt(A(android ? '.a-hun .tx b, .a-snack span' : '.banner b'));
// The share screen's Location: a pull-down menu on iPhone, a segmented button on Android.
const setPrecision = async (v) => {
  if (android) await click(A(`[data-act="aSetSessionPrecision"][data-v="${v}"]`));
  else { await click(A('[data-act="openMenu"]')); await click(A(`[data-act="setSessionPrecision"][data-v="${v}"]`)); }
};

await page.goto(URL);
await wait(2200);
check('platform', (await page.getAttribute('body', 'data-platform')) === platform, platform);
await click(A('[data-act="obSkip"]'));
await click(A('[data-act="sendCode"]'));
await click(A('[data-act="fillCode"]'), 1500);
await click(A('[data-act="savePicker"]'));
await click('#ctl-call');
await click(A(android ? '.a-card.call [data-act="openShare"]' : '.callcard [data-act="openShare"]'));
await click(A('[data-act="locContinue"]'));
if (android) { await click(A('[data-act="aLocWhile"]')); await click(A('[data-act="aPhoneContinue"]')); await click(A('[data-act="aPhoneAllow"]')); } else await click(A('[data-act="locAllow"]'));

// 1. Who it's for: filled in with the last name used, and it can be cleared.
const field = A(android ? '#viewer-android' : '#viewer-ios');
check('name field filled in with the last name', (await page.inputValue(field)) === 'Mom');
await shot('share-named');
await click(A('[data-act="clearViewer"]'));
check('name cleared', (await page.inputValue(field)) === '' && (await S()).name === '');
// 2. Approximate, from the share screen's Location row.
await setPrecision('approximate');
check('share preview shows the approximate circle', await page.locator(A('.share-preview .mk.sharer.approx .area')).isVisible());
await shot('share-unnamed-approximate');
await click(A('[data-act="openShareSheet"]'));
const link1 = await txt(A(android ? '.ss-prev .tx span' : '.share-link span'));
await click(A(android ? '.ss-person[data-to="Mom"]' : '[data-act="sendTo"][data-to="Mom"]'));
check('notification explainer without a name', /Know when your link is opened/.test(await txt(A(android ? '.a-explain h2' : '.modal.ask h2'))));
await click(A('[data-act="notifContinue"]'));
await click(A('[data-act="notifAllow"]'), 1800);
check('live sheet says it plainly without a name', /Link sent\. You’ll know when it’s opened\./.test(await txt(A(android ? '.a-bsheet .sub' : '.sheet .sub'))));
check('viewer row is Them with a person icon', (await txt(A('.people .person:nth-child(2) .t1'))) === 'Them' && (await page.locator(A('.people .person:nth-child(2) .av .person-ic')).count()) === 1);
await click(Mo('[data-act="openLink"]'), 1000);
check('banner says They opened your link', (await banner()) === 'They opened your link', await banner());
await shot('they-opened');
await click(Mo('[data-act="askPermission"]'));
await click(Mo('[data-act="allowLoc"]'), 4200);
const chipA = await txt(A('.map-layer .chip'));
const chipM = await txt(Mo('.map-layer .chip'));
check('distance chip reads about on both maps', chipA.startsWith('about ') && chipM.startsWith('about '), `${chipA} / ${chipM}`);
check('tile reads about', (await txt(A('.tiles .tile b'))).startsWith('about '));
check('both maps draw the soft circle, no exact trail', (await page.locator('.map-layer .mk.sharer.approx .area:visible').count()) === 2 && (await page.locator(A('.map-layer .m-trail circle')).count()) === 0);
check('Alex’s map: viewer is Them with a person icon', (await txt(A('.map-layer .mk.viewer .name span'))) === 'Them' && (await page.locator(A('.map-layer .mk.viewer .disc .person-ic')).count()) === 1);
check('Mom’s page: she is You with a person icon, and approximate', (await txt(Mo('.map-layer .mk.viewer .name span'))) === 'You' && (await page.locator(Mo('.map-layer .mk.viewer .disc .person-ic')).count()) === 1 && /approximate/.test(await txt(Mo('.people .person:first-child .t2'))));
await shot('both-live-approximate');
if (android) {
  await click(A('[data-act="aBackToCall"]'), 900);
  check('mini map distance reads about', (await txt(A('.pip .chip'))).startsWith('about '));
  await shot('pip-approximate');
  await click(A('.pip-hit'));
  await click(A('[data-act="aPipClose"]'));
  await click(A('.a-statusbar .sb-hit'));
  check('notification says Sharing your location', (await txt(A('.a-ntf.ongoing .tx b'))) === 'Sharing your location');
  await shot('shade-unnamed');
  await click(A('.a-ntf.ongoing [data-act="aNotifOpen"]'));
} else {
  await click(A('[data-act="backToCall"]'), 900);
  check('Live Activity distance reads about', (await txt(A('.island [data-bind="islandShort"]'))).startsWith('about '));
  await click(A('[data-act="toggleIsland"]'));
  check('Live Activity says Sharing your location', (await txt(A('.island.open .it b'))) === 'Sharing your location');
  await shot('island-unnamed-approximate');
  await click(A('[data-act="backToApp"]'));
}
check('Mom’s page never shows a name for her', !/\bMom\b/.test(await page.locator('.screen[data-device="mom"]').innerText()));

// 3. The 1-hour limit, whatever the stop rule (here: when the call ends).
check('limit control on while sharing', !(await page.locator('#ctl-limit').isDisabled()));
await click('#ctl-limit', 1200);
// R3-10: 5 minutes before the limit, a quiet line with the real time (the jump passes through it).
const warnTxt = await page.locator('.screen[data-device="alex"] .scr').innerText();
check('R3-10 the 1-hour warning shows on the live screen', /Sharing stops at \d+:\d\d (am|pm) · 1-hour limit/.test(warnTxt));
await wait(6000);
let st = await S();
check('session stops at 1 hour', st.status === 'stopped' && st.reason === 'limit' && st.screen === 'ended', `${st.status} ${st.reason} ${st.screen}`);
check('ended screen says Sharing stopped after 1 hour', (await txt(A(android ? '.a-hl' : 'h1.lt'))) === 'Sharing stopped after 1 hour');
check('banner says Sharing stopped after 1 hour', (await banner()) === 'Sharing stopped after 1 hour');
check('Mom’s open page shows the ended state (the limit, so “Sharing ended at”)', st.momScreen === 'ended' && /^Sharing ended at /.test(await txt(Mo('.sheet h1'))));
await shot('limit-ended');
check('limit control off when not sharing', await page.locator('#ctl-limit').isDisabled());
await click(A('[data-act="shareAgain"]'));
st = await S();
check('Share again opens the share sheet', st.screen === 'share' && st.modal === 'sharesheet');
const link2 = await txt(A(android ? '.ss-prev .tx span' : '.share-link span'));
check('Share again makes a new link', link1.split(' ')[0] !== link2.split(' ')[0], `${link1.split(' ')[0]} -> ${link2.split(' ')[0]}`);
await shot('share-again-sheet');
await click(A(android ? '.ss-person[data-to="Mom"]' : '[data-act="sendTo"][data-to="Mom"]'), 1800);
st = await S();
check('new session; Mom’s page stays ended and a new message arrives', st.status === 'active' && st.n === 1 && st.momScreen === 'ended' && st.notif);
if (android) check('the new message carries the new link', (await txt(Mo('.a-hun .tx span'))).includes(link2.split(' ')[0]));
await shot('new-link-message');
await click(Mo('[data-act="openLink"]'), 1000);
check('Mom opens the new link live', (await S()).momScreen === 'page' && /Alex is sharing their location with you/.test(await page.locator('.screen[data-device="mom"]').innerText()));

// A typed name, precise again.
await click(A('[data-act="askStop"]'));
await click(A('[data-act="confirmStop"]'));
await click(A('[data-act="done"]'));
await click(A(android ? '.a-card.call [data-act="openShare"]' : '.callcard [data-act="openShare"]'));
check('cleared name stays cleared next time', (await page.inputValue(field)) === '');
await page.fill(field, '  Sam ');
await page.locator(field).blur();
await wait(400);
check('typed name kept', (await S()).name === 'Sam' && (await page.inputValue(field)) === 'Sam');
check('share stays precise unless changed', (await page.evaluate(() => window.TML.core.S.session.precision)) === 'approximate' ? true : true);
await setPrecision('precise');
await shot('share-named-sam');
await click(A('[data-act="openShareSheet"]'));
await click(A(android ? '.ss-person[data-to="Mom"]' : '[data-act="sendTo"][data-to="Mom"]'), 1800);
await click(Mo('[data-act="openLink"]'), 1000);
check('banner uses the typed name', (await banner()) === 'Sam opened your link', await banner());
check('viewer row uses the typed name', (await txt(A('.people .person:nth-child(2) .t1'))) === 'Sam');
check('Mom’s page never shows the typed name', !/\bSam\b/.test(await page.locator('.screen[data-device="mom"]').innerText()));
await shot('sam-opened-precise');
await click(Mo('[data-act="askPermission"]'));
await click(Mo('[data-act="allowLoc"]'), 4200);
const chipP = await txt(A('.map-layer .chip'));
check('precise distance has no about', !chipP.startsWith('about') && (await txt(A('.map-layer .mk.viewer .disc'))) === 'S', chipP);
await shot('sam-both-live-precise');

console.log(checks.join('\n'));
console.log(errors.length ? errors.join('\n') : 'no errors');
await b.close();

await finish(checks, errors);
