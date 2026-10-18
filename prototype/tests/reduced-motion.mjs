// Reduce Motion: nothing bobs, breathes or slides in; markers cross-fade to a new position.
// node reduced-motion.mjs
import { chromium } from 'playwright-core';

const URL = process.env.PROTO_URL || new globalThis.URL('../index.html', import.meta.url).href;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const A = (s) => `.screen[data-device="alex"] ${s}`;
const Mo = (s) => `.screen[data-device="mom"] ${s}`;
for (const platform of ['ios', 'android']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await ctx.addInitScript((p) => { try { localStorage.setItem('tml-proto-platform', p); localStorage.setItem('tml-proto-text', 'default'); } catch (e) {} }, platform);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${platform} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${platform} console: ${m.text()}`); });
  const click = async (s, after = 450) => { await page.click(s, { timeout: 4000 }); await page.waitForTimeout(after); };
  await page.goto(URL);
  await page.waitForTimeout(2200);
  await click(A('[data-act="obSkip"]'));
  await click(A('[data-act="sendCode"]'));
  await click(A('[data-act="fillCode"]'), 1500);
  await click(A('[data-act="savePicker"]'));
  const heroAnim = await page.locator(A('.hero-card .art img')).first().evaluate((e) => getComputedStyle(e).animationName);
  await click('#ctl-call', 500);
  await click(A(platform === 'android' ? '.a-card.call [data-act="openShare"]' : '.callcard [data-act="openShare"]'));
  await click(A('[data-act="locContinue"]'));
  if (platform === 'android') { await click(A('[data-act="aLocWhile"]')); await click(A('[data-act="aPhoneContinue"]')); await click(A('[data-act="aPhoneAllow"]')); } else await click(A('[data-act="locAllow"]'));
  await click(A('[data-act="openShareSheet"]'));
  await click(A(platform === 'android' ? '.ss-person[data-to="Mom"]' : '.contact[data-to="Mom"]'), 1700);
  await click(A('[data-act="notifLater"]'));
  await click(Mo('[data-act="openLink"]'), 1000);
  // Sample across a ping: the pulse classes may come and go, but nothing may animate.
  const samples = [];
  for (let i = 0; i < 10; i++) {
    samples.push(await page.evaluate(() => {
      const cs = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e) : null; };
      const disc = cs('.screen[data-device="alex"] .map-layer .mk.sharer .disc');
      const halo = cs('.screen[data-device="alex"] .map-layer .mk.sharer .halo');
      const dot = cs('.screen[data-device="alex"] .badge.live i');
      return { bob: disc.animationName, halo: halo.animationName, live: dot ? dot.animationName : 'none', glide: cs('.screen[data-device="alex"] .map-layer .mk.sharer').transitionDuration, pan: cs('.screen[data-device="mom"] .map-pan').transitionDuration };
    }));
    await page.waitForTimeout(400);
  }
  const worst = (k) => samples.map((x) => x[k]).find((v) => v !== 'none' && v !== '0s') || samples[0][k];
  let faded = false;
  for (let i = 0; i < 12 && !faded; i++) { await page.waitForTimeout(400); faded = await page.locator(A('.map-layer .mk.sharer.xfade')).count() > 0; }
  console.log(platform, 'home bob:', heroAnim, '| marker bob:', worst('bob'), '| halo:', worst('halo'), '| live dot:', worst('live'), '| glide:', worst('glide'), '| map pan:', worst('pan'), '| cross-fade on ping:', faded);
  await ctx.close();
}
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
