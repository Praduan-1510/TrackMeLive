// Round 2: accessibility (WCAG 2.2 AA on the viewer page, HIG and Material 3 in the app).
// node walk-a11y.mjs <out-dir> [light|dark] [ios|android]
import { chromium } from 'playwright-core';
import { finish } from './finish.mjs';
import { readFileSync } from 'node:fs';

const OUT = process.argv[2];
const theme = process.argv[3] || 'light';
const platform = process.argv[4] || 'ios';
const android = platform === 'android';
const tag = `a11y-${platform}-${theme}`;
const URL = process.env.PROTO_URL || new globalThis.URL('../index.html', import.meta.url).href;
const AXE = readFileSync(new globalThis.URL('./node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');

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
const attr = (s, a) => page.locator(s).first().getAttribute(a);
const focused = () => page.evaluate(() => { const e = document.activeElement; return { act: e.dataset ? e.dataset.act || '' : '', id: e.id, tag: e.tagName.toLowerCase(), cls: typeof e.className === 'string' ? e.className : '', text: (e.textContent || '').trim().slice(0, 60), inMom: !!e.closest('.screen[data-device="mom"]'), inAlex: !!e.closest('.screen[data-device="alex"]') }; });
const said = (who, cls = '.sr-live:not(.sr-alert)') => page.evaluate(([w, c]) => document.querySelector(`.screen[data-device="${w}"] ${c}`).textContent, [who, cls]);
const phrase = (who, which) => page.evaluate(([w, k]) => { const d = document.querySelector(`.screen[data-device="${w}"] .map-layer .mk.${k} .disc`); return d && d.getAttribute('aria-hidden') !== 'true' ? d.getAttribute('aria-label') : null; }, [who, which]);
const docTitle = () => page.evaluate(() => document.querySelector('.screen[data-device="mom"]').dataset.docTitle || '');
// What a screen reader can reach on one phone (Chrome's accessibility tree).
const tree = async (who) => {
  const h = await page.$(`.screen[data-device="${who}"]`);
  const t = await page.accessibility.snapshot({ root: h, interestingOnly: true });
  const out = [];
  const walk = (x) => { if (!x) return; if (x.name) out.push(`${x.role}: ${x.name}`); (x.children || []).forEach(walk); };
  walk(t);
  return out;
};
const axe = (who) => page.evaluate(async (w) => {
  const r = await window.axe.run(document.querySelector(`.screen[data-device="${w}"]`), { preload: false, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).slice(0, 3).join(' | ')}`);
}, who);
// Smallest height of the visible buttons and links on one phone (in the phone's own px).
const minTarget = (who, sel = 'button, a[href]') => page.evaluate(([w, s]) => {
  const scr = document.querySelector(`.screen[data-device="${w}"]`);
  const k = scr.getBoundingClientRect().width / 390;
  const els = [...scr.querySelectorAll(`.ui-layer ${s}, .top-layer ${s}`)].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[inert], .urlbar, .a-chromebar'));
  return els.map((e) => ({ t: (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height / k) })).sort((x, y) => x.h - y.h);
}, [who, sel]);

async function fresh(opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, reducedMotion: opts.reducedMotion || 'no-preference' });
  await ctx.addInitScript(([p, t]) => { try { localStorage.setItem('tml-proto-platform', p); localStorage.setItem('tml-proto-text', t); localStorage.setItem('tml-proto-theme', 'system'); } catch (e) {} }, [platform, opts.text || 'default']);
  await ctx.addInitScript(AXE);
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(URL);
  await wait(2200);
  await page.click('.more summary');
  return ctx;
}
async function signup() {
  await click(A('[data-act="obSkip"]'));
  await click(A('[data-act="sendCode"]'));
  await click(A('[data-act="fillCode"]'), 1500);
  await click(A('[data-act="savePicker"]'));
}
async function share(opts = {}) {
  await click('#ctl-call', 500);
  await click(A(android ? '.a-card.call [data-act="openShare"]' : '.callcard [data-act="openShare"]'));
  await click(A('[data-act="locContinue"]'));
  if (android) { await click(A('[data-act="aLocWhile"]')); await click(A('[data-act="aPhoneContinue"]')); await click(A('[data-act="aPhoneAllow"]')); } else await click(A('[data-act="locAllow"]'));
  if (opts.approx) {
    if (android) await click(A('[data-act="aSetSessionPrecision"][data-v="approximate"]'));
    else { await click(A('[data-act="openMenu"]')); await click(A('[data-act="setSessionPrecision"][data-v="approximate"]')); }
  }
  await click(A('[data-act="openShareSheet"]'));
  await click(A(android ? '.ss-person[data-to="Mom"]' : '.contact[data-to="Mom"]'), 1700);
  await click(A('[data-act="notifLater"]'), 300);
  await click(Mo('[data-act="openLink"]'), 1000);
}

// ---------- Mom's page: structure, words, focus, announcements ----------
let ctx = await fresh();
check('P-08 the stage has an h1 and a focusable steps region', (await count('h1')) >= 1 && (await attr('.story-steps', 'tabindex')) === '0');
await signup();
// A-13: Home doesn't expose the map behind it.
const homeTree = await tree('alex');
check('A-13 Home exposes no map marker ("You")', !homeTree.some((x) => /^img: You\b/.test(x)) && (await attr(A('.map-layer'), 'aria-hidden')) === 'true', homeTree.filter((x) => /You/.test(x)).join(' / '));
await share();
check('A-12 Mom’s page is a main with one h1', (await count(Mo('main'))) === 1 && (await count(Mo('h1'))) === 1);
const h1 = await page.locator(Mo('h1')).innerText();
check('A-12 h1 says Alex is sharing their location with you', h1 === 'Alex is sharing their location with you', h1);
const t1 = await docTitle();
check('A-12 the page has a document title for its state', /^Alex is sharing their location · Track Me Live$/.test(t1), t1);
check('A-12 the map is a labelled region', (await attr(Mo('.map-layer'), 'role')) === 'region' && (await attr(Mo('.map-layer'), 'aria-label')) === 'Map');
check('A-01 the map drawing is one image with a short label', /^Street map around /.test(await attr(Mo('.map-layer svg[role="img"]'), 'aria-label')));
const where1 = await page.locator(Mo('.where .wt > [aria-hidden="true"]')).innerText();
check('A-01 where Alex is, in words, before share back', /^(Near|In) (Market Street|Harbor Way|Alder Park|Quay Gardens)$/.test(where1), where1);
check('A-01 Show Alex is a button and Open in Maps a link, both 48px or more', (await count(Mo('button[data-act="showAlex"]'))) === 1 && /^https:\/\//.test(await attr(Mo('a[data-act="openMaps"]'), 'href'))
  && (await minTarget('mom', '[data-act="showAlex"], [data-act="openMaps"]')).every((x) => x.h >= 48));
check('A-01 chip, initials and name capsules are hidden from screen readers', (await attr(Mo('.map-layer .chip'), 'aria-hidden')) === 'true' && (await attr(Mo('.map-layer .mk.sharer .name'), 'aria-hidden')) === 'true' && (await attr(Mo('.map-layer .mk.viewer .ini'), 'aria-hidden')) === 'true');
const p1 = await phrase('mom', 'sharer');
check('A-02 Alex’s marker reads as one phrase', /^Alex, live, updated (now|\d+ seconds? ago)$/.test(p1), p1);
const sbDesc = (await attr(Mo('.sb-btns [data-act="askPermission"]'), 'aria-describedby')) || '';
const descText = await page.evaluate((ids) => ids.split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' '), sbDesc);
check('A-12 Share my location is described by its hints', /Only during this call/.test(descText) && /browser will ask/.test(descText), descText);
check('A-15 every button on Mom’s page is 48px or more', (await minTarget('mom'))[0].h >= 48, JSON.stringify((await minTarget('mom'))[0]));
check('A-21 Mom’s page uses no icon font', (await count(Mo('.vp .ms'))) === 0);
let ax = await axe('mom');
check('axe: Mom’s page with the share-back offer', ax.length === 0, ax.join(' ; '));
await shot('mom-offer');

// A-04: Not now -> Share my location with Alex
await page.focus(Mo('[data-act="dismissShareBack"]'));
await page.keyboard.press('Enter');
await wait(500);
let f = await focused();
check('A-04 Not now moves focus to Share my location with Alex', f.inMom && f.act === 'askPermission' && /Share my location with Alex/.test(f.text), `${f.act} ${f.text}`);
// Ask to share: announced politely on Mom's page
await click(A('[data-act="askShare"]'), 300);
check('A-03 Alex asking is announced', /Alex asked to see where you are/.test(await said('mom')), await said('mom'));
await wait(300);
// The browser's prompt: focus inside, Tab stays inside, Escape closes it and focus returns
await page.focus(Mo('[data-act="askPermission"]'));
await page.keyboard.press('Enter');
await wait(500);
f = await focused();
check('P-01 the browser prompt takes focus', f.inMom && (/perm|a-sysdlg/.test(f.cls) || ['allowLoc', 'denyLoc', 'aAllowLocOnce'].includes(f.act)), `${f.cls} ${f.act}`);
const trap = [];
for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); await wait(40); const x = await focused(); trap.push(x.act || x.cls); }
check('P-01 Tab stays inside the prompt', trap.every((x) => ['allowLoc', 'denyLoc', 'aAllowLocOnce'].includes(x)), trap.join(','));
await page.keyboard.press('Escape');
await wait(400);
f = await focused();
check('P-01 Escape closes the prompt and focus goes back to the button', (await count(Mo('[data-act="allowLoc"]'))) === 0 && f.act === 'askPermission', f.act);
// Deny -> Try again
await page.keyboard.press('Enter');
await wait(400);
await page.focus(Mo('[data-act="denyLoc"]'));
await page.keyboard.press('Enter');
await wait(500);
f = await focused();
check('A-04 denying moves focus to Try again', f.act === 'askPermission' && /Try again/.test(f.text), `${f.act} ${f.text}`);
check('A-03 location off is announced', /Location is off for this page/.test(await said('mom')), await said('mom'));
// Allow -> Stop sharing my location
await page.keyboard.press('Enter');
await wait(400);
await page.focus(Mo('[data-act="allowLoc"]'));
await page.keyboard.press('Enter');
await wait(600);
f = await focused();
check('A-04 allowing moves focus to Stop sharing my location', f.act === 'stopMine', f.act);
check('A-03 both live is announced', /You’re both live/.test(await said('mom')), await said('mom'));
check('A-12 the title follows the state', (await docTitle()) === 'You’re both live · Track Me Live', await docTitle());
await wait(1500);
const where2 = await page.locator(Mo('.where .wt > [aria-hidden="true"]')).innerText();
const where2s = await page.locator(Mo('.where .wt > .sr-only')).innerText();
check('A-01 once Mom shares back: distance and direction', /^(Near|In) .+ · \d+(\.\d)? (km|m) (north|south|east|west|north-east|north-west|south-east|south-west) of you$/.test(where2), where2);
check('A-01 the spoken line uses long units and no middle dot', /kilometers|meters/.test(where2s) && !/·/.test(where2s), where2s);
const p2 = await phrase('mom', 'sharer');
check('A-02 Alex’s marker: live, distance, recency', /^Alex, live, \d+(\.\d)? kilometers away, updated (now|\d+ seconds? ago)$/.test(p2), p2);
check('A-02 Mom’s own marker', (await phrase('mom', 'viewer')) === 'You, sharing your location');
const pa = await phrase('alex', 'viewer');
check('A-02 Alex’s map: Mom’s marker reads as one phrase', /^Mom, live, \d+(\.\d)? kilometers away, updated (now|\d+ seconds? ago)$/.test(pa), pa);
check('A-02 Alex’s map: his own marker', /^You, live, updated (now|\d+ seconds? ago)$/.test(await phrase('alex', 'sharer')), await phrase('alex', 'sharer'));
// A-17: one label per tile, spoken badges
const tiles = await page.locator(A('.tiles .tile .sr-only')).allInnerTexts();
check('A-17 tiles read as one phrase each', tiles.length === 3 && /^Distance, \d+(\.\d)? kilometers$/.test(tiles[0]) && /^Sharing for (less than a minute|\d+ minutes?)$/.test(tiles[1]) && tiles[2] === 'Stops when the call ends', tiles.join(' | '));
check('A-17 the tiles’ visible text is hidden from screen readers', (await page.locator(A('.tiles .tile b[aria-hidden="true"]')).count()) === 3);
check('A-17 the badge reads Sharing live', (await page.locator(A('.sheet .badge .sr-only, .a-bsheet .badge .sr-only')).first().innerText()) === 'Sharing live');
check('A-17 recency is spoken in full', /^Sharing back, updated (now|\d+ seconds? ago)$/.test(await page.locator(A('[data-bind="momDetailSr"]')).innerText()), await page.locator(A('[data-bind="momDetailSr"]')).innerText());
check('A-17 Mom’s badge reads Live Together', (await page.locator(Mo('.sheet .badge .sr-only')).innerText()) === 'Live Together');
// A-03: nothing is announced while time ticks
await wait(300);
const quietLog = [];
for (let i = 0; i < 8; i++) { quietLog.push(await said('mom')); await wait(1000); }
check('A-03 ticking times are never announced', quietLog.every((x) => !/updated|seconds/.test(x)), quietLog.filter(Boolean).join(' / '));
ax = await axe('mom');
check('axe: Mom’s page, both live', ax.length === 0, ax.join(' ; '));
ax = await axe('alex');
check('axe: Alex’s live map, both live', ax.length === 0, ax.join(' ; '));
await shot('both-live');
// A-01 Show Alex: focus stays, the map centers on Alex
await page.focus(Mo('[data-act="showAlex"]'));
await page.keyboard.press('Enter');
await wait(900);
f = await focused();
check('A-01 Show Alex keeps focus and frames Alex', f.act === 'showAlex' && (await page.evaluate(() => window.TML.core.S.mom.frame)) === 'alex', f.act);
// Open in Maps: a link, intercepted by a stand-in prompt; Escape returns focus to it
await page.focus(Mo('[data-act="openMaps"]'));
await page.keyboard.press('Enter');
await wait(400);
check('A-01 Open in Maps asks before leaving the browser', (await count(Mo('.maps-ask'))) === 1);
await page.keyboard.press('Escape');
await wait(400);
f = await focused();
check('A-04 closing it returns focus to Open in Maps', f.act === 'openMaps' && (await count(Mo('.maps-ask'))) === 0, f.act);
// Signal lost
await click('#ctl-signal', 700);
check('A-03 a dropped signal is announced with the last-seen time', /^Alex’s signal dropped\. Last seen \d+:\d\d (am|pm)\.$/.test(await said('mom')), await said('mom'));
const p3 = await phrase('mom', 'sharer');
check('A-02 a stale marker: last seen and about the distance', /^Alex, last seen at \d+:\d\d (am|pm), about \d+(\.\d)? kilometers away$/.test(p3), p3);
const where3 = await page.locator(Mo('.where .wt > [aria-hidden="true"]')).innerText();
check('A-01 a stale line says last seen', /^Last seen (near|in) /.test(where3), where3);
await wait(3200);
const still = await page.evaluate(() => { const d = document.querySelector('.screen[data-device="mom"] .map-layer .mk.sharer'); return [getComputedStyle(d.querySelector('.disc')).animationName, getComputedStyle(d.querySelector('.halo')).display]; });
check('A-20 a stale marker is still', still[0] === 'none', still.join(' '));
await click('#ctl-signal', 800);
check('A-03 the signal coming back is announced', /Alex is live again/.test(await said('mom')), await said('mom'));
// Stop sharing my location -> the status heading
await page.focus(Mo('[data-act="stopMine"]'));
await page.keyboard.press('Enter');
await wait(600);
f = await focused();
check('A-04 stopping moves focus to the status heading', f.id === 'vp-h1', `${f.tag}#${f.id}`);
check('A-03 stopping is announced', /You stopped sharing your location/.test(await said('mom')), await said('mom'));
// Alex stops: one alert
await click(A('[data-act="askStop"]'));
f = await focused();
check('P-01 the stop alert takes focus on Cancel', f.inAlex && f.act === 'cancelAlert', f.act);
check('P-01 the stop alert is modal and the screen behind is inert', (await attr(A('[role="alertdialog"]'), 'aria-modal')) === 'true' && await page.evaluate(() => document.querySelector('.screen[data-device="alex"] .ui-layer').inert));
await page.keyboard.press('Escape');
await wait(400);
f = await focused();
check('P-01 Escape cancels and focus returns to Stop sharing', f.act === 'askStop' && (await count(A('[data-act="confirmStop"]'))) === 0, f.act);
await click(A('[data-act="askStop"]'));
await click(A('[data-act="confirmStop"]'), 700);
check('A-03 “Alex stopped sharing” is said once, as an alert', (await said('mom', '.sr-alert')) === 'Alex stopped sharing.' && (await attr(Mo('.sr-alert'), 'role')) === 'alert', await said('mom', '.sr-alert'));
check('A-12 the ended page has its own title', (await docTitle()) === 'Alex stopped sharing · Track Me Live', await docTitle());
f = await focused();
check('A-04 after Stop, focus lands on the ended screen’s heading', f.inAlex && f.tag === 'h1', `${f.tag} ${f.text}`);
ax = await axe('mom');
check('axe: Mom’s ended page', ax.length === 0, ax.join(' ; '));
await shot('ended');
await click('#ctl-later', 600);
const expTree = await tree('mom');
check('A-13 the expired page exposes no “Last seen”', !expTree.some((x) => /Last seen/.test(x)) && (await attr(Mo('.map-layer'), 'aria-hidden')) === 'true', expTree.filter((x) => /Last/.test(x)).join(' / '));
check('A-12 the expired page has its own title and h1', (await docTitle()) === 'Location no longer shared · Track Me Live' && (await count(Mo('main h1'))) === 1, await docTitle());
ax = await axe('mom');
check('axe: Mom’s expired page', ax.length === 0, ax.join(' ; '));
await ctx.close();

// ---------- Approximate: the area only ----------
ctx = await fresh();
await signup();
await share({ approx: true });
const whereA = await page.locator(Mo('.where .wt > [aria-hidden="true"]')).innerText();
check('A-01 approximate names only the area', /^In the (Market|Harbor|Alder Park|Quay Gardens) area$/.test(whereA), whereA);
const pA = await phrase('mom', 'sharer');
check('A-02 approximate marker says so', /^Alex, live, approximate location, updated/.test(pA), pA);
await ctx.close();

// ---------- The app: dialogs, targets, controls ----------
ctx = await fresh();
await signup();
await click('#ctl-call', 500);
await click(A(android ? '.a-card.call [data-act="openShare"]' : '.callcard [data-act="openShare"]'));
f = await focused();
check('P-01 the location explainer takes focus', f.inAlex && /modal|a-msheet|a-explain/.test(f.cls), f.cls);
await page.keyboard.press('Escape');
await wait(400);
check('P-01 Escape is Not now on the explainer', (await count(A('[data-act="locContinue"]'))) === 0);
await click(A(android ? '.a-card.call [data-act="openShare"]' : '.callcard [data-act="openShare"]'));
await click(A('[data-act="locContinue"]'));
if (android) { await click(A('[data-act="aLocWhile"]')); await click(A('[data-act="aPhoneContinue"]')); await click(A('[data-act="aPhoneAllow"]')); } else await click(A('[data-act="locAllow"]'));
// Share screen controls
if (!android) {
  const t = await page.evaluate(() => { const s = document.querySelector('.screen[data-device="alex"]'); const k = s.getBoundingClientRect().width / 390; const h = (q) => { const e = s.querySelector(q); return e ? Math.round(e.getBoundingClientRect().height / k) : 0; }; return { clear: h('.vclear'), input: h('#viewer-ios') }; });
  check('A-16 the clear button and the name field are 44pt tall', t.clear >= 44 && t.input >= 44, JSON.stringify(t));
}
const sw = await page.evaluate(() => [...document.querySelectorAll('.screen[data-device="alex"] input[type="checkbox"]')].every((e) => e.getAttribute('role') === 'switch'));
check('P-02 switches are switches', sw);
await page.focus(A('[data-act="openTimer"]'));
await page.keyboard.press('Enter');
await wait(500);
f = await focused();
check('P-01 the timer sheet focuses the chosen option', f.act === 'setStop', f.act);
const lbl = await page.evaluate(() => { const g = document.querySelector('.screen[data-device="alex"] [role="radiogroup"]'); const id = g.getAttribute('aria-labelledby'); return id ? document.getElementById(id).textContent : g.getAttribute('aria-label'); });
check('A-18 / P-03 the options are a labelled radio group: When sharing stops', lbl === 'When sharing stops', lbl);
if (!android) {
  const cl = await page.evaluate(() => { const s = document.querySelector('.screen[data-device="alex"]'); const k = s.getBoundingClientRect().width / 390; return Math.round(s.querySelector('.modal .close').getBoundingClientRect().height / k); });
  check('A-16 the sheet’s close button is 44pt', cl >= 44, cl);
}
await page.keyboard.press('Escape');
await wait(400);
f = await focused();
check('P-01 Escape closes the sheet and focus returns to the row', (await count(A('[data-act="setStop"]'))) === 0 && f.act === 'openTimer', f.act);
await click(A('[data-act="openShareSheet"]'));
await click(A(android ? '.ss-person[data-to="Mom"]' : '.contact[data-to="Mom"]'), 1700);
await click(A('[data-act="notifLater"]'), 300);
ax = await axe('alex');
check('axe: Alex’s live map', ax.length === 0, ax.join(' ; '));
// Segmented and radio groups are labelled
await click(A('[data-act="goHome"]'));
await click(A('[data-act="tab"][data-tab="settings"]'));
const groups = await page.evaluate(() => [...document.querySelectorAll('.screen[data-device="alex"] [role="group"], .screen[data-device="alex"] [role="radiogroup"]')].map((g) => g.getAttribute('aria-label') || g.getAttribute('aria-labelledby') || ''));
check('P-03 every segmented control has a label', groups.length > 0 && groups.every(Boolean), groups.join(','));
if (!android) {
  const seg = await page.evaluate(() => { const s = document.querySelector('.screen[data-device="alex"]'); const k = s.getBoundingClientRect().width / 390; return Math.min(...[...s.querySelectorAll('.segmented button')].map((e) => Math.round(e.getBoundingClientRect().height / k))); });
  check('A-16 segmented buttons are 44pt tall', seg >= 44, seg);
}
ax = await axe('alex');
check('axe: Settings', ax.length === 0, ax.join(' ; '));
await click(A('[data-act="tab"][data-tab="mascot"]'));
check('A-11 the chosen mascot tile has a check badge', (await count(A('[aria-pressed="true"] .pick-check'))) === 1);
ax = await axe('alex');
check('axe: Mascot picker', ax.length === 0, ax.join(' ; '));
if (!android) {
  const chip = await page.evaluate(() => { const s = document.querySelector('.screen[data-device="alex"]'); const k = s.getBoundingClientRect().width / 390; return Math.min(...[...s.querySelectorAll('.acc-chip')].map((e) => Math.round(e.getBoundingClientRect().height / k))); });
  check('A-16 accessory chips are 44pt tall', chip >= 44, chip);
}
await ctx.close();

// ---------- Map drawing: keylines, trail, line, labels, motion ----------
ctx = await fresh();
await signup();
await share();
await click(Mo('[data-act="askPermission"]'));
await click(Mo('[data-act="allowLoc"]'), 4200);
const mapCss = await page.evaluate(() => {
  const s = document.querySelector('.screen[data-device="mom"] .map-layer');
  const disc = getComputedStyle(s.querySelector('.mk.sharer .disc'));
  const dot = s.querySelector('.m-trail circle');
  const lbl = [...document.querySelectorAll('.screen .map-layer .m-label')].map((e) => e.getBoundingClientRect().height);
  const scr = document.querySelector('.screen[data-device="mom"]');
  const k = scr.getBoundingClientRect().width / 390;
  const label = [...scr.querySelectorAll('.map-layer .m-label')].map((e) => { const m = e.getScreenCTM(); return parseFloat(getComputedStyle(e).fontSize) * (Math.hypot(m.a, m.b) / k); });
  return {
    shadow: disc.boxShadow, border: disc.borderTopColor,
    trailFill: dot ? getComputedStyle(dot).fill : '',
    trailOp: Math.min(1, ...[...s.querySelectorAll('.m-trail circle')].map((c) => Number(getComputedStyle(c).opacity) * Number(c.getAttribute('opacity') || 1))),
    trailR: [...s.querySelectorAll('.m-trail circle')].map((c) => Number(c.getAttribute('r'))),
    fills: ['--map-land', '--map-park', '--map-water', '--map-road', '--map-road-major'].map((v) => getComputedStyle(scr).getPropertyValue(v).trim()),
    lineOp: getComputedStyle(s.querySelector('.m-line')).strokeOpacity,
    labelPx: Math.min(...label), lbl: lbl.length,
    pinged: [...s.querySelectorAll('.mk')].map((m) => [m.classList.contains('pinged'), getComputedStyle(m.querySelector('.disc')).animationIterationCount]),
  };
});
check('A-07 the sharer’s ring has a 1pt outer keyline', /0px 0px 0px 1px/.test(mapCss.shadow), mapCss.shadow);
const tokens = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('.screen[data-device="mom"]')); return { lt: cs.getPropertyValue('--lamplight-text').trim(), l: cs.getPropertyValue('--lamplight').trim() }; });
// R3-14: every trail dot at full strength; age by size (8px newest, 4px oldest); 3:1 on every map fill.
const hex = (c) => { const m = c.match(/\d+(\.\d+)?/g); if (c.startsWith('#')) { const h = c.slice(1); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); } return m.slice(0, 3).map(Number); };
const lumi = (rgb) => { const l = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * l(rgb[0]) + 0.7152 * l(rgb[1]) + 0.0722 * l(rgb[2]); };
const ratio = (a, b2) => { const x = lumi(hex(a)), y = lumi(hex(b2)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const trailRatios = mapCss.fills.filter(Boolean).map((f) => ratio(mapCss.trailFill, f));
const want = theme === 'dark' ? tokens.l : tokens.lt;
check('A-08 / R3-14 trail dots are full strength in lamplight-text (light) or lamplight (dark)', mapCss.trailOp === 1 && ratio(mapCss.trailFill, want) < 1.01, `${mapCss.trailFill} op ${mapCss.trailOp}`);
check('R3-14 trail age shows by size, 4px to 8px', mapCss.trailR.length > 1 && Math.min(...mapCss.trailR) >= 2 && Math.max(...mapCss.trailR) <= 4.01 && mapCss.trailR[mapCss.trailR.length - 1] > mapCss.trailR[0], mapCss.trailR.map((r) => (r * 2).toFixed(1)).join(','));
check('R3-14 every trail dot holds 3:1 on every map fill', trailRatios.every((r) => r >= 3), trailRatios.map((r) => r.toFixed(2)).join(' / '));
check('A-09 the connector line is at 60%', Number(mapCss.lineOp) === 0.6, mapCss.lineOp);
check('A-10 map labels render at 11px or more, even when the map zooms out', mapCss.labelPx >= 10.95, mapCss.labelPx.toFixed(2));
check('A-20 markers animate a fixed number of times, never forever', mapCss.pinged.every(([, it]) => it !== 'infinite'), JSON.stringify(mapCss.pinged));
let sawPing = false;
for (let i = 0; i < 16 && !sawPing; i++) { await wait(250); sawPing = await page.evaluate(() => !!document.querySelector('.screen[data-device="mom"] .map-layer .mk.sharer.pinged')); }
check('A-20 a ping starts a short pulse', sawPing);
let rested = false;
for (let i = 0; i < 16 && !rested; i++) { await wait(250); rested = await page.evaluate(() => { const m = document.querySelector('.screen[data-device="mom"] .map-layer .mk.sharer'); return !m.classList.contains('pinged') && getComputedStyle(m.querySelector('.disc')).animationName === 'none'; }); }
check('A-20 and then the marker rests until the next ping', rested);
// A-19: contrast, transparency and forced colors on Mom's page
const cdp = await page.context().newCDPSession(page);
const media = async (name, value) => { await cdp.send('Emulation.setEmulatedMedia', { features: [{ name, value }] }); await wait(300); };
await media('prefers-reduced-transparency', 'reduce');
const rt = await page.evaluate(() => { const g = getComputedStyle(document.querySelector('.screen[data-device="mom"] .vp .sheet')); return [g.backdropFilter, g.backgroundColor]; });
check('A-19 reduced transparency: Mom’s sheet is solid', rt[0] === 'none' && !/0\.\d+\)$/.test(rt[1]), rt.join(' '));
await media('prefers-contrast', 'more');
const pc = await page.evaluate(() => { const s = document.querySelector('.screen[data-device="mom"]'); return [getComputedStyle(s.querySelector('.vp .glassbar')).boxShadow, getComputedStyle(s.querySelector('.map-layer .mk.sharer .disc')).boxShadow, getComputedStyle(s.querySelector('.vp .glassbar')).backdropFilter]; });
check('A-19 more contrast: 2px edges on the glass and the marker keyline', /2px/.test(pc[0]) && /0px 0px 0px 2px/.test(pc[1]), pc.join(' | '));
await media('forced-colors', 'active');
const fc = await page.evaluate(() => { const s = document.querySelector('.screen[data-device="mom"]'); return [getComputedStyle(s.querySelector('.vp .sheet')).borderTopStyle, getComputedStyle(s.querySelector('.map-layer .mk.sharer .disc')).borderTopStyle, getComputedStyle(s.querySelector('.map-layer .mk.viewer .disc')).borderTopStyle]; });
check('A-19 forced colors: the sheet and markers keep borders', fc.every((x) => x !== 'none'), fc.join(' '));
await cdp.send('Emulation.setEmulatedMedia', { features: [] });
if (android) {
  // A-10: no labels in the mini map
  await click(A('[data-act="aBackToCall"]'), 900);
  const pipLbl = await page.evaluate(() => [...document.querySelectorAll('.screen[data-device="alex"] .pip .m-label')].filter((e) => getComputedStyle(e).display !== 'none').length);
  check('A-10 the mini map has no labels', pipLbl === 0, pipLbl);
}
await ctx.close();

// ---------- Large text: 150% and 200% in the app, 200% text and zoom on Mom's page ----------
for (const size of ['large', 'xl']) {
  ctx = await fresh({ text: size });
  await signup();
  await share();
  const live = await page.evaluate(() => {
    const s = document.querySelector('.screen[data-device="alex"]');
    const sheet = s.querySelector('.sheet, .a-bsheet');
    const bar = s.querySelector('.glassbar, .a-mapbar');
    const st = s.querySelector('.person .st, .person .btn.ask, .person .a-btn.ask');
    const nm = s.querySelector('.person .t1');
    return {
      cols: getComputedStyle(s.querySelector('.tiles')).gridTemplateColumns.split(' ').length,
      acts: getComputedStyle(s.querySelector('.actions, .a-actions')).flexDirection,
      overlap: Math.round(bar.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top),
      under: st.getBoundingClientRect().top >= nm.getBoundingClientRect().bottom - 1,
      scrolls: getComputedStyle(sheet).overflowY,
    };
  });
  check(`A-06 ${size}: tiles one per row, actions stacked`, live.cols === 1 && live.acts === 'column', JSON.stringify(live));
  check(`A-06 ${size}: the status sits under the name`, live.under);
  check(`A-06 ${size}: the bar never covers the sheet`, live.overlap <= 0, live.overlap);
  await page.locator(A('[data-act="askStop"]')).scrollIntoViewIfNeeded();
  check(`A-06 ${size}: Stop sharing is reachable`, await page.locator(A('[data-act="askStop"]')).isVisible() && live.scrolls === 'auto');
  await shot(`${size}-live`);
  await click(A('[data-act="openTimer"]'));
  const sheetScroll = await page.evaluate(() => { const m = document.querySelector('.screen[data-device="alex"] .modal, .screen[data-device="alex"] .a-msheet'); const cs = getComputedStyle(m); const s = document.querySelector('.screen[data-device="alex"]').getBoundingClientRect(); const r = m.getBoundingClientRect(); return { oy: cs.overflowY, fits: r.top >= s.top - 1 && r.bottom <= s.bottom + 1 }; });
  check(`A-06 ${size}: the timer sheet fits and scrolls`, sheetScroll.oy === 'auto' && sheetScroll.fits, JSON.stringify(sheetScroll));
  await page.keyboard.press('Escape');
  await wait(300);
  // Mom's page at this size
  const mom = await page.evaluate(() => {
    const s = document.querySelector('.screen[data-device="mom"]');
    const sheet = s.querySelector('.vp .sheet');
    const bar = s.querySelector('.vp .glassbar');
    const vp = s.querySelector('.vp');
    const k = s.getBoundingClientRect().width / 390;
    return { overlap: Math.round(bar.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top), oy: getComputedStyle(sheet).overflowY, vpOy: getComputedStyle(s.querySelector('.vp-body')).overflowY, tall: vp.classList.contains('tall'),
      band: Math.round((sheet.getBoundingClientRect().top - bar.getBoundingClientRect().bottom) / k), h1: s.querySelector('#vp-h1').getBoundingClientRect().bottom <= s.querySelector('.vp').getBoundingClientRect().bottom };
  });
  check(`A-05 ${size}: Mom’s glass bar never covers the sheet, and the page or sheet scrolls`, mom.overlap <= 0 && (mom.oy === 'auto' || mom.vpOy === 'auto'), JSON.stringify(mom));
  // R3-D02: at large sizes the page keeps a 160pt map band and opens with the heading in view.
  check(`R3-D02 ${size}: a map band of 160pt or more, heading in view`, mom.band >= 159 && mom.h1, JSON.stringify(mom));
  await page.locator(Mo('[data-act="askPermission"]')).first().scrollIntoViewIfNeeded();
  check(`A-05 ${size}: Share my location is reachable`, await page.locator(Mo('[data-act="askPermission"]')).first().isVisible());
  await shot(`${size}-mom`);
  await click(A('[data-act="askStop"]'));
  await click(A('[data-act="confirmStop"]'), 700);
  await page.locator(A('[data-act="done"]')).scrollIntoViewIfNeeded();
  check(`A-06 ${size}: the ended screen scrolls to Done`, await page.locator(A('[data-act="done"]')).isVisible());
  await shot(`${size}-ended`);
  await ctx.close();
}
// The browser's own text size (rem) and page zoom on Mom's page
ctx = await fresh();
await signup();
await share();
const remRatio = await page.evaluate(() => {
  const h = () => parseFloat(getComputedStyle(document.querySelector('.screen[data-device="mom"] h1')).fontSize);
  const a = h();
  document.documentElement.style.fontSize = '200%';
  const b2 = h();
  document.documentElement.style.fontSize = '';
  return b2 / a;
});
check('A-05 Mom’s page type is in rem: it doubles with the browser’s text size', Math.abs(remRatio - 2) < 0.01, remRatio.toFixed(2));
for (const mode of ['text', 'zoom']) {
  const r = await page.evaluate((m) => {
    const s = document.querySelector('.screen[data-device="mom"]');
    const ui = s.querySelector('.ui-layer');
    if (m === 'text') document.documentElement.style.fontSize = '200%'; else ui.style.zoom = '2';
    const sheet = s.querySelector('.vp .sheet');
    const bar = s.querySelector('.vp .glassbar');
    const folded = s.querySelector('.vp').classList.contains('folded');
    const vp = s.querySelector('.vp');
    const body = s.querySelector('.vp-body');
    // Either the sheet scrolls, or (large sizes) the column under the bar does.
    const scroller = getComputedStyle(body).overflowY === 'auto' ? body : sheet;
    const out = { overlap: Math.round(bar.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top), oy: getComputedStyle(scroller).overflowY, scrollable: scroller.scrollHeight > scroller.clientHeight, folded, tall: vp.classList.contains('tall') };
    // Every line of text wraps inside the sheet: nothing is wider than it.
    const sr = sheet.getBoundingClientRect();
    out.wide = [...sheet.querySelectorAll('*')].filter((e) => e.getClientRects().length && !e.closest('.sr-only') && e.getBoundingClientRect().right > sr.right + 1).map((e) => e.className || e.tagName).slice(0, 4);
    return out;
  }, mode);
  check(`A-05 200% ${mode}: the sheet or the page scrolls, nothing overlaps or runs off the side`, r.overlap <= 0 && r.oy === 'auto' && r.wide.length === 0, JSON.stringify(r));
  await wait(400);
  await page.locator('.devices').screenshot({ path: `${OUT}/${tag}-mom-200-${mode}.png` });
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; document.querySelector('.screen[data-device="mom"] .ui-layer').style.zoom = ''; });
}
await ctx.close();

// ---------- Reduced motion: no pulses ----------
ctx = await fresh({ reducedMotion: 'reduce' });
await signup();
await share();
await wait(4000);
const rm = await page.evaluate(() => [...document.querySelectorAll('.screen .map-layer .mk')].map((m) => [getComputedStyle(m.querySelector('.disc')).animationName, getComputedStyle(m.querySelector('.halo')).animationName]).flat());
check('A-20 with Reduce Motion nothing pulses', rm.every((x) => x === 'none' || x === 'mk-xfade'), rm.join(','));
await ctx.close();

await b.close();
console.log(checks.join('\n'));
console.log(errors.length ? errors.join('\n') : 'no errors');

await finish(checks, errors);
