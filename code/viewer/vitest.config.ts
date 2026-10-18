// Unit tests: the page's pure modules (the state machine, formatting, framing, the sample source),
// in Node, with the same '@tml/shared' alias as the page. End-to-end tests: e2e/vitest.config.ts.
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts'],
      environment: 'node',
    },
  }),
);
