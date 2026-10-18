# FSD PDF

Turns `Track Me Live — FSD.md` into the branded `Track Me Live — FSD.pdf` at the project root, using headless Chrome. The markdown is the source of truth: edit it, then rebuild. Never edit the PDF.

## Build

One-time setup, from the project root:

```sh
npm ci --prefix docs/fsd-pdf
```

Then, every time the FSD changes:

```sh
npm --prefix docs/fsd-pdf run build
```

It takes under 10 seconds and prints the page count and the page of every section. It needs:

- **Node 20 or later.**
- **Google Chrome**, installed normally. The build drives it through `playwright-core` and downloads no browser of its own. To use another Chrome or Chromium, pass `--chrome /path/to/chrome` or set `CHROME_PATH`.
- **A network connection.** Gabarito and Figtree load from Google Fonts. If they don't load, the build stops instead of printing in fallback fonts.

### Options

Run `node docs/fsd-pdf/build.mjs` directly to pass options:

| Option | Default | |
| --- | --- | --- |
| `--format a4` or `--format letter` | `a4` | Paper size. `--letter` is a shortcut. |
| `--src <file.md>` | `Track Me Live — FSD.md` | The markdown to build from. |
| `--out <file.pdf>` | `Track Me Live — FSD.pdf` | Where to write the PDF. The HTML that was printed is saved next to it with the same name (`out.pdf` → `out.html`). |
| `--arch <page.html>` | `architecture/track-me-live-architecture.html` | The page Figure 1 is drawn from. The PDF names it by its project path, or by file name alone if it's outside the project. |
| `--chrome <path>` | installed Google Chrome | Another Chrome or Chromium. |

## Why A4

The original FSD PDF (now in `archive/`) was A4, and the spec and design system are metric-first. An A4 page also prints on US Letter at 97% with "fit to page", so one file works in both places. Use `--format letter` if a team needs native Letter pages.

## What the build does

1. Parses the markdown with `marked` (GitHub-flavored, so the tables work).
2. Turns the `# ` title and the date line under it into the cover. The cover uses the brand files in `brand/logo/` as they are, so a logo change shows up on the next build.
3. Builds a contents page from the `## ` sections, with page numbers.
4. Finds the line `[embedded content: system architecture …]`. It opens `architecture/track-me-live-architecture.html` in Chrome in the light theme and copies the `#system-map` diagram as vector SVG with its styles inlined. The diagram goes on its own landscape page at the end of that section, and a short reference stays where the placeholder was. Any other `[embedded content: …]` line becomes a dashed placeholder box.
5. Prints twice. The first pass reads where each section landed from the PDF outline, and the second fills those numbers into the contents page. It checks that they agree and repeats if they don't.

### Layout rules it follows

- Gabarito for titles and numbers, Figtree for text, the system monospace (SF Mono or Menlo, Consolas on Windows) for field names and paths, as in the brand book.
- Lamplight amber only on the cover, the section numbers and the one highlighted table row. Everything else is ink on white.
- Tables repeat their header row on every page and never split a row. A table that breaks keeps at least three rows before the break and two after it, and tables of four rows or fewer stay on one page. Column widths come from how much text each column holds, never narrower than its longest word. Collection paths wrap after a `/`.
- A section heading always stays with what follows it. Paragraphs keep at least three lines on each side of a page break.
- A running footer with the document name and "Page N of M" on every page except the cover. Chrome's CSS page margin boxes draw it, so it uses the brand font.
- The PDF has a bookmark for every section and for Figure 1, and is tagged for screen readers. The cover title isn't a heading, so it doesn't appear as a bookmark; the document title is in the PDF's properties.

## Files

| File | What it does |
| --- | --- |
| `build.mjs` | The build: markdown, cover, contents, Figure 1, the two print passes |
| `template.html` | The page skeleton: cover, contents page, body |
| `fsd.css` | The print stylesheet: page sizes, footer, type, tables |
| `preview.mjs` | Renders PDF pages to PNG for checking the layout |
| `build/fsd.html` | The HTML that was printed for the default output, kept for debugging. With `--out`, it goes next to that PDF instead. Generated. |

## Checking the layout

```sh
npm --prefix docs/fsd-pdf run preview -- --pages 1-4 --scale 2 --out /tmp/fsd-preview
```

This writes one PNG per page, with no browser needed. It uses pdf.js, whose canvas doesn't draw SVG masks, so the Callout logos on the cover look solid there. The PDF itself is correct; check the cover in Preview, Acrobat or Chrome.

When you change the FSD, look at least at: the cover, the contents page (are the page numbers right?), the functional requirements table, the Figure 1 page and the last page.

## If something goes wrong

- **"Gabarito or Figtree did not load"**: no network, or Google Fonts is blocked. Run the build again when you're online.
- **"Could not find these headings in the PDF outline"**: a `## ` heading contains something the outline drops, such as an image. Keep headings to plain text.
- **Figure 1 is a dashed box**: the architecture page is missing or no longer has an element with `id="system-map"` containing an `<svg>`. Keep that id on the diagram's `<figure>`.
- **Chrome won't launch**: install Google Chrome, or pass `--chrome /path/to/chrome`.
