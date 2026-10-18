// Builds the page for the emulator set the wrapper names (code/backend/scripts/with-test-emulators.sh)
// and serves it, like e2e/global-setup.ts does for the sample. A build in 'emulator' mode: minified as
// shipped, but wired to the emulators, which a production build never is. The VITE_TML_* values come
// from viteEnvForEmulators, the same helper QA's runs use; without the wrapper's variables it throws
// before anything is built, so this suite never runs half set up. The Maps key is a stand-in: the
// tests serve their own Maps API script (live/maps-stub.ts), so nothing leaves the machine.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import type { TestProject } from 'vitest/node';
import { viteEnvForEmulators } from '../../src/session/firebase/config';

const root = fileURLToPath(new URL('../..', import.meta.url));
const configFile = fileURLToPath(new URL('../../vite.config.ts', import.meta.url));

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const env = { ...viteEnvForEmulators(process.env), VITE_MAPS_API_KEY: 'e2e-stand-in-key' };
  Object.assign(process.env, env);
  const outDir = await mkdtemp(join(tmpdir(), 'tml-viewer-live-e2e-'));
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await build({ root, configFile, mode: 'emulator', logLevel: 'warn', build: { outDir, emptyOutDir: true } });
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }
  const server = await preview({
    root,
    configFile,
    mode: 'emulator',
    logLevel: 'warn',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 4189, strictPort: false, open: false },
  });
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('vite preview did not report a URL');
  // Loaded only now: it reads the emulator set from the environment, checked above.
  const { warmUp } = await import('./emulators');
  await warmUp();
  project.provide('baseURL', url.replace(/\/$/, ''));
  return async () => {
    await server.close();
    await rm(outDir, { recursive: true, force: true });
  };
}
