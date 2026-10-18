/**
 * The fake sharer's command line. Against the dev emulators (code/backend/run.sh) by default, or the
 * test set when run under code/backend/scripts/with-test-emulators.sh.
 *
 *   node code/qa/fake-sharer/src/cli.ts [options]
 *
 * Who shares
 *   --phone <E.164>           sign in as this number (default: a new random +1 415 555 xxxx)
 *   --name <name>             default Alex
 *   --mascot <id> --color <id> --accessory <id>    default fox, original, none
 * The share
 *   --viewer-name <name>      "who it's for", seen only by the sharer
 *   --precision precise|approximate
 *   --stop-rule minutes|limit|call    default minutes (FSD: 30 min without a call)
 *   --stop-minutes 15|30|60   default 30
 *   --call                    a call share (a call id, share back allowed)
 * The route and cadence
 *   --route <id|file.json>    default walk-ferry-building (code/qa/routes)
 *   --speed <factor>          route seconds per real second (default 1)
 *   --interval <s>            seconds between pings (default 4: FSD §7, 3-5 s above 20% battery)
 *   --battery <percent>       pick the FSD interval for this battery level (4, 15 or 60 s) instead
 *   --accuracy <m>            every fix's accuracy (default: the route's)
 *   --from <s>                start this far into the route
 * Where Alex is (the session's place, x-decisions Q-PLACE)
 *   Each ping's batch also carries the place, as the apps write it, when the route's label there
 *   changed: looked up at most once per 10 s and only after moving 25 m, area and city only while
 *   approximate. The route's labels stand in for the phone's geocoder.
 *   --no-place                never write a place (a phone whose geocoder doesn't answer)
 * How it ends
 *   --at-end stop|hold|quiet|loop   at the route's end (default stop: Stop, through stopSession)
 *   --pings <n>               write n pings, then nothing (the viewer shows Last seen)
 *   --gps-lost                after --pings, keep checking in every 30 s without a fix
 *   --stop-after <s>          tap Stop this long after the first ping
 *   --end-in <s>              TEST-ONLY: backdate so the timer ends in s seconds (end_reason timer)
 *   --limit-in <s>            TEST-ONLY: backdate so the 1-hour limit lands in s seconds (end_reason limit)
 *   --keep                    on Ctrl-C, leave the session running (default: Stop it)
 * Output
 *   --viewer-base <url>       where the viewer runs (default $TML_VIEWER_BASE or http://localhost:5173)
 *   --json                    one JSON event per line on stdout, for scripts and tests
 *
 * The session ends at its timer or 1-hour limit only when the stop job runs: on the dev set that's
 * code/backend/scripts/dev-scheduler.sh (run.sh starts it). Exit status: 0 when the session ended
 * (or was left running with --keep), 1 on an error, 2 on bad usage, 130 on Ctrl-C.
 */

import { parseArgs } from 'node:util';
import { MASCOT_ACCESSORY_VALUES, MASCOT_COLOR_VALUES, MASCOT_ID_VALUES, type MascotAccessory, type MascotColor, type MascotId, type Precision, type StopMinutes, type StopRule } from '../../../shared/schema/generated/ts/schema.ts';
import { PLACE_PARTS, isMain, loadRoute, parseAccuracy, parseSpeedFactor } from '../../routes/route.ts';
import { runRoute, type AtEnd, type SharerEvent } from './run.ts';
import { FakeSharer, checkInterval, intervalForBattery, type Session } from './sharer.ts';

export const DEFAULT_VIEWER_BASE = 'http://localhost:5173';

/** The share link on another viewer origin: link_url's host is the backend's VIEWER_ORIGIN, so build it from the token. */
export const viewerUrl = (base: string, token: string): string => `${base.replace(/\/$/, '')}/s/${token}`;

class Usage extends Error {}

function oneOf<T extends string>(raw: string | undefined, values: readonly T[], name: string, fallback: T): T;
function oneOf<T extends string>(raw: string | undefined, values: readonly T[], name: string): T | undefined;
function oneOf<T extends string>(raw: string | undefined, values: readonly T[], name: string, fallback?: T): T | undefined {
  if (raw === undefined) return fallback;
  if (!(values as readonly string[]).includes(raw)) throw new Usage(`--${name} must be one of ${values.join(', ')}, got "${raw}"`);
  return raw as T;
}

function num(raw: string | undefined, name: string, min = 0): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) throw new Usage(`--${name} must be a number of at least ${String(min)}, got "${raw}"`);
  return n;
}

const time = (ms: number | null | undefined): string => (ms == null ? '-' : new Date(ms).toLocaleTimeString('en-US', { hour12: false }));

function human(e: SharerEvent): string {
  switch (e.event) {
    case 'ping':
      return `ping ${String(e.n).padStart(3)}  ${e.lat.toFixed(6)},${e.lng.toFixed(6)}  ±${e.accuracy_m.toFixed(0)} m  route ${e.route_t_s.toFixed(0)} s`;
    case 'place':
      return e.place === null ? 'place cleared' : `place    ${PLACE_PARTS.map((k) => e.place?.[k]).filter((v) => v != null).join(', ')}`;
    case 'check-in':
      return `check-in without a fix at ${time(e.at)}`;
    case 'quiet':
      return e.mode === 'quiet' ? `quiet after ${String(e.after_pings)} pings: the viewer should show Last seen` : `GPS lost after ${String(e.after_pings)} pings: checking in every 30 s`;
    case 'route-end':
      return `the route ended (--at-end ${e.at_end})`;
    case 'refused':
      return e.over ? `the server refused the ping: ${e.message}` : `the server refused a write: ${e.message}`;
    case 'stopping':
      return `Stop (${e.why})`;
    case 'stopped':
      return `stopSession: ${e.end_reason} at ${time(e.ended_at)}`;
    case 'ended':
      return `the session ended: ${e.end_reason ?? '?'} at ${time(e.ended_at)}`;
    case 'waiting':
      return `waiting for ${e.for}`;
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      phone: { type: 'string' },
      name: { type: 'string' },
      mascot: { type: 'string' },
      color: { type: 'string' },
      accessory: { type: 'string' },
      'viewer-name': { type: 'string' },
      precision: { type: 'string' },
      'stop-rule': { type: 'string' },
      'stop-minutes': { type: 'string' },
      call: { type: 'boolean' },
      route: { type: 'string' },
      speed: { type: 'string' },
      interval: { type: 'string' },
      battery: { type: 'string' },
      accuracy: { type: 'string' },
      from: { type: 'string' },
      'no-place': { type: 'boolean' },
      'at-end': { type: 'string' },
      pings: { type: 'string' },
      'gps-lost': { type: 'boolean' },
      'stop-after': { type: 'string' },
      'end-in': { type: 'string' },
      'limit-in': { type: 'string' },
      keep: { type: 'boolean' },
      'viewer-base': { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const json = values.json ?? false;
  const out = (event: Record<string, unknown>, text: string): void => {
    if (json) process.stdout.write(`${JSON.stringify(event)}\n`);
    else process.stdout.write(`${text}\n`);
  };

  const route = loadRoute(values.route ?? 'walk-ferry-building');
  const precision = oneOf<Precision>(values.precision, ['precise', 'approximate'], 'precision', 'precise');
  const stopRule = oneOf<StopRule>(values['stop-rule'], ['minutes', 'limit', 'call'], 'stop-rule');
  const stopMinutesRaw = values['stop-minutes'];
  const stopMinutes = stopMinutesRaw === undefined ? undefined : (Number(oneOf(stopMinutesRaw, ['15', '30', '60'], 'stop-minutes')) as StopMinutes);
  if (values.interval !== undefined && values.battery !== undefined) throw new Usage('Use --interval or --battery, not both.');
  const battery = num(values.battery, 'battery');
  const interval = checkInterval(battery !== undefined ? intervalForBattery(battery) : (num(values.interval, 'interval') ?? 4));
  const atEnd = oneOf<AtEnd>(values['at-end'], ['stop', 'hold', 'quiet', 'loop'], 'at-end', 'stop');
  const pingsRaw = num(values.pings, 'pings', 1);
  const viewerBase = values['viewer-base'] ?? process.env.TML_VIEWER_BASE ?? DEFAULT_VIEWER_BASE;

  const sharer = await FakeSharer.signIn({
    phone: values.phone,
    profile: {
      ...(values.name !== undefined ? { name: values.name } : {}),
      ...(values.mascot !== undefined ? { mascot_id: oneOf<MascotId>(values.mascot, MASCOT_ID_VALUES, 'mascot') } : {}),
      ...(values.color !== undefined ? { mascot_color: oneOf<MascotColor>(values.color, MASCOT_COLOR_VALUES, 'color') } : {}),
      ...(values.accessory !== undefined ? { mascot_accessory: values.accessory === 'none' ? null : oneOf<MascotAccessory>(values.accessory, MASCOT_ACCESSORY_VALUES, 'accessory') } : {}),
    },
  });
  out({ event: 'signed-in', uid: sharer.uid, phone: sharer.phone, project: sharer.set.projectId, name: sharer.profile.name }, `Signed in as ${sharer.profile.name} (${sharer.phone}, uid ${sharer.uid}) on ${sharer.set.projectId}`);

  let session: Session | null = null;
  const controller = new AbortController();
  let interrupted = false;
  const onSignal = (): void => {
    interrupted = true;
    controller.abort();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    session = await sharer.share({
      stop_rule: stopRule,
      stop_minutes: stopMinutes,
      precision,
      viewer_name: values['viewer-name'] ?? null,
      call: values.call ?? false,
      end_in_s: num(values['end-in'], 'end-in', 1),
      limit_in_s: num(values['limit-in'], 'limit-in', 1),
    });
    const url = viewerUrl(viewerBase, session.linkToken);
    const s = await sharer.read(session.id);
    out(
      {
        event: 'session',
        session_id: session.id,
        link_token: session.linkToken,
        link_url: session.linkUrl,
        viewer_url: url,
        started_at: session.startedAt.getTime(),
        expires_at: session.expiresAt.getTime(),
        stop_at: session.stopAt?.getTime() ?? null,
        backdated_ms: session.backdatedMs,
        interval_s: interval,
        route: route.id,
        speed: parseSpeedFactor(values.speed),
      },
      [
        `Session ${session.id}${session.backdatedMs > 0 ? ` (TEST-ONLY: backdated ${String(Math.round(session.backdatedMs / 1000))} s)` : ''}`,
        `  Open in the browser: ${url}`,
        `  Link as sent:        ${session.linkUrl}`,
        `  Ends by ${time(Math.min(s.expires_at.getTime(), s.stop_at?.getTime() ?? Infinity))} (stop_at ${time(s.stop_at?.getTime())}, 1-hour limit ${time(s.expires_at.getTime())})`,
        `  ${route.title}: a ping every ${String(interval)} s at ${String(parseSpeedFactor(values.speed))}x`,
      ].join('\n'),
    );

    const result = await runRoute(sharer, session, {
      route,
      speed: parseSpeedFactor(values.speed),
      interval_s: interval,
      accuracy: parseAccuracy(values.accuracy),
      from_s: num(values.from, 'from'),
      place: !(values['no-place'] ?? false),
      pings: pingsRaw,
      after_pings: values['gps-lost'] ? 'check-in' : 'quiet',
      stop_after_s: num(values['stop-after'], 'stop-after'),
      at_end: atEnd,
      signal: controller.signal,
      onEvent: (e) => {
        out(e, human(e));
      },
    });
    if (result.outcome === 'aborted' && interrupted) {
      if (values.keep) {
        out({ event: 'left-running', session_id: session.id }, `Left session ${session.id} running (--keep).`);
      } else {
        const r = await sharer.stop(session);
        out({ event: 'stopped', end_reason: r.end_reason, ended_at: r.ended_at }, `Stopped on Ctrl-C: ${r.end_reason} at ${time(r.ended_at)}`);
      }
      return 130;
    }
    if (result.outcome === 'not-marked') {
      out(
        { event: 'not-marked', session_id: session.id },
        'The session is past its end and the rules refuse its pings, but nothing has marked it stopped. Is the dev scheduler running? (code/backend/scripts/dev-scheduler.sh)',
      );
      return 1;
    }
    out({ event: 'done', pings: result.pings, outcome: result.outcome, end_reason: result.end_reason }, `Done: ${String(result.pings)} pings, ended (${result.end_reason ?? '?'})`);
    return 0;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await sharer.close();
  }
}

const HELP = (await import('node:fs')).readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*\n([\s\S]*?)\*\//)?.[1]?.replace(/^ \* ?/gm, '').trimEnd() ?? '';

if (isMain(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e: unknown) => {
      const usage = e instanceof Usage || (e instanceof TypeError && 'code' in e && String(e.code).startsWith('ERR_PARSE_ARGS'));
      process.stderr.write(`fake-sharer: ${e instanceof Error ? e.message : String(e)}\n`);
      if (usage) process.stderr.write('Run with --help for the options.\n');
      process.exit(usage ? 2 : 1);
    },
  );
}
