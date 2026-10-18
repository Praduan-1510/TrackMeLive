// Builds the page into its own temporary folder and serves it for the end-to-end tests, on a free
// port near 4179. Nothing is shared with `npm run build` (dist/) or another test run, so a build or a
// test run elsewhere on the machine can never change the page under test mid-run.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    baseURL: string;
  }
}

const root = fileURLToPath(new URL('..', import.meta.url));
const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url));

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const outDir = await mkdtemp(join(tmpdir(), 'tml-viewer-e2e-'));
  // A production build, as shipped: Vitest runs with NODE_ENV=test, which would make it a dev build.
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await build({ root, configFile, mode: 'production', logLevel: 'warn', build: { outDir, emptyOutDir: true } });
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }
  const server = await preview({
    root,
    configFile,
    logLevel: 'warn',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 4179, strictPort: false, open: false },
  });
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('vite preview did not report a URL');
  project.provide('baseURL', url.replace(/\/$/, ''));
  return async () => {
    await server.close();
    await rm(outDir, { recursive: true, force: true });
  };
}
