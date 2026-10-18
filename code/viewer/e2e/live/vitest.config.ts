// The live end-to-end tests: the page built for an emulator set, against real sessions there, in the
// system's Google Chrome. Run under the emulator wrapper:
//   code/backend/scripts/with-test-emulators.sh npm --prefix code/viewer run test:e2e:live
// Without it, global setup fails, naming the variables it needs.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    include: ['e2e/live/**/*.live.ts'],
    globalSetup: ['e2e/live/global-setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    pool: 'forks',
    maxWorkers: 2,
  },
});
