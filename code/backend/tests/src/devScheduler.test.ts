/**
 * The dev scheduler (functions/scripts/dev-scheduler.mjs), run as its own process
 * the way scripts/dev-scheduler.sh runs it, but on the test set with
 * --allow-test-project. It runs the compiled scheduled handlers at "now", so each
 * test seeds sessions that are already due and reads back what it changed and
 * what it printed. Its refusals are checked without touching Firestore.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { validate } from "../../../shared/schema/generated/ts/schema.ts";
import { AUTH, FIRESTORE, PROJECT_ID, clearAuth, clearFirestore } from "./emulators.ts";

const SCRIPT = fileURLToPath(new URL("../../functions/scripts/dev-scheduler.mjs", import.meta.url));
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const emulatorEnv = {
  GCLOUD_PROJECT: PROJECT_ID,
  FIRESTORE_EMULATOR_HOST: `${FIRESTORE.host}:${FIRESTORE.port}`,
  FIREBASE_AUTH_EMULATOR_HOST: `${AUTH.host}:${AUTH.port}`,
  METADATA_SERVER_DETECTION: "none",
};

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the scheduler with exactly these env vars (plus PATH) and arguments. */
function runScheduler(args: string[], env: Record<string, string> = emulatorEnv): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH ?? "", ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

let app: App;
let db: Firestore;
let auth: Auth;

const at = (ms: number) => Timestamp.fromMillis(ms);

/** A live manual share on a 30-minute timer, as createSession writes it. */
function sessionDoc(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  const session = {
    status: "active",
    started_at: at(now - 5 * MIN),
    expires_at: at(now + 55 * MIN),
    stop_rule: "minutes",
    stop_minutes: 30,
    stop_at: at(now + 25 * MIN),
    ended_at: null,
    end_reason: null,
    call_id: null,
    call_active: false,
    call_ended_at: null,
    share_back_allowed: false,
    last_ping_at: at(now - 5_000),
    ping_interval_s: 5,
    precision: "precise",
    precision_next: null,
    sharer: { name: "Alex", mascot_id: "fox", mascot_color: "original", mascot_accessory: null },
    first_viewed_at: null,
    viewer_sharing: false,
    share_back_requested_at: null,
    cleaned_at: null,
    ...overrides,
  };
  assert.deepEqual(validate("ShareSession", session), []);
  return session;
}

async function seed(id: string, session: Record<string, unknown>, viewers: string[] = []): Promise<void> {
  const ref = db.doc(`shareSessions/${id}`);
  const batch = db.batch();
  batch.set(ref, session);
  batch.set(ref.collection("private").doc("meta"), {
    user_id: "alice", link_token_hash: "0".repeat(64), viewer_uid: viewers[0] ?? null, viewer_name: null, activity_push_token: null,
  });
  viewers.forEach((uid, i) => batch.set(ref.collection("viewerSignIns").doc(uid), { role: i === 0 ? "viewer" : "watcher", created_at: Timestamp.now() }));
  await batch.commit();
  for (const uid of viewers) await auth.createUser({ uid });
}

const sessionOf = async (id: string) => (await db.doc(`shareSessions/${id}`).get()).data();

before(async () => {
  app = initializeApp({ projectId: PROJECT_ID }, "devScheduler-test");
  db = getFirestore(app);
  auth = getAuth(app);
});

after(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  await clearFirestore();
  await clearAuth();
});

describe("dev scheduler: refusals, before it touches anything", () => {
  it("refuses a project that isn't demo-", async () => {
    const r = await runScheduler(["--once"], { ...emulatorEnv, GCLOUD_PROJECT: "trackmelive" });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /refusing project "trackmelive"/);
  });

  it("refuses to run without FIRESTORE_EMULATOR_HOST or FIREBASE_AUTH_EMULATOR_HOST", async () => {
    for (const name of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"] as const) {
      const env: Record<string, string> = { ...emulatorEnv };
      delete env[name];
      const r = await runScheduler(["--once", "--allow-test-project"], env);
      assert.equal(r.code, 2, name);
      assert.match(r.stderr, new RegExp(`${name} isn't set`));
    }
  });

  it("refuses the test project unless told it's its own test", async () => {
    const r = await runScheduler(["--once"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /refusing demo-trackmelive-test/);
  });

  it("refuses an interval outside 1 to 60 seconds, and unknown options", async () => {
    for (const bad of ["0", "61", "2.5", "five"]) {
      const r = await runScheduler(["--interval", bad, "--allow-test-project"]);
      assert.equal(r.code, 2, bad);
      assert.match(r.stderr, /--interval must be a whole number of seconds from 1 to 60/);
    }
    const r = await runScheduler(["--bogus"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Unknown option '--bogus'/);
  });
});

describe("dev scheduler: one tick runs every job at now", () => {
  it("ends due sessions, turns off a stale call, cleans up and purges, with one line each", async () => {
    const now = Date.now();
    await seed("past-limit", sessionDoc({ started_at: at(now - 61 * MIN), expires_at: at(now - MIN), stop_rule: "limit", stop_minutes: null, stop_at: at(now - MIN) }));
    await seed("past-timer", sessionDoc({ started_at: at(now - 16 * MIN), expires_at: at(now + 44 * MIN), stop_minutes: 15, stop_at: at(now - MIN) }));
    await seed("live", sessionDoc());
    await seed("stale-call", sessionDoc({
      stop_rule: "minutes", call_id: "call-1", call_active: true, share_back_allowed: true, last_ping_at: at(now - 3 * MIN),
    }));
    const ended = (ago: number) => sessionDoc({
      status: "stopped", started_at: at(now - ago - 10 * MIN), expires_at: at(now - ago + 50 * MIN), stop_at: at(now - ago + 20 * MIN),
      ended_at: at(now - ago), end_reason: "stopped",
    });
    await seed("ended-a-day-ago", ended(DAY + MIN), ["v_ended-a-day-ago_viewer"]);
    await seed("ended-a-month-ago", { ...ended(31 * DAY), cleaned_at: at(now - 30 * DAY) });

    const r = await runScheduler(["--once", "--allow-test-project"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stderr, "");

    assert.equal((await sessionOf("past-limit"))?.end_reason, "limit");
    assert.equal((await sessionOf("past-timer"))?.end_reason, "timer");
    assert.equal((await sessionOf("live"))?.status, "active");
    const staleCall = await sessionOf("stale-call");
    assert.equal(staleCall?.status, "active");
    assert.equal(staleCall?.call_active, false);
    assert.notEqual((await sessionOf("ended-a-day-ago"))?.cleaned_at, null);
    assert.equal(await sessionOf("ended-a-month-ago"), undefined);

    const lines = r.stdout.trim().split("\n").map((l) => l.replace(/^\d\d:\d\d:\d\d /, "")).sort();
    assert.deepEqual(lines, [
      "session ended-a-day-ago cleaned up (24 h after it ended: its pings and viewer sign-ins)",
      "session ended-a-month-ago purged (30 days after it ended: the session, its pings and its call log)",
      "session past-limit ended (end_reason: limit, the 1-hour limit)",
      "session past-timer ended (end_reason: timer, its timer ran out)",
      "session stale-call: call_active off (no check-in for 2 minutes)",
    ]);
  });

  it("waits for an emulator that doesn't answer, and --once says so with status 1", async () => {
    const r = await runScheduler(["--once", "--allow-test-project"], { ...emulatorEnv, FIRESTORE_EMULATOR_HOST: "127.0.0.1:1" });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /waiting for the Firestore emulator at http:\/\/127\.0\.0\.1:1\//);
  });

  it("prints nothing when nothing is due", async () => {
    await seed("live", sessionDoc());
    const r = await runScheduler(["--once", "--allow-test-project"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "");
    assert.equal((await sessionOf("live"))?.status, "active");
  });
});

describe("dev scheduler: the loop", () => {
  it("ends a session within a tick of its timer, and exits cleanly on SIGTERM", async () => {
    const now = Date.now();
    await seed("due-soon", sessionDoc({ stop_minutes: 15, started_at: at(now - 15 * MIN + 1500), stop_at: at(now + 1500) }));
    const child = spawn(process.execPath, [SCRIPT, "--interval", "1", "--allow-test-project"], {
      env: { PATH: process.env.PATH ?? "", ...emulatorEnv },
    });
    let stdout = "";
    const endedLine = new Promise<void>((resolve) => {
      child.stdout.on("data", (b: Buffer) => {
        stdout += b.toString();
        if (stdout.includes("session due-soon ended (end_reason: timer")) resolve();
      });
    });
    const exited = new Promise<number | null>((resolve) => child.on("close", resolve));
    try {
      await Promise.race([endedLine, new Promise((_, reject) => setTimeout(() => reject(new Error(`no end line: ${stdout}`)), 10_000))]);
    } finally {
      child.kill("SIGTERM");
    }
    assert.equal(await exited, 0);
    assert.match(stdout, /dev scheduler on demo-trackmelive-test: stopDueSessions every 1 s/);
    const session = await sessionOf("due-soon");
    assert.equal(session?.status, "stopped");
    assert.equal(session?.end_reason, "timer");
    // Ended at the timer, not at the tick that noticed it.
    assert.equal((session?.ended_at as Timestamp).toMillis(), (session?.stop_at as Timestamp).toMillis());
  });
});

describe("dev scheduler: a rebuilt lib", () => {
  it("exits with status 75 once the watched lib file changes and settles, so the launcher restarts it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dev-scheduler-"));
    const watched = join(dir, "index.js");
    writeFileSync(watched, "// stand-in for functions/lib/index.js\n");
    const child = spawn(process.execPath, [SCRIPT, "--interval", "1", "--allow-test-project"], {
      env: { PATH: process.env.PATH ?? "", ...emulatorEnv, DEV_SCHEDULER_WATCH: watched },
    });
    let stdout = "";
    const started = new Promise<void>((resolve) => {
      child.stdout.on("data", (b: Buffer) => {
        stdout += b.toString();
        if (stdout.includes("dev scheduler on")) resolve();
      });
    });
    const exited = new Promise<number | null>((resolve) => child.on("close", resolve));
    try {
      await started;
      // A rebuild that finished 3 s ago: changed, and settled.
      const t = (Date.now() - 3000) / 1000;
      utimesSync(watched, t, t);
      const code = await Promise.race([exited, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no restart: ${stdout}`)), 10_000))]);
      assert.equal(code, 75);
      assert.match(stdout, /functions\/lib was rebuilt; restarting to load it/);
    } finally {
      child.kill("SIGTERM");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("names sweepRetention in its start line once lib exports it, and says when it doesn't", async () => {
    const child = spawn(process.execPath, [SCRIPT, "--interval", "60", "--allow-test-project"], {
      env: { PATH: process.env.PATH ?? "", ...emulatorEnv },
    });
    let stdout = "";
    const started = new Promise<void>((resolve) => {
      child.stdout.on("data", (b: Buffer) => {
        stdout += b.toString();
        if (stdout.includes("dev scheduler on")) resolve();
      });
    });
    const exited = new Promise<number | null>((resolve) => child.on("close", resolve));
    await started;
    child.kill("SIGTERM");
    assert.equal(await exited, 0);
    const lib = (await import("../../functions/lib/index.js")) as Record<string, unknown>;
    if ("sweepRetention" in lib) assert.match(stdout, /, sweepRetention every 24 h/);
    else assert.match(stdout, /\(sweepRetention isn't built yet\)/);
  });
});
