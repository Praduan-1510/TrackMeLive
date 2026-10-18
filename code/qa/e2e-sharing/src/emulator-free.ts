/**
 * Run by npm run test:android before it takes the emulator lock: refuses, naming the holder, when
 * someone else holds it, instead of waiting behind them.
 */

import { assertEmulatorFree } from './android.ts';

try {
  assertEmulatorFree();
} catch (e) {
  process.stderr.write(`test:android: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
