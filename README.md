# Track Me Live

Share where you are, the moment you're on the phone.

| Folder | What's in it | Start here |
| --- | --- | --- |
| `Track Me Live — FSD.md` | The functional spec, the source of truth. The PDF next to it is built from it; never edit the PDF. | |
| `docs/` | `fsd-pdf/`: the tool that builds the branded FSD PDF | `docs/fsd-pdf/README.md` |
| `archive/` | The user's original FSD PDF, kept for reference | |
| `brand/` | The Callout logo, the Gabarito wordmark, app icons and the brand book | Open `brand/index.html` |
| `prototype/` | Click-through prototype, the screen reference for v1: Alex's app (iPhone or Android) and Mom's browser page, in sync | Open `prototype/index.html` |
| `design-system/` | Tokens, color, type and platform rules, component guidelines, and the mascot renders, color versions and accessory layers. Its component previews are cards for the published design system; opened from the repo, their images don't load | `design-system/README.md` |
| `architecture/` | The system diagram | Open `architecture/track-me-live-architecture.html` |
| `wireframes/` | Source of the design canvas: low-fidelity wireframes and the Live Together screens. The files need the canvas runtime (`support.js`); opened directly in Chrome they still render | [Design canvas](https://claude.ai/artifact/RstT3mJVnCgCLcYhPqM3aa) |
| `mascots/` | The three.js models for all twelve mascots (Classics in `mascots.mjs`, Anime and Movie night in `cast.mjs`, accessories in `accessories.mjs`) and the tool that renders them to PNG | `mascots/README.md` |

## Rebuilding generated files

- **FSD PDF.** After editing the FSD, run `npm --prefix docs/fsd-pdf run build` (one-time `npm ci --prefix docs/fsd-pdf` first). It needs Google Chrome and a network connection for the fonts.
- **Tokens.** Edit `design-system/tokens.json`, then run `node design-system/tools/build-tokens.mjs` to regenerate `design-system/tokens.css`. The brand book and the prototype both read that file.
- **Logo.** Edit the geometry in `brand/tools/build-logo.mjs`, then run `node brand/tools/build-logo.mjs <gabarito-600.woff> brand/logo`. It needs `npm i opentype.js@1.3.4` and Gabarito SemiBold (SIL OFL) from `https://cdn.jsdelivr.net/npm/@fontsource/gabarito@5.1.0/files/gabarito-latin-600-normal.woff`. Then export the Play Store PNG with `node brand/tools/export-play-png.mjs brand/logo/play-store-icon.svg brand/logo/play-store-icon.png`.
- **Mascot renders.** Serve `mascots/model/` on port 8765 (`python3 -m http.server 8765`), then run `python3 mascots/render_mascots.py <out-dir>` for all twelve, or name jobs (`hero agent:dusk fox@glasses/layer`); `mascots/README.md` has the full syntax. It drives the macOS Google Chrome app headless and loads three.js from jsDelivr, so it needs a network connection. Open `http://127.0.0.1:8765/sheet.html?m=hero,star&c=original,rose` to compare several side by side. After a model change, also run `node design-system/tools/build-mascot-preview.mjs` to refresh the design system's live 3D card.
