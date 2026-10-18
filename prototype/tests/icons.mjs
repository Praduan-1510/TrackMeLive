// The Material Symbols subset: every icon the Android screens use is in fonts/material-symbols-icons.txt,
// and every listed icon renders as one glyph (the ligature resolved), not as its name.
// node icons.mjs <out-dir>
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const OUT = process.argv[2] || '.';
const URL = process.env.PROTO_URL || new globalThis.URL('../index.html', import.meta.url).href;
const list = readFileSync(new globalThis.URL('../fonts/material-symbols-icons.txt', import.meta.url), 'utf8').trim().split(/[\s,]+/).filter(Boolean);
const src = readFileSync(new globalThis.URL('../js/android.js', import.meta.url), 'utf8');
const checks = [];
const errors = [];
const check = (name, ok, extra = '') => checks.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== '' ? ` (${extra})` : ''}`);

// 1. Icons named in the source: I('x'), IF('x') and icon: 'x'.
const named = new Set([...src.matchAll(/\bI[F]?\(\s*'([a-z0-9_]+)'/g), ...src.matchAll(/\bicon:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]));
const notListed = [...named].filter((n) => !list.includes(n));
check('every icon named in js/android.js is in the subset list', notListed.length === 0, notListed.join(', ') || `${named.size} names`);
check('the list is sorted and has no duplicates', list.join(',') === [...new Set(list)].sort().join(','));

const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('tml-proto-platform', 'android'); localStorage.setItem('tml-proto-text', 'default'); } catch (e) {} });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.goto(URL);
await page.waitForTimeout(2200);
await page.evaluate(() => document.fonts.ready);

// 2. Every listed icon renders as a single glyph about 1em wide; an unknown name would render as text.
const widths = await page.evaluate(async (names) => {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
  host.innerHTML = names.map((n) => `<span class="ms" style="font-family:'Material Symbols Rounded';font-size:24px;line-height:1;display:inline-block;white-space:nowrap" data-n="${n}">${n}</span>`).join('');
  document.body.appendChild(host);
  await document.fonts.load("24px 'Material Symbols Rounded'");
  const out = [...host.children].map((s) => [s.dataset.n, s.getBoundingClientRect().width]);
  host.remove();
  return out;
}, list);
const wide = widths.filter(([, w]) => w > 30).map(([n, w]) => `${n} ${Math.round(w)}px`);
check('every listed icon renders as one glyph', wide.length === 0, wide.join(', ') || `${widths.length} icons`);

// 3. The icons actually on Android's screens, across the main path, are all in the list.
const A = (s) => `.screen[data-device="alex"] ${s}`;
const Mo = (s) => `.screen[data-device="mom"] ${s}`;
const seen = new Set();
const collect = async () => (await page.evaluate(() => [...document.querySelectorAll('.screen .ms')].map((e) => e.textContent.trim()))).forEach((n) => seen.add(n));
const click = async (s, after = 450) => { await page.click(s, { timeout: 4000 }); await page.waitForTimeout(after); await collect(); };
await collect();
await click(A('[data-act="obNext"]'));
await click(A('[data-act="obNext"]'));
await click(A('[data-act="obNext"]'));
await click(A('[data-act="sendCode"]'));
await click(A('[data-act="fillCode"]'), 1500);
await click(A('[data-act="savePicker"]'));
await click('#ctl-call', 500);
await click(A('.a-card.call [data-act="openShare"]'));
await click(A('[data-act="locContinue"]'));
await click(A('[data-act="aLocWhile"]'));
await click(A('[data-act="aPhoneContinue"]'));
await click(A('[data-act="aPhoneAllow"]'));
await click(A('[data-act="openShareSheet"]'));
await click(A('.ss-person[data-to="Mom"]'), 600);
await click(A('[data-act="notifContinue"]'));
await click(A('[data-act="notifAllow"]'), 1800);
await click(Mo('[data-act="openLink"]'), 1000);
await click(A('[data-act="openTimer"]'));
await click(A('[data-act="closeModal"]'));
await click(A('[data-act="aBackToCall"]'), 900);
await click(A('.pip-hit'));
await click(A('[data-act="aPipExpand"]'));
await click(A('.a-statusbar .sb-hit'));
await click(A('.a-ntf.ongoing [data-act="aNotifOpen"]'));
await click('#ctl-quick');
await click('#ctl-quick');
await click(A('[data-act="askStop"]'));
await click(A('[data-act="confirmStop"]'));
await click(A('[data-act="done"]'));
await click(A('[data-act="tab"][data-tab="settings"]'));
await click(A('[data-act="aPermLoc"]'));
await click(A('[data-act="aSysBack"]'));
await click(A('[data-act="askDelete"]'));
await click(A('[data-act="cancelAlert"]'));
const onScreenMissing = [...seen].filter((n) => !list.includes(n));
check('every icon shown on the Android screens is in the list', onScreenMissing.length === 0, onScreenMissing.join(', ') || `${seen.size} icons seen`);
await page.screenshot({ path: `${OUT}/icons-android-settings.png` });
await b.close();
console.log(checks.join('\n'));
console.log(errors.length ? errors.join('\n') : 'no errors');
