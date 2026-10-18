// The mascot picker: every character in every color loads its own render at full size, the
// accessory chips follow the support matrix, and the chosen tile is marked.
// node picker.mjs <out-dir> [light|dark]
import { chromium } from 'playwright-core';
import { finish } from './finish.mjs';

const OUT = process.argv[2];
const theme = process.argv[3] || 'light';
const URL = process.env.PROTO_URL || new globalThis.URL('../index.html', import.meta.url).href;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
await ctx.addInitScript(() => { try { localStorage.setItem('tml-proto-platform', 'ios'); localStorage.setItem('tml-proto-text', 'default'); } catch (e) {} });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
const A = (s) => `.screen[data-device="alex"] ${s}`;
const wait = (ms) => page.waitForTimeout(ms);
const click = async (s, after = 300) => { await page.click(s, { timeout: 4000 }); await wait(after); };

await page.goto(URL);
await wait(2200);
await click(A('[data-act="obSkip"]'));
await click(A('[data-act="sendCode"]'));
await click(A('[data-act="fillCode"]'), 1500);

const core = await page.evaluate(() => ({ sets: window.TML.core.SETS.map((s) => s.id), mascots: window.TML.core.MASCOTS, colors: window.TML.core.COLORS.map((c) => c.id), acc: window.TML.core.ACC_FOR }));
const bad = [];
const accBad = [];
for (const set of core.sets) {
  await click(A(`[data-act="pickSet"][data-id="${set}"]`));
  for (const m of core.mascots.filter((x) => x.set === set)) {
    await click(A(`[data-act="pickMascot"][data-id="${m.id}"]`));
    const chips = await page.locator(A('[data-act="pickAccessory"]')).evaluateAll((els) => els.map((e) => e.dataset.id));
    const want = core.acc[m.id].length ? ['none', ...core.acc[m.id]] : [];
    if (chips.join('|') !== want.join('|')) accBad.push(`${m.id}: ${chips.join(',')} vs ${want.join(',')}`);
    for (const c of core.colors) {
      await click(A(`[data-act="pickColor"][data-id="${c}"]`), 150);
      const r = await page.locator(A('.pick-stage img:not(.acc-layer)')).first().evaluate(async (img) => {
        if (!img.complete) await new Promise((res) => { img.onload = res; img.onerror = res; setTimeout(res, 3000); });
        return { src: img.getAttribute('src'), w: img.naturalWidth, h: img.naturalHeight, filter: getComputedStyle(img).filter };
      });
      const expect = c === 'original' ? `/Mascots/${m.id}.png` : `/Mascots/colors/${m.id}-${c}.png`;
      if (!r.src.endsWith(expect) || r.w < 256 || r.h < 256 || (r.filter && r.filter !== 'none')) bad.push(`${m.id}-${c} ${r.src} ${r.w}x${r.h} ${r.filter}`);
    }
    await page.locator(A('.pick-stage')).screenshot({ path: `${OUT}/${theme}-picker-${m.id}.png` });
  }
}
const marked = await page.locator(A('[aria-pressed="true"] .pick-check')).count();
const last = await page.locator(A('.pick-stage img:not(.acc-layer)')).first().evaluate((img) => ({ src: img.getAttribute('src'), filter: getComputedStyle(img).filter }));
await page.screenshot({ path: `${OUT}/${theme}-picker.png` });
console.log(`stage src: ${last.src} | filter: ${last.filter === 'none' ? '' : last.filter}`);
console.log(`chosen tile marked: ${marked === 1}`);
console.log(`accessory chips off the matrix: ${accBad.length ? accBad.join('; ') : 'none'}`);
console.log(`missing or wrong size: ${bad.length ? bad.join('; ') : 'none'}`);
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();

await finish([], errors);
