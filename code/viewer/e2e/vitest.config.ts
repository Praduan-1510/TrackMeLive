// End-to-end tests: the built page (built and served by e2e/global-setup.ts, isolated from dist/), driven in the
// system's Google Chrome through playwright-core, checked with axe-core. Screenshots of every state go
// to test-results/screenshots/. Run with `npm run test:e2e`.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  test: {
    include: ['e2e/**/*.e2e.ts'],
    globalSetup: ['e2e/global-setup.ts'],
    testTimeout: 90_000,
    hookTimeout: 120_000,
    pool: 'forks',
    // Each file runs its own Chrome; keep the machine responsive.
    maxWorkers: 2,
  },
});
