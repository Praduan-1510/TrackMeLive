// Exports the Google Play icon as the 512 by 512, 32-bit PNG (with alpha) that Play Console asks for.
// Usage: node export-play-png.mjs <play-store-icon.svg> <play-store-icon.png>
// Needs playwright-core (npm i playwright-core) and Google Chrome. Chrome draws the SVG onto a
// 512px canvas, so the file is the SVG exactly, in RGBA.
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const [src, out] = process.argv.slice(2);
const SIZE = 512;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const dataUrl = await page.evaluate(async ({ svg, size }) => {
  const img = new Image();
  img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d').drawImage(img, 0, 0, size, size);
  return canvas.toDataURL('image/png');
}, { svg: fs.readFileSync(src, 'utf8'), size: SIZE });
fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
await browser.close();
