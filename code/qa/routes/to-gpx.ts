/**
 * A route as GPX for the iOS Simulator through Xcode (Product › Scheme › Edit Scheme › Run › Options ›
 * Default Location › Add GPX File, or Debug › Simulate Location while running). Xcode reads <wpt>
 * elements with a <time> each and moves between them at the pace the times set, stops included.
 *
 *   node code/qa/routes/to-gpx.ts <route> [--speed <factor>] [--start <ISO time>] [-o <file.gpx>]
 *
 * --speed 4 plays the route 4 times as fast (one waypoint per output second, sampled every 4 route
 * seconds). GPX has no accuracy that Xcode reads; to set it, play the route with play.ts instead.
 * Without -o the GPX goes to stdout.
 */

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { isMain, loadRoute, parseSpeedFactor, positionAt, type Route } from './route.ts';

const DEFAULT_START = '2026-01-01T09:00:00Z';

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One waypoint per output second; the last fix is always included. */
export function toGpx(route: Route, options: { speed?: number; start?: string } = {}): string {
  const speed = options.speed ?? 1;
  const start = Date.parse(options.start ?? DEFAULT_START);
  if (Number.isNaN(start)) throw new Error(`--start must be an ISO 8601 time, got "${options.start ?? ''}"`);
  const outSeconds = Math.ceil(route.duration_s / speed);
  const wpts: string[] = [];
  for (let k = 0; k <= outSeconds; k++) {
    const p = positionAt(route, Math.min(route.duration_s, k * speed));
    const time = new Date(start + k * 1000).toISOString().replace('.000Z', 'Z');
    wpts.push(`  <wpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><time>${time}</time></wpt>`);
  }
  const desc = `${route.summary}${speed === 1 ? '' : ` Played at ${String(speed)}x.`}`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Track Me Live QA (code/qa/routes)" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${xml(route.title)}</name><desc>${xml(desc)}</desc></metadata>`,
    ...wpts,
    '</gpx>',
    '',
  ].join('\n');
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      speed: { type: 'string' },
      start: { type: 'string' },
      out: { type: 'string', short: 'o' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const id = positionals[0];
  if (values.help || id === undefined || positionals.length > 1) {
    console.error('usage: node code/qa/routes/to-gpx.ts <route id or .json> [--speed <factor>] [--start <ISO time>] [-o <file.gpx>]');
    process.exit(values.help ? 0 : 2);
  }
  const gpx = toGpx(loadRoute(id), { speed: parseSpeedFactor(values.speed), start: values.start ?? DEFAULT_START });
  if (values.out) {
    writeFileSync(values.out, gpx);
    console.error(`wrote ${values.out}`);
  } else {
    process.stdout.write(gpx);
  }
}

if (isMain(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`to-gpx: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
