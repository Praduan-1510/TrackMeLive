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
  // A Maps key in .env.local stays out of it (Vite never lets a .env file override the environment),
  // so the build under test is the same on every machine and never carries a real key.
  const saved = { NODE_ENV: process.env.NODE_ENV, VITE_MAPS_API_KEY: process.env.VITE_MAPS_API_KEY };
  process.env.NODE_ENV = 'production';
  process.env.VITE_MAPS_API_KEY = '';
  try {
    await build({ root, configFile, mode: 'production', logLevel: 'warn', build: { outDir, emptyOutDir: true } });
  } finally {
    if (saved.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved.NODE_ENV;
    if (saved.VITE_MAPS_API_KEY === undefined) delete process.env.VITE_MAPS_API_KEY;
    else process.env.VITE_MAPS_API_KEY = saved.VITE_MAPS_API_KEY;
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
