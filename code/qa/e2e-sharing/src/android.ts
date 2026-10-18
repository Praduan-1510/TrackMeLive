/**
 * Driving the Android app on the running emulator over adb and uiautomator: read the screen, wait
 * for something to show, tap it, type. Every adb command runs under
 * `code/scripts/with-lock.sh emulator`, one command at a time, so other agents can use the emulator
 * between steps (and the user watching it sees nothing reset).
 *
 * The screen is read with `uiautomator dump`. A dump can fail while something animates (it waits
 * for the UI to go idle); waitFor() just reads again until its deadline.
 */

import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LOCK_SCRIPT, adbPath } from '../../routes/play.ts';
import { WAIT_MS } from './harness.ts';

export const APP_ID = 'live.trackme.app';
export const SERIAL = process.env.ANDROID_SERIAL ?? 'emulator-5554';

export interface UiNode {
  readonly text: string;
  readonly desc: string;
  readonly id: string;
  readonly cls: string;
  readonly pkg: string;
  readonly clickable: boolean;
  readonly enabled: boolean;
  /** Center, device pixels. */
  readonly x: number;
  readonly y: number;
  readonly bounds: readonly [number, number, number, number];
}

function exec(file: string, args: readonly string[]): Promise<Buffer> {
  return new Promise((done, fail) => {
    execFile(file, [...args], { encoding: 'buffer', maxBuffer: 64 << 20 }, (error, stdout, stderr) => {
      if (error) fail(new Error(`${[file, ...args].join(' ')} failed: ${stderr.toString().trim() || error.message}`));
      else done(stdout);
    });
  });
}

/**
 * Set by whoever holds the emulator lock for a whole run (npm run test:android, check-all's qa android
 * step), so the commands inside don't take it again: code/scripts/with-lock.sh isn't re-entrant.
 */
export const LOCK_HELD = process.env.TML_EMULATOR_LOCK_HELD === '1' || process.env.TML_NO_LOCKS === '1';

/** One adb command for the emulator: under the emulator lock, unless the whole run already holds it. */
export function adb(args: readonly string[]): Promise<Buffer> {
  return LOCK_HELD ? exec(adbPath(), ['-s', SERIAL, ...args]) : exec(LOCK_SCRIPT, ['emulator', adbPath(), '-s', SERIAL, ...args]);
}

export const shell = async (...args: string[]): Promise<string> => (await adb(['shell', ...args])).toString('utf8');

const unescape = (s: string): string =>
  s.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Parses a uiautomator dump: one entry per node, attributes as given. */
export function parseDump(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  for (const m of xml.matchAll(/<node\s([^>]*?)\/?>/g)) {
    const attrs = new Map<string, string>();
    for (const a of (m[1] ?? '').matchAll(/([\w-]+)="([^"]*)"/g)) attrs.set(a[1] ?? '', unescape(a[2] ?? ''));
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attrs.get('bounds') ?? '');
    if (!b) continue;
    const bounds = [Number(b[1]), Number(b[2]), Number(b[3]), Number(b[4])] as const;
    nodes.push({
      text: attrs.get('text') ?? '',
      desc: attrs.get('content-desc') ?? '',
      id: attrs.get('resource-id') ?? '',
      cls: attrs.get('class') ?? '',
      pkg: attrs.get('package') ?? '',
      clickable: attrs.get('clickable') === 'true',
      enabled: attrs.get('enabled') !== 'false',
      x: Math.round((bounds[0] + bounds[2]) / 2),
      y: Math.round((bounds[1] + bounds[3]) / 2),
      bounds,
    });
  }
  return nodes;
}

/** The screen as uiautomator sees it now. Throws when the dump fails (e.g. the UI never went idle). */
export async function screen(): Promise<UiNode[]> {
  const out = (await adb(['exec-out', 'uiautomator', 'dump', '/dev/tty'])).toString('utf8');
  const xml = out.slice(out.indexOf('<?xml'), out.lastIndexOf('</hierarchy>') + '</hierarchy>'.length);
  if (!xml.startsWith('<?xml')) throw new Error(`uiautomator dump failed: ${out.trim().slice(0, 200)}`);
  return parseDump(xml);
}

/** The words on screen, for failure messages: every text and description, once each. */
export const words = (nodes: readonly UiNode[]): string[] => [...new Set(nodes.flatMap((n) => [n.text, n.desc]).filter((s) => s.trim() !== ''))];

export type Match = string | RegExp | ((n: UiNode) => boolean);

/** A node whose text or description is exactly `m` (a string), matches it (a RegExp), or passes it. */
export function matches(n: UiNode, m: Match): boolean {
  if (typeof m === 'function') return m(n);
  if (typeof m === 'string') return n.text === m || n.desc === m;
  return m.test(n.text) || m.test(n.desc);
}

export class StepError extends Error {}

/**
 * Reads the screen until `find` returns something, and returns it. Throws after `ms` with what was
 * on screen instead, so a failure says where the app actually was.
 */
export async function waitFor<T>(what: string, find: (nodes: UiNode[]) => T | null | undefined, ms = WAIT_MS): Promise<T> {
  const end = Date.now() + ms;
  let last: UiNode[] = [];
  let lastError = '';
  for (;;) {
    try {
      last = await screen();
      const found = find(last);
      if (found !== null && found !== undefined) return found;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (Date.now() > end) {
      throw new StepError(`Timed out after ${String(ms / 1000)} s waiting for ${what}. On screen: ${JSON.stringify(words(last))}${lastError ? ` (last dump error: ${lastError})` : ''}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Waits for a node and returns it. */
export const waitForNode = (m: Match, what = String(m), ms = WAIT_MS): Promise<UiNode> => waitFor(what, (nodes) => nodes.find((n) => matches(n, m)), ms);

/** Taps the middle of a node, or of the nearest clickable node around it. */
export async function tapNode(n: UiNode): Promise<void> {
  await shell('input', 'tap', String(n.x), String(n.y));
}

const sameBounds = (a: UiNode, b: UiNode): boolean => a.bounds.every((v, i) => v === b.bounds[i]);

/**
 * Waits for a node that stays put across two reads of the screen, then taps it. A sheet still sliding
 * in (the system share sheet does) would otherwise take the tap somewhere else.
 */
export async function tap(m: Match, what = String(m), ms = WAIT_MS): Promise<UiNode> {
  let before: UiNode | null = null;
  const n = await waitFor(`${what} (holding still)`, (nodes) => {
    const now = nodes.find((x) => matches(x, m)) ?? null;
    const still = now && before && sameBounds(now, before) ? now : null;
    before = now;
    return still;
  }, ms);
  await tapNode(n);
  return n;
}

/** Types plain text (letters and digits; spaces become %s, as `input text` needs). */
export async function type(text: string): Promise<void> {
  if (!/^[\w .@+-]*$/.test(text)) throw new Error(`type(): only plain text can be typed through adb, got "${text}"`);
  await shell('input', 'text', text.replace(/ /g, '%s'));
}

/** Closes the on-screen keyboard if it's up (Back would leave the screen when it isn't). */
export async function hideKeyboard(): Promise<void> {
  const ime = await shell('dumpsys', 'input_method');
  if (/\b(mInputShown|mIsInputViewShown|isInputViewShown)=true\b/.test(ime)) await shell('input', 'keyevent', 'KEYCODE_BACK');
}

/** Saves a screenshot of the emulator to `dir/name.png`. */
export async function screenshot(dir: string, name: string): Promise<string> {
  const path = join(dir, `${name}.png`);
  await writeFile(path, await adb(['exec-out', 'screencap', '-p']));
  return path;
}

/**
 * Refuses to start while anyone holds the emulator lock (code/scripts/with-lock.sh), naming the
 * holder. The scenario clears the app's data (sign-in.sh runs `pm clear`), and other lanes' flows
 * lock one step at a time, so the lock alone can't keep it from cutting into theirs: it needs the
 * emulator to itself, from a free lock.
 */
export function assertEmulatorFree(): void {
  const dir = join(process.env.TMPDIR ?? '/tmp', 'tml-lock-emulator');
  let pid = '';
  try {
    pid = readFileSync(join(dir, 'pid'), 'utf8').trim();
  } catch {
    return; // No lock.
  }
  let alive = false;
  try {
    process.kill(Number(pid), 0);
    alive = true;
  } catch {
    alive = false; // Left by a dead process; with-lock.sh takes it over.
  }
  if (!alive) return;
  let what = '?';
  try {
    what = execFileSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' }).trim().slice(0, 200);
  } catch {
    // Gone between the two checks.
  }
  throw new StepError(`The emulator lock is held by pid ${pid}: ${what}\nThe Android scenario clears the app's data, so it needs the emulator to itself. Run it once the other lanes are done with the emulator.`);
}

/** When the app was last installed, as the package manager says. `pm clear` leaves it alone. */
export async function installedAt(): Promise<string> {
  const m = /lastUpdateTime=([^\n\r]+)/.exec(await shell('dumpsys', 'package', APP_ID));
  if (!m?.[1]) throw new StepError(`can't read ${APP_ID}'s install time`);
  return m[1].trim();
}

/** This process's ancestors' pids, nearest first. */
function ancestors(): number[] {
  const out: number[] = [];
  let pid = process.pid;
  while (pid > 1 && out.length < 64) {
    let parent = NaN;
    try {
      parent = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim());
    } catch {
      break;
    }
    if (!Number.isInteger(parent) || parent <= 1) break;
    out.push(parent);
    pid = parent;
  }
  return out;
}

/**
 * The Android scenario holds the emulator lock for its whole run, so nothing else (check-all's device
 * tests, another lane's script) can install, clear or drive the emulator between its steps. Throws
 * unless TML_EMULATOR_LOCK_HELD=1 is set by a with-lock.sh among this process's ancestors (or the
 * locks are off with TML_NO_LOCKS=1, as check-all allows).
 */
export function assertEmulatorLockHeld(): void {
  if (process.env.TML_NO_LOCKS === '1') return;
  const how = 'Run it with npm --prefix code/qa/e2e-sharing run test:android, which holds the emulator lock for the whole scenario.';
  if (process.env.TML_EMULATOR_LOCK_HELD !== '1') throw new StepError(`The Android scenario needs the emulator lock for its whole run. ${how}`);
  let holder = NaN;
  try {
    holder = Number(readFileSync(join(process.env.TMPDIR ?? '/tmp', 'tml-lock-emulator', 'pid'), 'utf8').trim());
  } catch {
    // No lock at all.
  }
  if (!ancestors().includes(holder)) {
    throw new StepError(`TML_EMULATOR_LOCK_HELD=1 is set, but the emulator lock isn't held by this run (holder: ${Number.isNaN(holder) ? 'none' : String(holder)}). ${how}`);
  }
}

/** Fails clearly when there's no emulator, or the app isn't installed. */
export async function checkDevice(): Promise<void> {
  const devices = (await exec(adbPath(), ['devices'])).toString('utf8');
  if (!new RegExp(`^${SERIAL}\\s+device$`, 'm').test(devices)) {
    throw new StepError(`No emulator ${SERIAL} online (adb devices: ${devices.trim().replace(/\n/g, '; ')}). Start it with code/android/run.sh.`);
  }
  const path = await shell('pm', 'path', APP_ID);
  if (!path.includes('package:')) throw new StepError(`${APP_ID} isn't installed on ${SERIAL}. Run code/android/run.sh.`);
}
