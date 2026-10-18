// Builds "Track Me Live — FSD.pdf" from "Track Me Live — FSD.md" with headless Chrome.
//
//   npm --prefix docs/fsd-pdf run build                 (from the project root)
//   node build.mjs [--format a4|letter] [--src file.md] [--out file.pdf] [--arch page.html] [--chrome /path/to/chrome]
//
// What it does, in order:
//   1. Parses the markdown with marked (GitHub-flavored tables).
//   2. Turns the first heading and the date line under it into the cover, and builds a contents page.
//   3. Renders the system map from architecture/track-me-live-architecture.html in the light theme,
//      inlines its computed styles so it stays vector, and puts it on a landscape page where the
//      markdown says "[embedded content: system architecture ...]".
//   4. Prints to PDF twice: the first pass finds which page each section landed on (from the PDF
//      outline), the second fills those numbers into the contents page. It repeats until they agree.
//
// Fonts (Gabarito, Figtree) load from Google Fonts, so the build needs a network connection.
// It stops with an error instead of quietly printing in fallback fonts.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Marked } from 'marked';
import { chromium } from 'playwright-core';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

// ---------------------------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------------------------

const FORMATS = {
  // A4 is the default: the original FSD PDF was A4, the spec is metric-first, and an A4 page
  // still prints on US Letter at 97% with "fit to page".
  a4: { css: 'A4', width: '210mm', height: '297mm', landscapeHeight: '210mm' },
  letter: { css: 'letter', width: '8.5in', height: '11in', landscapeHeight: '8.5in' },
};

const DEFAULT_OUT = path.join(root, 'Track Me Live — FSD.pdf');

function parseArgs(argv) {
  const opts = {
    src: path.join(root, 'Track Me Live — FSD.md'),
    out: DEFAULT_OUT,
    arch: path.join(root, 'architecture', 'track-me-live-architecture.html'),
    brand: path.join(root, 'brand', 'logo'),
    format: 'a4',
    chrome: process.env.CHROME_PATH || null,
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    const take = () => { if (val === undefined) throw new Error(`${key} needs a value`); i++; return val; };
    if (key === '--src') opts.src = path.resolve(take());
    else if (key === '--out') opts.out = path.resolve(take());
    else if (key === '--arch') opts.arch = path.resolve(take());
    else if (key === '--format') opts.format = take().toLowerCase();
    else if (key === '--letter') opts.format = 'letter';
    else if (key === '--chrome') opts.chrome = path.resolve(take());
    else if (key === '--help' || key === '-h') opts.help = true;
    else throw new Error(`Unknown option ${key}. Try --help.`);
  }
  if (!FORMATS[opts.format]) throw new Error(`--format must be a4 or letter, not "${opts.format}"`);
  return opts;
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cssString = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const fmtDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// Sentence case for the cover title only ("Functional Specification Document" -> "Functional
// specification document"); words in capitals (FSD, API) are left alone.
function sentenceCase(s) {
  return s.split(/(\s+)/).map((w, i) => {
    if (i === 0 || /^\s+$/.test(w) || /^[A-Z0-9]{2,}$/.test(w)) return w;
    return w.charAt(0).toLowerCase() + w.slice(1);
  }).join('');
}

function plainText(tokens) {
  // Plain text of inline tokens, for headings, table heuristics and matching.
  return (tokens || []).map((t) => {
    if (t.tokens) return plainText(t.tokens);
    if (t.type === 'escape') return t.text;
    return decodeEntities(t.text ?? t.raw ?? '');
  }).join('');
}

function svgInner(svgSource) {
  // Strip the outer <svg> and <title> from a brand file so it can be nested in another <svg>.
  return svgSource.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>[\s\S]*?<\/title>/, '');
}
function svgViewBox(svgSource) {
  const m = svgSource.match(/viewBox="([^"]+)"/);
  return m ? m[1] : '0 0 100 100';
}

// ---------------------------------------------------------------------------------------------
// Table column widths
// ---------------------------------------------------------------------------------------------

// Chrome's automatic table layout gives most of the width to the column with the longest
// paragraph and leaves short-label columns breaking mid-word. Instead, share the width by the
// square root of each column's amount of text, and never go below the width of the column's
// longest unbreakable word. Returns percentages.
function columnWidths(headers, columns, monoCol) {
  const TABLE_PX = 640; // roughly the A4 text width at 96 dpi; only the proportions matter
  const PAD_PX = 20; // cell padding, both sides
  const charPx = (mono) => (mono ? 6.2 : 5.7); // average advance at the table's 8.3pt
  const words = (text, mono) => text.split(mono ? /[\s/]+|(?<=,)/ : /[\s]+|(?<=-)/).filter(Boolean);
  const n = headers.length;
  const weight = [];
  const minPx = [];
  for (let i = 0; i < n; i++) {
    const cells = columns[i];
    const total = cells.reduce((s, t) => s + t.length, 0) * charPx(monoCol[i]);
    weight.push(Math.sqrt(Math.max(total, 1)));
    const longest = Math.max(
      ...cells.map((t) => Math.max(0, ...words(t, monoCol[i]).map((w) => w.length)) * charPx(monoCol[i])),
      ...words(headers[i], false).map((w) => w.length * 5.6),
    );
    minPx.push(longest + PAD_PX);
  }
  // Give every column its share, lift any column below its minimum, and spread what's left
  // over the others in proportion to their weight.
  let fixed = new Array(n).fill(false);
  let px = new Array(n).fill(0);
  for (let round = 0; round < n; round++) {
    const freePx = TABLE_PX - px.reduce((s, v, i) => s + (fixed[i] ? v : 0), 0);
    const freeWeight = weight.reduce((s, w, i) => s + (fixed[i] ? 0 : w), 0);
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (fixed[i]) continue;
      px[i] = (weight[i] / freeWeight) * freePx;
      if (px[i] < minPx[i]) { px[i] = minPx[i]; fixed[i] = true; changed = true; }
    }
    if (!changed) break;
  }
  const sum = px.reduce((s, v) => s + v, 0);
  return px.map((v) => (v / sum) * 100);
}

// ---------------------------------------------------------------------------------------------
// Markdown -> HTML
// ---------------------------------------------------------------------------------------------

const PLACEHOLDER = /^\s*(?:&#91;|\[)\s*embedded content\s*:\s*([\s\S]*?)\s*(?:\\?\]|&#93;)\s*$/i;

// "4. Functional requirements" -> "sec-4"; unnumbered sections count in order.
function sectionId(text, ordinal) {
  const m = text.match(/^(\d+)\.\s+/);
  return m ? `sec-${m[1]}` : `sec-${ordinal}`;
}

function buildBody(md, figureHtmlFor) {
  const marked = new Marked({ gfm: true });
  const tokens = marked.lexer(md);

  // 1. Title and the date line under it become the cover.
  let title = null;
  let metaLine = null;
  const idx = tokens.findIndex((t) => t.type === 'heading' && t.depth === 1);
  if (idx !== -1) {
    title = plainText(tokens[idx].tokens).trim();
    tokens.splice(idx, 1);
    let next = idx;
    while (tokens[next] && tokens[next].type === 'space') next++;
    if (tokens[next] && tokens[next].type === 'paragraph') {
      metaLine = plainText(tokens[next].tokens).trim();
      tokens.splice(idx, next - idx + 1);
    }
  }

  // 2. Embedded-content placeholders: leave a reference where the placeholder was and move the
  //    figure itself to the end of its section, so the section's prose isn't split by a page break.
  const out = [];
  let pending = [];
  const figures = [];
  let h2Count = 0;
  let currentSection = null;
  const flush = () => { for (const f of pending) out.push({ type: 'html', block: true, raw: f, text: f }); pending = []; };
  for (const t of tokens) {
    if (t.type === 'heading' && t.depth <= 2) flush();
    if (t.type === 'heading' && t.depth === 2) currentSection = sectionId(plainText(t.tokens).trim(), ++h2Count);
    const m = t.type === 'paragraph' ? t.raw.trim().match(PLACEHOLDER) : null;
    if (m) {
      const caption = decodeEntities(m[1]).replace(/\\(.)/g, '$1').trim();
      const fig = figureHtmlFor(caption, figures.length + 1);
      if (fig) {
        figures.push({ id: fig.id, caption, number: figures.length + 1, title: fig.title, sectionId: currentSection });
        out.push({ type: 'html', block: true, raw: fig.ref, text: fig.ref });
        pending.push(fig.page);
      } else {
        const missing = `<div class="embed-missing">Embedded content: ${esc(caption)}. This build has no renderer for it.</div>`;
        out.push({ type: 'html', block: true, raw: missing, text: missing });
      }
      continue;
    }
    out.push(t);
  }
  flush();
  out.links = tokens.links;

  // 3. Render with a few print-specific touches.
  const sections = [];
  const renderer = {
    heading({ tokens: inline, depth }) {
      const text = plainText(inline).trim();
      const html = this.parser.parseInline(inline);
      if (depth === 2) {
        const m = text.match(/^(\d+)\.\s+([\s\S]*)$/);
        const id = sectionId(text, sections.length + 1);
        sections.push({ id, number: m ? m[1] : '', title: m ? m[2] : text, text });
        const inner = m ? `<span class="num">${esc(m[1])}.</span> ${this.parser.parseInline(inline).replace(/^\s*\d+\.\s*/, '')}` : html;
        return `<h2 id="${id}">${inner}</h2>\n`;
      }
      return `<h${depth}>${html}</h${depth}>\n`;
    },
    table(token) {
      const headers = token.header.map((c) => plainText(c.tokens).trim());
      const cellText = (ci) => token.rows.map((r) => plainText(r[ci].tokens).trim());
      const isPath = (txt) => /^[A-Za-z]+\/\{[A-Za-z]+\}/.test(txt);
      const monoCol = headers.map((h, ci) => /^(collection|key fields|fields?|path)$/i.test(h) || (token.rows.length > 0 && cellText(ci).every(isPath)));
      const ynCol = headers.map((_, ci) => token.rows.length > 0 && cellText(ci).every((t) => /^(yes|no)$/i.test(t)));
      const widths = columnWidths(headers, headers.map((_, ci) => cellText(ci)), monoCol);
      // The first column is a label (bold) unless the table is two parallel lists of similar length.
      const avg = headers.map((_, ci) => cellText(ci).reduce((s, t) => s + t.length, 0) / Math.max(1, token.rows.length));
      const parallel = headers.length === 2 && Math.max(...avg) / Math.max(1, Math.min(...avg)) < 2;
      const cls = [`cols-${headers.length}`];
      if (token.rows.length <= 4) cls.push('short');
      if (!parallel) cls.push('keyed');
      const colgroup = `<colgroup>${widths.map((w) => `<col style="width:${w.toFixed(2)}%">`).join('')}</colgroup>`;
      const th = token.header.map((c, ci) => {
        const k = [monoCol[ci] ? 'mono' : '', ynCol[ci] ? 'yn' : ''].filter(Boolean).join(' ');
        return `<th${k ? ` class="${k}"` : ''}>${this.parser.parseInline(c.tokens)}</th>`;
      }).join('');
      const rows = token.rows.map((r) => {
        const strongRow = r.every((c) => c.tokens.length === 1 && c.tokens[0].type === 'strong');
        const tds = r.map((c, ci) => {
          const txt = plainText(c.tokens).trim();
          const k = [];
          let inner = this.parser.parseInline(c.tokens);
          if (monoCol[ci] || isPath(txt)) {
            k.push('mono');
            // Let long collection paths wrap after a slash rather than squeezing the other columns.
            if (!/[<>]/.test(inner)) inner = inner.replace(/\//g, '/<wbr>');
          }
          if (ynCol[ci]) k.push('yn');
          return `<td${k.length ? ` class="${k.join(' ')}"` : ''}>${inner}</td>`;
        }).join('');
        return `<tr${strongRow ? ' class="highlight"' : ''}>${tds}</tr>`;
      }).join('\n');
      return `<table class="${cls.join(' ')}">\n${colgroup}\n<thead><tr>${th}</tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>\n`;
    },
  };
  marked.use({ renderer });
  const html = marked.parser(out);
  return { title, metaLine, html, sections, figures };
}

// ---------------------------------------------------------------------------------------------
// The architecture diagram, as inline vector SVG
// ---------------------------------------------------------------------------------------------

async function captureArchitecture(browser, archPath) {
  const ctx = await browser.newContext({ colorScheme: 'light', viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(archPath).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    const s = document.createElement('style');
    s.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
    document.head.appendChild(s);
  });
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(() => {
    const src = document.querySelector('#system-map svg');
    if (!src) return null;
    const shapeProps = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'opacity'];
    const textProps = ['font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'font-variant-numeric'];
    const clone = src.cloneNode(true);
    const a = [src, ...src.querySelectorAll('*')];
    const b = [clone, ...clone.querySelectorAll('*')];
    a.forEach((el, i) => {
      const d = b[i];
      const tag = el.tagName.toLowerCase();
      d.removeAttribute('class');
      if (['title', 'desc', 'defs', 'marker', 'clippath', 'svg'].includes(tag)) return;
      const cs = getComputedStyle(el);
      const props = (tag === 'text' || tag === 'tspan') ? [...shapeProps, ...textProps] : shapeProps;
      d.setAttribute('style', props.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
    });
    const [, , w, h] = clone.getAttribute('viewBox').split(/\s+/).map(Number);
    clone.setAttribute('width', w);
    clone.setAttribute('height', h);
    clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    clone.setAttribute('style', 'display:block');
    return { svg: clone.outerHTML, width: w, height: h };
  });
  await ctx.close();
  if (!result) throw new Error(`No #system-map svg found in ${archPath}`);
  return result;
}

// ---------------------------------------------------------------------------------------------
// Cover, contents, about
// ---------------------------------------------------------------------------------------------

async function coverArt(brandDir) {
  const read = (f) => fs.readFile(path.join(brandDir, f), 'utf8');
  const logo = (await read('logo-horizontal-on-amber.svg'))
    .replace('<svg ', '<svg class="logo" ')
    .replace(/ width="[^"]*" height="[^"]*"/, '');
  const you = await read('mark-mono-white.svg');
  const them = await read('mark-them.svg');
  // Same composition as the brand book's hero: the white Callout speaks, the blue one answers.
  const convo = `<svg class="convo" viewBox="0 0 460 420" aria-hidden="true">
    <g fill="none" stroke="#fff">
      <circle cx="156" cy="215" r="74" stroke-opacity=".55" stroke-width="3"/>
      <circle cx="156" cy="215" r="112" stroke-opacity=".32" stroke-width="3"/>
      <circle cx="156" cy="215" r="150" stroke-opacity=".16" stroke-width="3"/>
    </g>
    <line x1="266" y1="152" x2="322" y2="121" stroke="#11181B" stroke-opacity=".55" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 9"/>
    <svg x="30" y="92" width="250" height="${(250 * 98.5 / 84.5).toFixed(1)}" viewBox="${svgViewBox(you)}">${svgInner(you)}</svg>
    <svg x="318" y="34" width="116" height="${(116 * 98.5 / 84.5).toFixed(1)}" viewBox="${svgViewBox(them)}">${svgInner(them)}</svg>
  </svg>`;
  return { logo, convo };
}

function tocHtml(sections, figures) {
  // Sections, with each figure listed under the section it belongs to.
  const rows = [];
  for (const s of sections) {
    rows.push(`<li><span class="n">${esc(s.number)}</span><span class="t">${esc(s.title)}</span><span class="p" data-page-of="${s.id}">0</span></li>`);
    for (const f of figures.filter((x) => x.sectionId === s.id)) {
      rows.push(`<li class="fig"><span class="n"></span><span class="t">Figure ${f.number}. ${esc(f.title)}, landscape</span><span class="p" data-page-of="${f.id}">0</span></li>`);
    }
  }
  return rows.join('\n    ');
}

// ---------------------------------------------------------------------------------------------
// PDF helpers
// ---------------------------------------------------------------------------------------------

async function headingPages(pdfBuffer) {
  // Returns { normalized heading text: 1-based page } from the PDF outline Chrome writes.
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBuffer), verbosity: 0 }).promise;
  const map = new Map();
  const walk = async (items) => {
    for (const item of items || []) {
      let dest = item.dest;
      if (typeof dest === 'string') dest = await doc.getDestination(dest);
      if (Array.isArray(dest) && dest[0]) {
        const index = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0]);
        const key = norm(item.title);
        if (!map.has(key)) map.set(key, index + 1);
      }
      await walk(item.items);
    }
  };
  await walk(await doc.getOutline());
  const pages = doc.numPages;
  await doc.destroy();
  return { map, pages };
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node build.mjs [--format a4|letter] [--src file.md] [--out file.pdf] [--arch page.html] [--chrome path]');
    return;
  }
  const fmt = FORMATS[opts.format];
  const [md, stat, template, css] = await Promise.all([
    fs.readFile(opts.src, 'utf8'),
    fs.stat(opts.src),
    fs.readFile(path.join(here, 'template.html'), 'utf8'),
    fs.readFile(path.join(here, 'fsd.css'), 'utf8'),
  ]);

  const browser = await chromium.launch(opts.chrome ? { executablePath: opts.chrome } : { channel: 'chrome' });
  try {
    // The system map, captured once.
    let arch = null;
    // How the PDF names the architecture page: relative to the project, or just the file name
    // when it lives outside the project (no ../../ paths on the page).
    const archRelToRoot = path.relative(root, opts.arch);
    const archRel = archRelToRoot.startsWith('..') || path.isAbsolute(archRelToRoot) ? path.basename(opts.arch) : archRelToRoot;
    const figureHtmlFor = (caption, n) => {
      if (!/architecture/i.test(caption) || !arch) return null;
      const id = `fig-${n}`;
      const title = 'System architecture';
      const sub = caption.replace(/^system architecture\s*[·:-]?\s*/i, '');
      return {
        id,
        title,
        ref: `<p class="figref"><b>Figure ${n}</b><span>${esc(caption.charAt(0).toUpperCase() + caption.slice(1))}. On page <span data-page-of="${id}">0</span>, in landscape.</span></p>`,
        page: `<section class="figure-page" id="${id}">
  <div class="figure-head"><h3>Figure ${n}. ${title}</h3>${sub ? `<p>${esc(sub)}</p>` : ''}<p class="src">From ${esc(archRel)}</p></div>
  <div class="figure-body">${arch.svg}</div>
</section>`,
      };
    };
    try {
      await fs.access(opts.arch);
      arch = await captureArchitecture(browser, opts.arch);
    } catch (err) {
      console.warn(`Warning: the architecture page could not be rendered (${err.message}). The PDF will show a placeholder.`);
    }

    const body = buildBody(md, figureHtmlFor);
    if (!body.title) throw new Error('The markdown has no "# " title.');
    const [product, ...rest] = body.title.split(/\s+[—–-]\s+/);
    const docTitle = rest.length ? sentenceCase(rest.join(' — ')) : body.title;
    const builtOn = new Date();
    const art = await coverArt(opts.brand);

    // The date line under the title ("Oct 15, 2026 · Revised Oct 18, 2026 · Prepared with @AI Team")
    // goes on the cover part by part, as written. Recognized prefixes become the label.
    const metaParts = (body.metaLine || '').split(/\s+·\s+/).filter(Boolean);
    const fromMarkdown = metaParts.map((part, i) => {
      const labelled = part.match(/^(revised|updated|prepared (?:with|by)|approved by|status:?)\s+(.+)$/i);
      if (labelled) {
        const label = labelled[1].replace(/:$/, '');
        return [label.charAt(0).toUpperCase() + label.slice(1).toLowerCase(), labelled[2]];
      }
      return [i === 0 ? 'Dated' : 'Note', part];
    });
    // Up to four columns: everything from the date line, then the build date, then (if there's
    // room) when the markdown file was last saved. The About box always has both.
    const coverItems = [...fromMarkdown, ['PDF built', fmtDate(builtOn)]];
    if (coverItems.length < 4) coverItems.splice(coverItems.length - 1, 0, ['Last edited', fmtDate(stat.mtime)]);
    const coverMeta = coverItems.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('\n      ');

    const about = [
      ['Source', `<code>${esc(path.basename(opts.src))}</code> is the source of truth. This PDF is generated from it; edit the markdown, not the PDF.`],
      ['Last edited', `${esc(fmtDate(stat.mtime))} (the markdown file)`],
      ['Built', `${esc(fmtDate(builtOn))}, ${opts.format === 'a4' ? 'A4' : 'US Letter'}`],
      ['Rebuild', '<code>npm --prefix docs/fsd-pdf run build</code> from the project root'],
      ['Figures', arch ? `Figure 1 is drawn from <code>${esc(archRel)}</code>, light theme` : 'The architecture page could not be rendered for this build'],
      ['Earlier version', 'The original PDF of October 15, 2026 is kept in <code>archive/</code>'],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('\n      ');

    const figureHeight = `calc(${fmt.landscapeHeight} - 19mm - 0.5mm)`;
    const style = css
      .replace(/__PAGE_SIZE__/g, fmt.css)
      .replace(/__PAGE_WIDTH__/g, fmt.width)
      .replace(/__PAGE_HEIGHT__/g, fmt.height)
      .replace(/__FIGURE_HEIGHT__/g, figureHeight)
      .replace(/__FOOTER_LABEL__/g, cssString(`${product} · ${docTitle}`));

    const html = template
      .replace('{{TITLE}}', esc(body.title))
      .replace('{{STYLE}}', style)
      .replace('{{COVER_LOGO}}', art.logo)
      .replace('{{COVER_CONVO}}', art.convo)
      .replace('{{DOC_TITLE}}', esc(docTitle))
      .replace('{{COVER_META}}', coverMeta)
      .replace('{{TOC}}', tocHtml(body.sections, body.figures))
      .replace('{{ABOUT}}', about)
      .replace('{{BODY}}', body.html);

    // The HTML that gets printed is kept for debugging: in docs/fsd-pdf/build/ for the default
    // output, otherwise next to the PDF with the same name (out.pdf -> out.html).
    const htmlPath = opts.out === DEFAULT_OUT
      ? path.join(here, 'build', 'fsd.html')
      : path.join(path.dirname(opts.out), `${path.basename(opts.out, path.extname(opts.out))}.html`);
    await fs.mkdir(path.dirname(htmlPath), { recursive: true });
    await fs.writeFile(htmlPath, html);

    const ctx = await browser.newContext({ colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const fontsOk = await page.evaluate(() => ['700 12px Gabarito', '500 12px Gabarito', '400 12px Figtree', '600 12px Figtree'].map((f) => document.fonts.check(f)));
    if (fontsOk.includes(false)) {
      throw new Error('Gabarito or Figtree did not load from Google Fonts. Check the network connection and run the build again.');
    }
    await page.emulateMedia({ media: 'print' });

    // Targets whose page numbers go into the contents page and the figure reference.
    const targets = await page.evaluate(() => [...document.querySelectorAll('main h2[id], .figure-page[id] h3')].map((h) => ({
      id: h.id || h.closest('[id]').id,
      text: h.textContent.replace(/\s+/g, ' ').trim(),
    })));

    const pdfOptions = { preferCSSPageSize: true, printBackground: true, outline: true, tagged: true, displayHeaderFooter: false };
    let pdf = null;
    let numbers = {};
    for (let pass = 1; pass <= 4; pass++) {
      pdf = await page.pdf(pdfOptions);
      const { map, pages } = await headingPages(pdf);
      const found = {};
      const missing = [];
      for (const t of targets) {
        const p = map.get(norm(t.text));
        if (p) found[t.id] = p; else missing.push(t.text);
      }
      if (missing.length) throw new Error(`Could not find these headings in the PDF outline: ${missing.join('; ')}`);
      const stable = targets.every((t) => numbers[t.id] === found[t.id]);
      if (stable) {
        console.log(`Pages settled after ${pass - 1} renumbering pass${pass === 2 ? '' : 'es'}. ${pages} pages.`);
        break;
      }
      if (pass === 4) throw new Error('Page numbers did not settle after 3 passes.');
      numbers = found;
      await page.evaluate((nums) => {
        for (const el of document.querySelectorAll('[data-page-of]')) el.textContent = String(nums[el.dataset.pageOf] ?? '');
      }, numbers);
    }

    await fs.writeFile(opts.out, pdf);
    await ctx.close();

    const pageCount = (await headingPages(pdf)).pages;
    const shown = (p) => (p.startsWith(root + path.sep) ? path.relative(root, p) : p);
    console.log(`Wrote ${shown(opts.out)}: ${pageCount} pages, ${opts.format === 'a4' ? 'A4' : 'US Letter'}.`);
    for (const t of targets) console.log(`  p${String(numbers[t.id]).padStart(2)}  ${t.text}`);
    console.log(`HTML used for printing: ${shown(htmlPath)}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`\nBuild failed: ${err.message}`);
  if (/Executable doesn't exist|chrome/i.test(err.message) && /launch/i.test(err.stack || '')) {
    console.error('This build drives an installed Google Chrome. Install Chrome, or pass --chrome /path/to/chrome (or set CHROME_PATH).');
  }
  process.exit(1);
});
