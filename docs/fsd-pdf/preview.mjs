// Renders pages of a PDF to PNG so the layout can be checked without a PDF viewer.
//
//   node preview.mjs                          all pages of the FSD PDF into ./preview
//   node preview.mjs --pages 1,4-6            only those pages
//   node preview.mjs --scale 2 --out <dir>    resolution (1 = 72 dpi) and output folder
//   node preview.mjs --pdf <file.pdf>         any other PDF
//
// Uses pdf.js with its optional native canvas (@napi-rs/canvas), so no browser is needed.
// One known gap: that canvas doesn't draw SVG soft masks, so the Callout logos on the cover
// render without their ring-and-dot cutout here. The PDF itself is correct; check the cover in
// Preview, Acrobat or Chrome (or `qlmanage -t -s 1100 "Track Me Live — FSD.pdf"` on macOS).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const args = { pdf: path.resolve(here, '../../Track Me Live — FSD.pdf'), out: path.join(here, 'preview'), scale: 1.5, pages: null };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === '--pdf') { args.pdf = path.resolve(val); i++; }
    else if (key === '--out') { args.out = path.resolve(val); i++; }
    else if (key === '--scale') { args.scale = Number(val); i++; }
    else if (key === '--pages') { args.pages = val; i++; }
    else if (key === '--help' || key === '-h') { args.help = true; }
    else throw new Error(`Unknown option ${key}. Try --help.`);
  }
  return args;
}

function pageList(spec, count) {
  if (!spec) return Array.from({ length: count }, (_, i) => i + 1);
  const set = new Set();
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map((n) => (n === '' ? NaN : Number(n)));
    const from = a;
    const to = part.includes('-') ? (Number.isNaN(b) ? count : b) : a;
    for (let n = from; n <= to; n++) if (n >= 1 && n <= count) set.add(n);
  }
  return [...set].sort((x, y) => x - y);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('Usage: node preview.mjs [--pdf file.pdf] [--out dir] [--scale 1.5] [--pages 1,3-5]');
  process.exit(0);
}

const data = new Uint8Array(await fs.readFile(args.pdf));
const standardFontDataUrl = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;
const doc = await pdfjs.getDocument({ data, standardFontDataUrl, disableFontFace: true, verbosity: 0 }).promise;
await fs.mkdir(args.out, { recursive: true });

const base = path.basename(args.pdf, '.pdf').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-');
const wanted = pageList(args.pages, doc.numPages);
for (const n of wanted) {
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale: args.scale });
  const canvasAndContext = doc.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const { canvas, context } = canvasAndContext;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  const file = path.join(args.out, `${base}-p${String(n).padStart(2, '0')}.png`);
  await fs.writeFile(file, canvas.toBuffer('image/png'));
  console.log(file);
  page.cleanup();
}
console.log(`${wanted.length} of ${doc.numPages} pages rendered at scale ${args.scale}.`);
await doc.destroy();
