/**
 * Plays a route into the Android emulator or the iOS Simulator in real time: one fix per second
 * (--every), with route time running --speed times as fast as the clock.
 *
 *   node code/qa/routes/play.ts <route> [options]
 *
 *   --target android|ios     android (default): the running emulator over adb; ios: a booted Simulator
 *   --speed <factor>         route seconds per real second (default 1)
 *   --accuracy <m>|route     the accuracy each fix reports (default: the route's own)
 *   --via geo|mock           Android only. geo (default): `adb emu geo fix`, the emulator's own GNSS,
 *                            which always reports its own accuracy (5 m on the Pixel_9 image), so
 *                            --accuracy is ignored there. mock: the platform's test provider for "gps"
 *                            (`cmd location providers set-test-provider-location --accuracy`), which
 *                            reports --accuracy (or the route's); removed again when the player stops.
 *   --serial <id>            adb serial (default $ANDROID_SERIAL, else emulator-5554)
 *   --sim <udid>|booted      iOS Simulator (default booted)
 *   --from <s> / --to <s>    play only part of the route (route seconds)
 *   --every <s>              seconds between fixes (default 1)
 *   --loop                   start over at the end
 *   --json                   one JSON line per fix on stdout (for scripts), instead of text
 *   --dry-run                print the commands instead of running them
 *   --no-lock                don't take the emulator lock (only for a machine nobody else uses)
 *
 * Every adb command runs under `code/scripts/with-lock.sh emulator`, one command at a time, so other
 * agents can install and drive the emulator between fixes. A fix that couldn't be sent on time (the
 * lock was busy) is skipped, never replayed late: the next fix is where the route is now.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ROUTES_DIR, isMain, loadRoute, parseAccuracy, parseSpeedFactor, positionAt, type Route, type RoutePoint } from './route.ts';

export const LOCK_SCRIPT = resolve(ROUTES_DIR, '../../scripts/with-lock.sh');
const KNOTS_PER_MPS = 1.943844;

export type Target = 'android' | 'ios';
export type Via = 'geo' | 'mock';

export interface PlayOptions {
  readonly route: Route;
  readonly target?: Target;
  readonly speed?: number;
  /** Fixed accuracy in meters; null uses the route's. */
  readonly accuracy?: number | null;
  readonly via?: Via;
  readonly serial?: string;
  readonly sim?: string;
  readonly from_s?: number;
  readonly to_s?: number;
  readonly every_s?: number;
  readonly loop?: boolean;
  readonly dryRun?: boolean;
  readonly lock?: boolean;
  /** Stops the player (cleanly: a mock provider is removed). */
  readonly signal?: AbortSignal;
  /** Called after each fix is sent. */
  readonly onFix?: (fix: SentFix) => void;
  /** Where progress notes go (default stderr). */
  readonly log?: (line: string) => void;
}

export interface SentFix {
  /** Route time of this fix, seconds. */
  readonly route_t_s: number;
  readonly lat: number;
  readonly lng: number;
  readonly accuracy_m: number;
  readonly speed_mps: number;
  /** When it was sent, epoch ms. */
  readonly sent_at: number;
  readonly command: readonly string[];
}

export interface PlayResult {
  readonly sent: number;
  /** Fixes skipped because a command (or the lock) took longer than --every. */
  readonly skipped: number;
  readonly stopped: 'end' | 'aborted';
}

export function adbPath(): string {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(homedir(), 'Library/Android/sdk');
  const adb = join(sdk, 'platform-tools/adb');
  return existsSync(adb) ? adb : 'adb';
}

/** `adb emu geo fix <longitude> <latitude> <altitude> <satellites> <knots>`: longitude first. */
export function geoFixArgs(p: RoutePoint): string[] {
  return ['emu', 'geo', 'fix', p.lng.toFixed(6), p.lat.toFixed(6), '10', '8', (p.speed_mps * KNOTS_PER_MPS).toFixed(2)];
}

export function mockFixArgs(p: RoutePoint): string[] {
  return ['shell', 'cmd', 'location', 'providers', 'set-test-provider-location', 'gps', '--location', `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`, '--accuracy', p.accuracy_m.toFixed(1)];
}

export function simctlFixArgs(sim: string, p: RoutePoint): string[] {
  return ['simctl', 'location', sim, 'set', `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`];
}

const MOCK_SETUP: readonly (readonly string[])[] = [
  ['shell', 'appops', 'set', 'com.android.shell', 'android:mock_location', 'allow'],
  ['shell', 'cmd', 'location', 'providers', 'add-test-provider', 'gps', '--supportsAltitude', '--supportsSpeed', '--supportsBearing'],
  ['shell', 'cmd', 'location', 'providers', 'set-test-provider-enabled', 'gps', 'true'],
];
const MOCK_TEARDOWN: readonly (readonly string[])[] = [
  ['shell', 'cmd', 'location', 'providers', 'remove-test-provider', 'gps'],
  ['shell', 'appops', 'set', 'com.android.shell', 'android:mock_location', 'default'],
];

function run(file: string, args: readonly string[], signal?: AbortSignal): Promise<string> {
  return new Promise((done, fail) => {
    execFile(file, [...args], { signal, maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
      if (error) {
        fail(new Error(`${[file, ...args].join(' ')} failed: ${(stderr || error.message).trim()}`));
        return;
      }
      // The emulator console answers KO for a refused command, with exit status 0.
      if (/^KO\b/m.test(stdout)) {
        fail(new Error(`${[file, ...args].join(' ')} was refused: ${stdout.trim()}`));
        return;
      }
      done(stdout);
    });
  });
}

const sleepUntil = (when: number, signal?: AbortSignal): Promise<void> =>
  new Promise((done) => {
    const ms = Math.max(0, when - Date.now());
    const timer = setTimeout(finish, ms);
    function finish(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      done();
    }
    signal?.addEventListener('abort', finish, { once: true });
  });

export async function play(o: PlayOptions): Promise<PlayResult> {
  const target = o.target ?? 'android';
  const via = o.via ?? 'geo';
  const speed = o.speed ?? 1;
  const every = o.every_s ?? 1;
  const from = o.from_s ?? 0;
  const to = Math.min(o.to_s ?? o.route.duration_s, o.route.duration_s);
  const serial = o.serial ?? process.env.ANDROID_SERIAL ?? 'emulator-5554';
  const sim = o.sim ?? 'booted';
  const log = o.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  if (!(to > from)) throw new Error(`--to (${String(to)}) must be after --from (${String(from)})`);
  if (!(every > 0)) throw new Error('--every must be above 0');
  if (target === 'android' && via === 'geo' && o.accuracy != null) {
    log('play: note: `geo fix` always reports the emulator\'s own accuracy; use --via mock to set it.');
  }

  const adb = adbPath();
  // A run that holds the emulator lock throughout (TML_EMULATOR_LOCK_HELD=1) must not take it again.
  const lock = o.lock ?? (process.env.TML_EMULATOR_LOCK_HELD !== '1' && process.env.TML_NO_LOCKS !== '1');
  /** One adb command, holding the emulator lock only while it runs. */
  const adbRun = async (args: readonly string[]): Promise<readonly string[]> => {
    const cmd = lock ? [LOCK_SCRIPT, 'emulator', adb, '-s', serial, ...args] : [adb, '-s', serial, ...args];
    if (!o.dryRun) await run(cmd[0] as string, cmd.slice(1), o.signal);
    return cmd;
  };
  const send = async (p: RoutePoint): Promise<readonly string[]> => {
    if (target === 'ios') {
      const cmd = ['xcrun', ...simctlFixArgs(sim, p)];
      if (!o.dryRun) await run('xcrun', cmd.slice(1), o.signal);
      return cmd;
    }
    return adbRun(via === 'mock' ? mockFixArgs(p) : geoFixArgs(p));
  };
  const say = (cmd: readonly string[]): void => {
    if (o.dryRun) log(cmd.join(' '));
  };

  let sent = 0;
  let skipped = 0;
  const mock = target === 'android' && via === 'mock';
  if (mock) for (const args of MOCK_SETUP) say(await adbRun(args));
  try {
    const span = to - from;
    const startedAt = Date.now();
    let tick = 0;
    for (;;) {
      if (o.signal?.aborted) return { sent, skipped, stopped: 'aborted' };
      const elapsed = tick * every * speed;
      // Past the end (a late tick included), the last fix is sent once, then the player stops.
      const routeT = from + (o.loop ? elapsed % span : Math.min(elapsed, span));
      const at = positionAt(o.route, routeT);
      const fix: RoutePoint = o.accuracy == null ? at : { ...at, accuracy_m: o.accuracy };
      let cmd: readonly string[];
      try {
        cmd = await send(fix);
      } catch (e) {
        if (o.signal?.aborted) return { sent, skipped, stopped: 'aborted' };
        throw e;
      }
      sent += 1;
      say(cmd);
      o.onFix?.({ route_t_s: routeT, lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracy_m, speed_mps: fix.speed_mps, sent_at: Date.now(), command: cmd });
      if (!o.loop && elapsed >= span) break;
      // The next fix is due on the next tick of the clock; ticks already past are skipped.
      const due = Math.floor((Date.now() - startedAt) / (every * 1000)) + 1;
      skipped += Math.max(0, due - tick - 1);
      tick = o.dryRun ? tick + 1 : due;
      if (!o.dryRun) await sleepUntil(startedAt + tick * every * 1000, o.signal);
    }
    return { sent, skipped, stopped: 'end' };
  } finally {
    // Never leave the test provider in place: it would shadow the emulator's GNSS for everyone.
    if (mock) {
      for (const args of MOCK_TEARDOWN) {
        try {
          const cmd = lock ? [LOCK_SCRIPT, 'emulator', adb, '-s', serial, ...args] : [adb, '-s', serial, ...args];
          if (o.dryRun) log(cmd.join(' '));
          else await run(cmd[0] as string, cmd.slice(1));
        } catch (e) {
          log(`play: cleanup failed (${e instanceof Error ? e.message : String(e)})`);
        }
      }
    }
  }
}

function parseSeconds(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be seconds, 0 or more, got "${raw}"`);
  return n;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      target: { type: 'string' },
      speed: { type: 'string' },
      accuracy: { type: 'string' },
      via: { type: 'string' },
      serial: { type: 'string' },
      sim: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      every: { type: 'string' },
      loop: { type: 'boolean' },
      json: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'no-lock': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const id = positionals[0];
  if (values.help || id === undefined || positionals.length > 1) {
    console.error('usage: node code/qa/routes/play.ts <route> [--target android|ios] [--speed N] [--accuracy M] [--via geo|mock] [--serial ID] [--sim UDID] [--from S] [--to S] [--every S] [--loop] [--json] [--dry-run] [--no-lock]');
    process.exit(values.help ? 0 : 2);
  }
  const target = (values.target ?? 'android') as Target;
  if (target !== 'android' && target !== 'ios') throw new Error('--target must be android or ios');
  const via = (values.via ?? 'geo') as Via;
  if (via !== 'geo' && via !== 'mock') throw new Error('--via must be geo or mock');
  const route = loadRoute(id);
  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => controller.abort());
  const speed = parseSpeedFactor(values.speed);
  const quiet = values['dry-run'];
  if (!values.json) console.error(`play: ${route.title} (${String(route.duration_s)} s of route) at ${String(speed)}x on ${target}${target === 'android' ? ` via ${via}` : ''}`);
  const result = await play({
    route,
    target,
    via,
    speed,
    accuracy: parseAccuracy(values.accuracy),
    serial: values.serial,
    sim: values.sim,
    from_s: parseSeconds(values.from, 'from'),
    to_s: parseSeconds(values.to, 'to'),
    every_s: parseSeconds(values.every, 'every'),
    loop: values.loop,
    dryRun: values['dry-run'],
    lock: !values['no-lock'],
    signal: controller.signal,
    onFix: (f) => {
      if (values.json) process.stdout.write(`${JSON.stringify({ event: 'fix', ...f, command: undefined })}\n`);
      else if (!quiet) console.log(`t=${f.route_t_s.toFixed(1).padStart(6)} s  ${f.lat.toFixed(6)},${f.lng.toFixed(6)}  ±${f.accuracy_m.toFixed(0)} m  ${f.speed_mps.toFixed(1)} m/s`);
    },
  });
  const line = { event: 'done', ...result };
  if (values.json) process.stdout.write(`${JSON.stringify(line)}\n`);
  else console.error(`play: ${result.stopped === 'end' ? 'done' : 'stopped'}: ${String(result.sent)} fixes sent, ${String(result.skipped)} skipped`);
  if (result.stopped === 'aborted') process.exitCode = 130;
}

if (isMain(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(`play: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
