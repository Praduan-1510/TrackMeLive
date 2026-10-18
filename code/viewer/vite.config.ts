// Vite config for the web viewer. Type-checked by tsconfig.node.json (Node types); the page itself
// by tsconfig.app.json.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// code/ (the repo's code folder) and code/shared (tokens and the schema types).
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
    // The shared tokens and schema live outside this package; let the dev server read them.
    fs: { allow: [codeDir] },
  },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    // Fonts, logos and the mascot are served from public/ as-is; keep small assets as files, not data URIs.
    assetsInlineLimit: 0,
  },
});
