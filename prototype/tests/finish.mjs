// Ends a test script: prints nothing itself, sets exit code 1 when any check failed or an error was
// logged, waits for stdout and stderr to flush, then exits. The explicit exit is needed because the
// Playwright connection can keep node alive for minutes after the browser has closed.
export async function finish(checks = [], errors = []) {
  const failed = checks.some((line) => line.startsWith('FAIL')) || errors.length > 0;
  await Promise.all([process.stdout, process.stderr].map((stream) => new Promise((resolve) => stream.write('', resolve))));
  process.exit(failed ? 1 : 0);
}
