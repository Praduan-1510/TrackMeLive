// The iPhone story end to end, with a screenshot per step.
// node walk.mjs <out-dir> [light|dark]
import { chromium } from 'playwright-core';

const OUT = process.argv[2];
const theme = process.argv[3] || 'dark';
const URL = process.env.PROTO_URL || new globalThis.URL('../index.html', import.meta.url).href;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
await ctx.addInitScript(() => { try { localStorage.setItem('tml-proto-platform', 'ios'); localStorage.setItem('tml-proto-text', 'default'); } catch (e) {} });
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
let n = 0;
const shot = async (name) => { await wait(600); n += 1; await page.screenshot({ path: `${OUT}/${theme}-${String(n).padStart(2, '0')}-${name}.png` }); };
const click = async (s, after = 450) => { await page.click(s, { timeout: 4000 }); await wait(after); };
const count = (s) => page.locator(s).count();
const S = () => page.evaluate(() => { const s = window.TML.core.S; return { screen: s.alex.screen, status: s.session.status, momScreen: s.mom.screen, cc: s.alex.cc, tipDone: s.alex.tipDone, quickUsed: s.alex.quickUsed }; });

await page.goto(URL);
await wait(900);
await shot('splash');
await wait(1300);
check('iPhone chrome', (await page.getAttribute('body', 'data-platform')) === 'ios' && await page.locator(A('.statusbar')).isVisible());
await shot('onboarding-1');
await click(A('[data-act="obNext"]'));
await shot('onboarding-2');
await click(A('[data-act="obNext"]'));
await shot('onboarding-3');
await click(A('[data-act="obNext"]'));
await shot('signup-details');
await click(A('[data-act="sendCode"]'));
await shot('signup-code');
await click(A('[data-act="fillCode"]'), 1500);
await shot('picker');
await click(A('[data-act="pickMascot"][data-id="ghost"]'));
await click(A('[data-act="pickMascot"][data-id="fox"]'));
await click(A('[data-act="savePicker"]'));
check('Home after sign-up', (await S()).screen === 'home');
check('Control Center control off without a call', await page.locator('#ctl-quick').isDisabled());
await shot('home');

// A call, then the first share: location is asked here, never at install.
await click('#ctl-call', 600);
check('Home shows the on-call card, with no second offer', (await count(A('.callcard [data-act="openShare"]'))) === 1 && (await count(A('.offer'))) === 0);
await shot('home-on-call');
await click(A('.callcard [data-act="openShare"]'));
await shot('location-explainer');
await click(A('[data-act="locContinue"]'));
await shot('location-system');
check('no Always option in the system prompt', !/Always/.test(await page.locator(A('.sysalert')).innerText()));
await click(A('[data-act="locAllow"]'));
await shot('share');
await click(A('[data-act="openShareSheet"]'));
await shot('sharesheet');
await click(A('.contact[data-to="Mom"]'), 600);
await shot('notif-explainer');
await click(A('[data-act="notifContinue"]'));
await shot('notif-system');
await click(A('[data-act="notifAllow"]'), 1700);
await shot('live-waiting');

// Mom opens the link; Alex asks; Mom shares back.
await click(Mo('[data-act="openLink"]'), 1000);
await shot('mom-page');
await click(Mo('[data-act="dismissShareBack"]'));
await click(A('[data-act="askShare"]'));
const asked = /Alex asked to see where you are/.test(await page.locator(Mo('.vp')).innerText());
check('request shown on Mom page', asked);
check('ask button hidden after asking', (await count(A('[data-act="askShare"]'))) === 0);
await shot('mom-asked');
await click(Mo('[data-act="askPermission"]'));
await shot('mom-permission');
await click(Mo('[data-act="allowLoc"]'), 4200);
check('both live on Mom’s page', /You’re both live/.test(await page.locator(Mo('.vp h1')).innerText()));
await shot('both-live');
await click(A('[data-act="openTimer"]'));
await shot('timer-sheet');
await click(A('[data-act="setStop"][data-v="30"]'));
await click('#ctl-signal', 1500);
await shot('signal-lost');
await click('#ctl-signal');
// The green call pill in the status bar returns to the call; the Dynamic Island opens the Live Activity.
await click(A('.statusbar [data-act="backToCall"]'), 700);
check('back on the call screen', (await S()).screen === 'call');
await shot('call-island');
await click(A('[data-act="toggleIsland"]'));
await shot('live-activity');
await click(A('[data-act="backToApp"]'));
await click('#ctl-call', 700);
check('the timer keeps sharing after the call', (await S()).status === 'active');
await shot('call-ended-timer-continues');
await click(A('[data-act="askStop"]'));
await shot('stop-alert');
await click(A('[data-act="confirmStop"]'), 700);
await shot('ended');
await click('#ctl-later', 600);
check('Mom opening the link later sees it expired', (await S()).momScreen === 'expired');
await shot('mom-expired');

// Share faster during calls: the education card, then quick start from Control Center.
await click(A('[data-act="done"]'));
check('education card after the first share', (await count(A('.tip-card, [data-act="tipHow"]'))) >= 1);
check('no Always card', !/all the time|Always/i.test(await page.locator(A('.scr')).innerText()));
await shot('home-tip');
await click(A('[data-act="tipHow"]'));
await shot('show-me-how');
await click(A('[data-act="tipDone"]'));
check('card gone after Done', (await count(A('[data-act="tipHow"]'))) === 0 && (await S()).tipDone);
await click('#ctl-call', 500);
await click('#ctl-quick', 600);
check('Control Center opens during a call', (await S()).cc);
await shot('control-center');
await click(A('[data-act="ccShare"]'), 600);
const st = await S();
check('Control Center control opens the share screen', st.screen === 'share' && st.quickUsed && !st.cc, st.screen);
await shot('share-from-control-center');
await click(A('[data-act="goHome"]'));
await click('#ctl-call');
await click(A('[data-act="tab"][data-tab="settings"]'));
await shot('settings');

console.log(checks.join('\n'));
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
