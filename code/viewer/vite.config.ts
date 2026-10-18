// Vite config for the web viewer. Type-checked by tsconfig.node.json (Node types); the page itself
// by tsconfig.app.json.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// code/ (the repo's code folder) and code/shared (tokens and the schema types).
const codeDir = fileURLToPath(new URL('..', import.meta.url));
const sharedDir = fileURLToPath(new URL('../shared', import.meta.url));
// Firestore imports re2js only for client-side Pipelines regexes, which the page never runs.
const re2jsStub = fileURLToPath(new URL('src/session/firebase/re2js-stub.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // import '@tml/shared/tokens/generated/css/tokens.css' → code/shared/tokens/generated/css/tokens.css
      '@tml/shared': sharedDir,
      re2js: re2jsStub,
    },
  },
  // The Firebase SDK is imported only on a share link; bundle it when the dev server starts, so the
  // first share link opened doesn't make the server re-optimize and reload the page mid-session.
  optimizeDeps: { include: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/functions'] },
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
