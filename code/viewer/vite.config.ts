// Vite config for the web viewer. Not part of `npm run typecheck` (tsconfig includes src/ only), so
// the viewer needs no @types/node; Vite bundles and runs this file itself.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// code/ (the repo's code folder) and code/shared (tokens, and later the schema types).
const codeDir = fileURLToPath(new URL('..', import.meta.url));
const sharedDir = fileURLToPath(new URL('../shared', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // import '@tml/shared/tokens/generated/css/tokens.css' → code/shared/tokens/generated/css/tokens.css
      '@tml/shared': sharedDir,
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // The shared tokens live outside this package; let the dev server read them.
    fs: { allow: [codeDir] },
  },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    // Fonts and the mascot are served from public/ as-is; keep small assets as files, not data URIs.
    assetsInlineLimit: 0,
  },
});
