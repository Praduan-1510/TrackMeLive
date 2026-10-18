// Builds every Track Me Live logo file from one geometry: marks, wordmarks, lockups, the iOS app
// icons, the Android adaptive and themed icon layers, and the Google Play icon.
// Usage: node build-logo.mjs <gabarito-600.woff> <out-dir>
// Then export the Play icon's PNG: node export-play-png.mjs <out-dir>/play-store-icon.svg <out-dir>/play-store-icon.png
// Needs opentype.js (npm i opentype.js@1.3.4). Gabarito is SIL OFL; get the woff from
// https://cdn.jsdelivr.net/npm/@fontsource/gabarito@5.1.0/files/gabarito-latin-600-normal.woff
import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';

const [fontPath, outDir] = process.argv.slice(2);
const font = opentype.loadSync(fontPath);
fs.mkdirSync(outDir, { recursive: true });

const COLOR = {
  amber: '#F2A033',
  amberOnDark: '#F7AE45',
  ring: '#FFE3BA',
  blue: '#1D6FDB',
  blueOnDark: '#5AA9FF',
  blueRing: '#CFE2FA',
  ink: '#11181B',
  inkOnDark: '#EEF2F1',
  night: '#11181B',
  white: '#FFFFFF',
};

const f = (n) => Math.round(n * 100) / 100;
const P = (p) => `${f(p[0])} ${f(p[1])}`;
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const unit = (a, b) => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };

// ---------- The Callout: a speech bubble whose tail is a map pin's point (128 grid) ----------
const C = [66, 54];
const R = 40;
const TIP = [29, 109];
const pt = (deg) => [C[0] + R * Math.cos((deg * Math.PI) / 180), C[1] - R * Math.sin((deg * Math.PI) / 180)];
const pA = pt(205); // where the tail leaves the circle, upper side
const pB = pt(250); // lower side
// Concave sides: pull each side's control point a little toward the tail's axis.
const axisPt = (p) => { const m = lerp(p, TIP, 0.5); const toC = unit(m, lerp(C, TIP, 0.55)); return [m[0] + toC[0] * 3.2, m[1] + toC[1] * 3.2]; };
const cA = axisPt(pA);
const cB = axisPt(pB);
const uA = unit(TIP, pA), uB = unit(TIP, pB);
const nearA = [TIP[0] + uA[0] * 5, TIP[1] + uA[1] * 5];
const nearB = [TIP[0] + uB[0] * 5, TIP[1] + uB[1] * 5];
const CALLOUT = `M${P(pB)} A${R} ${R} 0 1 0 ${P(pA)} Q${P(cA)} ${P(nearA)} Q${P(TIP)} ${P(nearB)} Q${P(cB)} ${P(pB)} Z`;
const SOFTEN = 3; // a hairline of matching stroke rounds every corner
const RING = { r: 21, w: 6.5 };
const DOT = { r: 10.5 };
const MARK_BOX = { x: 23.5, y: 12.5, w: 84.5, h: 98.5 };

function callout({ body, ring, dot, mono = false, id = 'c' }) {
  if (mono) {
    return `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="140">
        <rect width="200" height="140" fill="#fff"/>
        <circle cx="${C[0]}" cy="${C[1]}" r="${RING.r}" fill="none" stroke="#000" stroke-width="${RING.w}"/>
        <circle cx="${C[0]}" cy="${C[1]}" r="${DOT.r}" fill="#000"/>
      </mask></defs>
      <path d="${CALLOUT}" fill="${body}" stroke="${body}" stroke-width="${SOFTEN}" stroke-linejoin="round" mask="url(#${id})"/>`;
  }
  return `<path d="${CALLOUT}" fill="${body}" stroke="${body}" stroke-width="${SOFTEN}" stroke-linejoin="round"/>
      <circle cx="${C[0]}" cy="${C[1]}" r="${RING.r}" fill="none" stroke="${ring}" stroke-width="${RING.w}"/>
      <circle cx="${C[0]}" cy="${C[1]}" r="${DOT.r}" fill="${dot}"/>`;
}

// ---------- Wordmark: "Track Me Live" in Gabarito SemiBold, the i dotted in lamplight ----------
function wordmark(fontSize = 100, tracking = -0.012) {
  const text = 'Track Me Live';
  const parts = [];
  let tittle = null;
  let i = 0;
  const target = text.lastIndexOf('i');
  font.forEachGlyph(text, 0, 0, fontSize, { kerning: true }, (glyph, gx, gy, gs) => {
    const p = glyph.getPath(gx + i * tracking * fontSize, gy, gs);
    if (i === target) {
      const contours = [];
      let cur = [];
      for (const c of p.commands) {
        if (c.type === 'M' && cur.length) { contours.push(cur); cur = []; }
        cur.push(c);
      }
      if (cur.length) contours.push(cur);
      const bb = (cs) => {
        const ys = cs.flatMap((c) => [c.y, c.y1, c.y2].filter((v) => v !== undefined));
        const xs = cs.flatMap((c) => [c.x, c.x1, c.x2].filter((v) => v !== undefined));
        return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
      };
      contours.sort((a, b) => bb(a).minY - bb(b).minY);
      const d = bb(contours[0]);
      tittle = { cx: (d.minX + d.maxX) / 2, cy: (d.minY + d.maxY) / 2, r: (Math.max(d.maxX - d.minX, d.maxY - d.minY) / 2) * 1.06 };
      const stem = new opentype.Path();
      stem.commands = contours.slice(1).flat();
      parts.push(stem.toPathData(2));
    } else {
      parts.push(p.toPathData(2));
    }
    i++;
  });
  const box = font.getPath(text, 0, 0, fontSize, { kerning: true }).getBoundingBox();
  // The drawn i-dot is 6% larger than the font's, so it rises above the letters: the bounds
  // start at whichever is higher. glyphTop keeps the letters' own top for proportions.
  const top = Math.min(box.y1, tittle.cy - tittle.r);
  return { d: parts.join(' '), tittle, top, glyphTop: box.y1, bottom: box.y2, left: box.x1, right: box.x2 + (text.length - 1) * tracking * fontSize };
}

const WM = wordmark(100);
const wmW = WM.right - WM.left;
const wmH = WM.bottom - WM.top; // full height, i-dot included: every file's bounds use this
const wmGlyphH = WM.bottom - WM.glyphTop; // the letters alone: lockup proportions use this
const dotRise = WM.glyphTop - WM.top; // how far the i-dot rises above the letters

const wordmarkGroup = (ink, dot, x, y) => `<g transform="translate(${f(x - WM.left)} ${f(y - WM.top)})">
    <path d="${WM.d}" fill="${ink}"/>
    <circle cx="${f(WM.tittle.cx)}" cy="${f(WM.tittle.cy)}" r="${f(WM.tittle.r)}" fill="${dot}"/>
  </g>`;

const svg = (w, h, body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(w)} ${f(h)}" width="${f(w)}" height="${f(h)}" role="img" aria-label="${title}">\n<title>${title}</title>\n${body}\n</svg>\n`;
const write = (name, content) => fs.writeFileSync(path.join(outDir, name), content);
const place = (s, x, y) => `translate(${f(x)} ${f(y)}) scale(${f(s)}) translate(${-MARK_BOX.x} ${-MARK_BOX.y})`;

const LIGHT = { body: COLOR.amber, ring: COLOR.ring, dot: COLOR.white, ink: COLOR.ink, tittle: COLOR.amber };
const DARK = { body: COLOR.amberOnDark, ring: COLOR.ring, dot: COLOR.white, ink: COLOR.inkOnDark, tittle: COLOR.amberOnDark };

// Marks
const markFile = (opts, id) => svg(MARK_BOX.w, MARK_BOX.h, `<g transform="${place(1, 0, 0)}">${callout({ ...opts, id })}</g>`, 'Track Me Live');
write('mark.svg', markFile(LIGHT, 'm1'));
write('mark-on-dark.svg', markFile(DARK, 'm2'));
write('mark-mono-ink.svg', markFile({ body: COLOR.ink, mono: true }, 'm3'));
write('mark-mono-white.svg', markFile({ body: COLOR.white, mono: true }, 'm4'));

// Wordmarks
write('wordmark.svg', svg(wmW, wmH, wordmarkGroup(COLOR.ink, COLOR.amber, 0, 0), 'Track Me Live'));
write('wordmark-on-dark.svg', svg(wmW, wmH, wordmarkGroup(COLOR.inkOnDark, COLOR.amberOnDark, 0, 0), 'Track Me Live'));

// On the brand's amber: a white callout with the ring and dot cut out, ink type, a white i-dot.
const ON_AMBER = { body: COLOR.white, mono: true, ink: COLOR.ink, tittle: COLOR.white };
write('wordmark-on-amber.svg', svg(wmW, wmH, wordmarkGroup(COLOR.ink, COLOR.white, 0, 0), 'Track Me Live'));

// Horizontal lockup: the bubble's centre sits on the wordmark's vertical centre.
function lockupH(t, id) {
  const mh = wmGlyphH * 1.62;
  const s = mh / MARK_BOX.h;
  const mw = MARK_BOX.w * s;
  const gap = mh * 0.24;
  const bubbleCY = (C[1] - MARK_BOX.y) * s;
  const wy = bubbleCY - wmGlyphH / 2 - dotRise; // the wordmark's top, i-dot included
  const top = Math.min(0, wy);
  const H = Math.max(mh, wy + wmH) - top;
  return svg(mw + gap + wmW, H,
    `<g transform="${place(s, 0, -top)}">${callout({ ...t, id })}</g>\n${wordmarkGroup(t.ink, t.tittle, mw + gap, wy - top)}`, 'Track Me Live');
}
write('logo-horizontal.svg', lockupH(LIGHT, 'h1'));
write('logo-horizontal-on-dark.svg', lockupH(DARK, 'h2'));
write('logo-horizontal-on-amber.svg', lockupH(ON_AMBER, 'h3'));

// Stacked lockup
function lockupV(t, id) {
  const mh = wmGlyphH * 2.6;
  const s = mh / MARK_BOX.h;
  const mw = MARK_BOX.w * s;
  const gap = wmGlyphH * 0.42; // from the mark to the letters; the i-dot rises into it
  const W = Math.max(wmW, mw);
  return svg(W, mh + gap + wmGlyphH,
    `<g transform="${place(s, (W - mw) / 2 + mw * 0.06, 0)}">${callout({ ...t, id })}</g>\n${wordmarkGroup(t.ink, t.tittle, (W - wmW) / 2, mh + gap - dotRise)}`, 'Track Me Live');
}
write('logo-stacked.svg', lockupV(LIGHT, 'v1'));
write('logo-stacked-on-dark.svg', lockupV(DARK, 'v2'));

// Live Together mark: two callouts in conversation, amber for you, blue for them.
function together(dark) {
  const amber = dark ? COLOR.amberOnDark : COLOR.amber;
  const blue = dark ? COLOR.blueOnDark : COLOR.blue;
  const s2 = 0.8;
  const c2 = [123, 44];
  const blueT = `translate(${c2[0]} ${c2[1]}) scale(${-s2} ${s2}) translate(${-C[0]} ${-C[1]})`;
  const W = 160, H = 124;
  return svg(W, H, `<g transform="translate(-14 -2)">
    <defs><mask id="lt${dark ? 'd' : 'l'}" maskUnits="userSpaceOnUse" x="-20" y="-20" width="220" height="180"><rect x="-20" y="-20" width="220" height="180" fill="#fff"/><path d="${CALLOUT}" fill="#000" stroke="#000" stroke-width="12" stroke-linejoin="round"/></mask></defs>
    <g mask="url(#lt${dark ? 'd' : 'l'})"><g transform="${blueT}">
      <path d="${CALLOUT}" fill="${blue}" stroke="${blue}" stroke-width="${SOFTEN}" stroke-linejoin="round"/>
      <circle cx="${C[0]}" cy="${C[1]}" r="${RING.r}" fill="none" stroke="${COLOR.blueRing}" stroke-width="${RING.w}"/>
      <circle cx="${C[0]}" cy="${C[1]}" r="${DOT.r}" fill="#fff"/>
    </g></g>
    ${callout({ body: amber, ring: COLOR.ring, dot: COLOR.white })}
  </g>`, 'Live Together');
}
// The "them" callout on its own: blue, facing right. Only ever used beside the amber one.
write('mark-them.svg', svg(MARK_BOX.w, MARK_BOX.h, `<g transform="translate(${MARK_BOX.w} 0) scale(-1 1) ${place(1, 0, 0)}">
  <path d="${CALLOUT}" fill="${COLOR.blue}" stroke="${COLOR.blue}" stroke-width="${SOFTEN}" stroke-linejoin="round"/>
  <circle cx="${C[0]}" cy="${C[1]}" r="${RING.r}" fill="none" stroke="${COLOR.blueRing}" stroke-width="${RING.w}"/>
  <circle cx="${C[0]}" cy="${C[1]}" r="${DOT.r}" fill="#fff"/></g>`, 'Them'));
write('live-together.svg', together(false));
write('live-together-on-dark.svg', together(true));

// App icons, 1024 full bleed. The system applies the corner mask and Liquid Glass.
// ICON is the one icon geometry: on a 1024 square the Callout is drawn at 5.6x with the bubble's
// centre at (548, 470), a little right and up so the mark with its tail sits optically centred.
// The Android icons reuse it, scaled to their own visible area.
const ICON = { size: 1024, scale: 5.6, cx: 548, cy: 470 };
const ICON_MARK = { body: COLOR.white, ring: '#F8D29A', dot: COLOR.amber };
// Four decimals here: on a 108dp canvas, place()'s two would shift the mark visibly.
const f4 = (n) => Math.round(n * 1e4) / 1e4;
function iconPlace(visible, ox = 0, oy = 0) {
  const k = visible / ICON.size;
  const s = ICON.scale * k;
  const x = ox + ICON.cx * k - (C[0] - MARK_BOX.x) * s;
  const y = oy + ICON.cy * k - (C[1] - MARK_BOX.y) * s;
  return `translate(${f4(x)} ${f4(y)}) scale(${f4(s)}) translate(${-MARK_BOX.x} ${-MARK_BOX.y})`;
}
function appIcon(variant) {
  const bg = { default: COLOR.amber, dark: COLOR.night, tinted: '#000000' }[variant];
  const s = ICON.scale;
  const tx = ICON.cx - (C[0] - MARK_BOX.x) * s;
  const ty = ICON.cy - (C[1] - MARK_BOX.y) * s;
  const mark = {
    default: callout(ICON_MARK),
    dark: callout({ body: COLOR.amberOnDark, ring: COLOR.ring, dot: COLOR.white }),
    tinted: callout({ body: COLOR.white, mono: true, id: 'tint' }),
  }[variant];
  return svg(1024, 1024, `<rect width="1024" height="1024" fill="${bg}"/>\n<g transform="${place(s, tx, ty)}">${mark}</g>`, 'Track Me Live app icon');
}
write('app-icon-default.svg', appIcon('default'));
write('app-icon-dark.svg', appIcon('dark'));
write('app-icon-tinted.svg', appIcon('tinted'));

// Android adaptive icon: two 108dp layers. Android masks them to a 72dp visible area (circle,
// squircle or rounded square, set by the device) and guarantees a centred 66dp circle. The mark
// keeps the iOS icon's proportions inside the 72dp area, so it lands well inside the 66dp circle
// (its farthest point is about 22dp from the centre).
const ADAPTIVE = { canvas: 108, visible: 72, safe: 66 };
const adaptiveMark = () => iconPlace(ADAPTIVE.visible, (ADAPTIVE.canvas - ADAPTIVE.visible) / 2, (ADAPTIVE.canvas - ADAPTIVE.visible) / 2);
// One-ink Callout without SVG masks, so Android Studio's Vector Asset import keeps the cut-outs:
// the softening stroke runs only along the outline, and an even-odd fill punches out the ring
// (r 17.75 to 24.25) and the dot (r 10.5). Same shape as the masked mono marks.
const circlePath = (r) => `M${f(C[0] - r)} ${C[1]} a${r} ${r} 0 1 0 ${f(2 * r)} 0 a${r} ${r} 0 1 0 ${f(-2 * r)} 0 Z`;
const calloutCutout = (ink) => `<path d="${CALLOUT}" fill="none" stroke="${ink}" stroke-width="${SOFTEN}" stroke-linejoin="round"/>
      <path d="${CALLOUT} ${circlePath(RING.r + RING.w / 2)} ${circlePath(RING.r - RING.w / 2)} ${circlePath(DOT.r)}" fill="${ink}" fill-rule="evenodd"/>`;
const A108 = ADAPTIVE.canvas;
write('android-icon-background.svg', svg(A108, A108, `<rect width="${A108}" height="${A108}" fill="${COLOR.amber}"/>`, 'Track Me Live adaptive icon, background layer'));
write('android-icon-foreground.svg', svg(A108, A108, `<g transform="${adaptiveMark()}">${callout(ICON_MARK)}</g>`, 'Track Me Live adaptive icon, foreground layer'));
// Themed icon (Android 13+): Android uses only the shape and tints it, so it's drawn in one ink.
write('android-icon-monochrome.svg', svg(A108, A108, `<g transform="${adaptiveMark()}">${calloutCutout(COLOR.ink)}</g>`, 'Track Me Live themed icon, monochrome layer'));
// Google Play: 512 square, full bleed, no shadow or corners; Play applies its own mask.
write('play-store-icon.svg', svg(512, 512, `<rect width="512" height="512" fill="${COLOR.amber}"/>\n<g transform="${iconPlace(512)}">${callout(ICON_MARK)}</g>`, 'Track Me Live Google Play icon'));
// play-store-icon.png (512 by 512) is exported from the SVG by export-play-png.mjs.

// Favicon
write('favicon.svg', svg(128, 128, `<g transform="${place(1.15, (128 - MARK_BOX.w * 1.15) / 2, (128 - MARK_BOX.h * 1.15) / 2)}">${callout({ ...LIGHT })}</g>`, 'Track Me Live'));

console.log('wordmark', f(wmW), 'x', f(wmH), 'tittle', WM.tittle);
console.log(fs.readdirSync(outDir).join(', '));
