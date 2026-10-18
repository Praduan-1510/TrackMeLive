// The dev scheduler: runs the scheduled functions against the emulators, which never
// fire them (there's no Pub/Sub emulator). Without it nothing ends a dev session at
// stop_at or the 1-hour limit: the rules cut its pings off, but the doc stays active.
//
// It runs the real compiled handlers from lib/, exactly as lifecycle.test.ts does
// (`job.run({scheduleTime})`, here with scheduleTime = now): stopDueSessions on every
// tick, and callWatchdog, cleanupEndedSessions, purgeEndedSessions and sweepRetention
// at their own cadence (every 2 minutes, 15 minutes, 1 hour and 24 hours), all of them
// on the first tick. sweepRetention runs once lib exports it (Backend-Alerts' job).
// It prints one line per change the run made, such as
//   12:04:05 session 9Qe... ended (end_reason: limit, the 1-hour limit)
//
// It loads lib/ once. When lib/index.js is rebuilt (or fails to load), it exits with
// status 75 once the build has settled, and scripts/dev-scheduler.sh starts it again,
// so a long-lived scheduler always runs the handlers as built. DEV_SCHEDULER_WATCH
// names another file to watch instead (its test uses this).
//
// Start it with code/backend/scripts/dev-scheduler.sh (next to a running dev set) or
// through ./run.sh, which starts and stops it with the emulators. Options:
//   --interval <s>         seconds between ticks, 1 to 60 (default 5, or DEV_SCHEDULER_INTERVAL_S)
//   --once                 one tick, then exit (status 1 if a job failed or Firestore didn't answer)
//   --allow-test-project   run on demo-trackmelive-test; only its own test does this
//
// It refuses to start off the emulators: the project must be a demo- one, and
// FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST must be set (the cleanup
// deletes viewer Auth users). It refuses the test project too, whose tests run the
// handlers themselves at chosen times.
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const TEST_PROJECT_ID = "demo-trackmelive-test";
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** The exit status that asks scripts/dev-scheduler.sh to start it again. */
const RESTART = 75;

/** Each job, how often it runs (stopDueSessions on every tick), and whether lib must export it. */
const CADENCE = [
  { name: "stopDueSessions", every: 0, required: true },
  { name: "callWatchdog", every: 2 * MINUTE, required: true },
  { name: "cleanupEndedSessions", every: 15 * MINUTE, required: true },
  { name: "purgeEndedSessions", every: HOUR, required: true },
  { name: "sweepRetention", every: 24 * HOUR, required: false },
];

const REASONS = {
  timer: "its timer ran out",
  limit: "the 1-hour limit",
  call: "the call ended",
  stopped: "stopped by the sharer",
};

function fail(message) {
  console.error(`dev-scheduler: ${message}`);
  process.exit(2);
}

const stamp = () => new Date().toTimeString().slice(0, 8);
const say = (line) => console.log(`${stamp()} ${line}`);

// ---------------------------------------------------------------------------------
// Options and the emulator-only checks, before anything touches Firestore
// ---------------------------------------------------------------------------------
let options;
try {
  ({ values: options } = parseArgs({
    options: {
      interval: { type: "string" },
      once: { type: "boolean", default: false },
      "allow-test-project": { type: "boolean", default: false },
    },
  }));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const rawInterval = options.interval ?? process.env.DEV_SCHEDULER_INTERVAL_S ?? "5";
const intervalS = Number(rawInterval);
if (!Number.isInteger(intervalS) || intervalS < 1 || intervalS > 60) {
  fail(`--interval must be a whole number of seconds from 1 to 60, not "${rawInterval}"`);
}

const project = process.env.GCLOUD_PROJECT ?? "";
if (!project.startsWith("demo-")) {
  fail(`refusing project "${project}": the dev scheduler runs only on a demo- project, on the emulators`);
}
if (project === TEST_PROJECT_ID && !options["allow-test-project"]) {
  fail(`refusing ${TEST_PROJECT_ID}: the tests run the scheduled handlers themselves`);
}
for (const name of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"]) {
  if (!process.env[name]) fail(`${name} isn't set; the dev scheduler runs only against the emulators`);
}
const firestoreUrl = `http://${process.env.FIRESTORE_EMULATOR_HOST}/`;

// The jobs log through firebase-functions' logger: JSON lines, through console.info
// and console.debug for their tallies, which this replaces with one line per change,
// and console.warn and console.error for failures, which are shortened here. The
// logger keeps the console functions it finds when it loads, so patch them first.
const quiet = () => {};
const shorten = (write) => (...args) => {
  if (args.length === 1 && typeof args[0] === "string" && args[0].startsWith("{")) {
    try {
      const { severity, message, ...rest } = JSON.parse(args[0]);
      if (severity && message) {
        write(`${stamp()} ${String(severity).toLowerCase()}: ${message} ${JSON.stringify(rest)}`);
        return;
      }
    } catch {
      // Not a logger entry; print it as it is.
    }
  }
  write(...args);
};
console.info = quiet;
console.debug = quiet;
console.warn = shorten(console.warn.bind(console));
console.error = shorten(console.error.bind(console));

// ---------------------------------------------------------------------------------
// Loading lib/, and noticing when it's rebuilt
// ---------------------------------------------------------------------------------
const LIB = new URL("../lib/index.js", import.meta.url);
const WATCHED = process.env.DEV_SCHEDULER_WATCH || fileURLToPath(LIB);
const mtimeOf = (path) => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
};
const loadedMtime = mtimeOf(WATCHED);
/** True once the watched file has changed and then stayed put for 2 s (tsc has finished). */
const rebuilt = () => {
  const m = mtimeOf(WATCHED);
  return m !== loadedMtime && Date.now() - m >= 2 * SECOND;
};
const exitForRestart = (why) => {
  say(`${why}; restarting to load it`);
  process.exit(RESTART);
};

// lib/index.js initializes the default Admin app from GCLOUD_PROJECT and the
// *_EMULATOR_HOST variables, as the functions runtime does.
let lib;
try {
  lib = await import(LIB.href);
} catch (error) {
  // A build in progress, or a broken one: wait for the next build, then start again.
  say(`functions/lib doesn't load (${error instanceof Error ? error.message : String(error)}); waiting for a rebuild`);
  setInterval(() => rebuilt() && exitForRestart("functions/lib was rebuilt"), SECOND);
  await new Promise(() => {});
}
const { getFirestore } = await import("firebase-admin/firestore");
const db = getFirestore();
const jobs = CADENCE.flatMap(({ name, every, required }) => {
  const job = lib[name];
  if (typeof job?.run === "function") return [{ name, every, job, lastRun: -Infinity }];
  if (required) fail(`lib/index.js has no scheduled function ${name}; build the functions`);
  return [];
});

// ---------------------------------------------------------------------------------
// One tick
// ---------------------------------------------------------------------------------

/** Whether the Firestore emulator answers, the way it does ("Ok"). */
async function emulatorUp() {
  try {
    const res = await fetch(firestoreUrl, { signal: AbortSignal.timeout(2 * SECOND) });
    return res.ok;
  } catch {
    return false;
  }
}

/** What the jobs change on each session, by id. The dev data is small, so read it all. */
async function snapshot() {
  const docs = await db.collection("shareSessions").select("status", "end_reason", "call_active", "cleaned_at").get();
  return new Map(
    docs.docs.map((d) => [
      d.id,
      { status: d.get("status"), endReason: d.get("end_reason"), callActive: d.get("call_active"), cleaned: d.get("cleaned_at") != null },
    ]),
  );
}

/** One line for each change between two snapshots. */
function report(before, after) {
  for (const [id, was] of before) {
    const now = after.get(id);
    if (!now) {
      say(`session ${id} purged (30 days after it ended: the session, its pings and its call log)`);
      continue;
    }
    if (was.status === "active" && now.status === "stopped") {
      say(`session ${id} ended (end_reason: ${now.endReason}, ${REASONS[now.endReason] ?? "unknown reason"})`);
    } else if (now.status === "active" && was.callActive === true && now.callActive === false) {
      say(`session ${id}: call_active off (no check-in for 2 minutes)`);
    }
    if (!was.cleaned && now.cleaned) {
      say(`session ${id} cleaned up (24 h after it ended: its pings and viewer sign-ins)`);
    }
  }
}

let wasDown = false;

/** Runs the jobs that are due; resolves false when one failed or the emulator is down. */
async function tick() {
  if (!(await emulatorUp())) {
    if (!wasDown) say(`waiting for the Firestore emulator at ${firestoreUrl}`);
    wasDown = true;
    return false;
  }
  if (wasDown) say("the Firestore emulator is up");
  wasDown = false;

  const now = Date.now();
  const due = jobs.filter((j) => now - j.lastRun >= j.every);
  let ok = true;
  try {
    const before = await snapshot();
    for (const j of due) {
      j.lastRun = now;
      try {
        await j.job.run({ scheduleTime: new Date(now).toISOString() });
      } catch (error) {
        ok = false;
        say(`${j.name} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    report(before, await snapshot());
  } catch (error) {
    ok = false;
    say(`tick failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return ok;
}

// ---------------------------------------------------------------------------------
// The loop: ticks never overlap. A signal exits at once; each job's writes are
// transactions, so a run cut short leaves nothing half done.
// ---------------------------------------------------------------------------------
if (options.once) {
  const ok = await tick();
  process.exit(ok ? 0 : 1);
}

const stop = () => process.exit(0);
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const sweep = jobs.some((j) => j.name === "sweepRetention") ? ", sweepRetention every 24 h" : " (sweepRetention isn't built yet)";
say(`dev scheduler on ${project}: stopDueSessions every ${intervalS} s, callWatchdog every 2 min, cleanup every 15 min, purge every 60 min${sweep}`);

const loop = async () => {
  if (rebuilt()) exitForRestart("functions/lib was rebuilt");
  await tick();
  setTimeout(() => void loop(), intervalS * SECOND);
};
await loop();
