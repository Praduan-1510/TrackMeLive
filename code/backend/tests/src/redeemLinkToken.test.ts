/**
 * redeemLinkToken against the emulators. Each share is a real one: a phone
 * sign-in, saveProfile, then createSession. Each "browser" redeems the link
 * over the callable protocol and signs in with the custom token it gets back,
 * as the viewer page does.
 *
 * Covered: the first browser becomes the viewer and later ones watchers;
 * exactly one viewer when browsers race; a refresh keeps the uid and role;
 * can_share_back; the ended state; uniform not-found for bad tokens; and,
 * with Backend B's Firestore rules, what the minted sign-in can read.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  MAX_VIEWER_SIGN_INS,
  MIN_PING_SPACING_SECONDS,
  PING_ID_MAX_LENGTH,
  validate,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type RedeemLinkTokenResponse,
  type SharerSnapshot,
} from "../../../shared/schema/generated/ts/schema.ts";
import { claimsOf, providerOf, signInWithCustomToken } from "./authEmulator.ts";
import {
  FIRESTORE,
  PROJECT_ID,
  callFunction,
  clearAuth,
  clearFirestore,
  signInAnonymously,
  signInWithPhone,
  type CallableResult,
  type SignedIn,
} from "./emulators.ts";

let app: App;
let db: Firestore;
let phoneCounter = 0;

const sharerProfile = { name: "Alex", mascot_id: "neko", mascot_color: "rose", mascot_accessory: "glasses" } as const;
const SNAPSHOT: SharerSnapshot = { ...sharerProfile };

const callShare: CreateSessionRequest = {
  stop_rule: "call", stop_minutes: null, call_id: "call-1", share_back_allowed: true, precision: "precise",
};
const manualShare: CreateSessionRequest = {
  stop_rule: "minutes", stop_minutes: 30, call_id: null, share_back_allowed: false, precision: "precise",
};

interface Share {
  sharer: SignedIn;
  sessionId: string;
  token: string;
}

function ok<T>(r: CallableResult<T>): T {
  assert.ok(r.ok, JSON.stringify(r));
  return r.data;
}

/** A new sharer (phone sign-in, then saveProfile) starts a share and gets its link token. */
async function newShare(request: CreateSessionRequest = callShare): Promise<Share> {
  const sharer = await signInWithPhone(`+155555503${String(++phoneCounter).padStart(2, "0")}`);
  ok(await callFunction("saveProfile", sharerProfile, sharer.idToken));
  const created = ok(await callFunction<CreateSessionResponse>("createSession", request, sharer.idToken));
  return { sharer, sessionId: created.session_id, token: created.link_token };
}

const redeem = (token: unknown, browser?: SignedIn) =>
  callFunction<RedeemLinkTokenResponse>("redeemLinkToken", { link_token: token }, browser?.idToken);

/** A browser opens the link: it redeems the token, then signs in with the custom token. */
async function open(token: string, browser?: SignedIn): Promise<{ res: RedeemLinkTokenResponse; browser: SignedIn }> {
  const res = ok(await redeem(token, browser));
  assert.deepEqual(validate("RedeemLinkTokenResponse", res), []);
  return { res, browser: await signInWithCustomToken(res.custom_token) };
}

const sessionDoc = (id: string) => db.doc(`shareSessions/${id}`);
const metaDoc = (id: string) => db.doc(`shareSessions/${id}/private/meta`);
const signIns = async (id: string) => (await db.collection(`shareSessions/${id}/viewerSignIns`).get()).docs;

before(async () => {
  await clearFirestore();
  await clearAuth();
  app = initializeApp({ projectId: PROJECT_ID }, "redeemLinkToken-test");
  db = getFirestore(app);
});

after(async () => {
  if (app) await deleteApp(app);
});

describe("redeemLinkToken: viewer and watchers", () => {
  let share: Share;
  let viewer: SignedIn;
  let firstViewedAt: Timestamp;

  before(async () => {
    share = await newShare();
  });

  it("makes the first browser the viewer, records it, and sets first_viewed_at", async () => {
    assert.equal((await sessionDoc(share.sessionId).get()).get("first_viewed_at"), null);
    const t0 = Date.now();
    const { res, browser } = await open(share.token);
    viewer = browser;

    assert.equal(res.session_id, share.sessionId);
    assert.equal(res.role, "viewer");
    assert.equal(res.can_share_back, true);

    // The sign-in: a custom token for a v_<sessionId>_ uid with exactly {sid, role}.
    assert.match(browser.uid, new RegExp(`^v_${share.sessionId}_[A-Za-z0-9_-]{16}$`));
    assert.equal(providerOf(browser.idToken), "custom");
    const claims = claimsOf(browser.idToken);
    assert.equal(claims.sid, share.sessionId);
    assert.equal(claims.role, "viewer");

    const meta = (await metaDoc(share.sessionId).get()).data();
    assert.deepEqual(validate("SessionPrivateMeta", meta), []);
    assert.equal(meta?.viewer_uid, browser.uid);

    const session = (await sessionDoc(share.sessionId).get()).data();
    assert.deepEqual(validate("ShareSession", session), []);
    assert.ok(session?.first_viewed_at instanceof Timestamp);
    firstViewedAt = session.first_viewed_at;
    assert.ok(Math.abs(firstViewedAt.toMillis() - t0) < 10_000);

    const docs = await signIns(share.sessionId);
    assert.deepEqual(docs.map((d) => d.id), [browser.uid]);
    assert.deepEqual(validate("ViewerSignIn", docs[0]?.data()), []);
    assert.equal(docs[0]?.get("role"), "viewer");
  });

  it("makes a second browser a watcher that can't share back, and leaves the viewer and first_viewed_at alone", async () => {
    const { res, browser } = await open(share.token);
    assert.equal(res.role, "watcher");
    assert.equal(res.can_share_back, false);
    assert.notEqual(browser.uid, viewer.uid);
    assert.equal(claimsOf(browser.idToken).role, "watcher");

    assert.equal((await metaDoc(share.sessionId).get()).get("viewer_uid"), viewer.uid);
    assert.ok(firstViewedAt.isEqual((await sessionDoc(share.sessionId).get()).get("first_viewed_at") as Timestamp));
    const docs = await signIns(share.sessionId);
    assert.equal(docs.length, 2);
    assert.equal(docs.find((d) => d.id === browser.uid)?.get("role"), "watcher");
  });

  it("keeps the viewer's uid and role when its page refreshes, without a new sign-in record", async () => {
    const { res, browser } = await open(share.token, viewer);
    assert.equal(res.role, "viewer");
    assert.equal(res.can_share_back, true);
    assert.equal(browser.uid, viewer.uid);
    assert.equal((await signIns(share.sessionId)).length, 2);
    assert.ok(firstViewedAt.isEqual((await sessionDoc(share.sessionId).get()).get("first_viewed_at") as Timestamp));
  });

  it("keeps a watcher a watcher when its page refreshes", async () => {
    const watcher = (await open(share.token)).browser;
    const again = await open(share.token, watcher);
    assert.equal(again.res.role, "watcher");
    assert.equal(again.browser.uid, watcher.uid);
  });

  it("gives a browser signed in for another session a new uid for this one", async () => {
    const other = await newShare();
    const { res, browser } = await open(other.token, viewer);
    assert.equal(res.role, "viewer", "the first browser on the other session");
    assert.notEqual(browser.uid, viewer.uid);
    assert.equal(claimsOf(browser.idToken).sid, other.sessionId);
  });

  it("treats the sharer's own phone sign-in, or an anonymous one, as a new browser", async () => {
    for (const caller of [share.sharer, await signInAnonymously()]) {
      const { res, browser } = await open(share.token, caller);
      assert.equal(res.role, "watcher");
      assert.notEqual(browser.uid, caller.uid);
      assert.match(browser.uid, /^v_/);
    }
  });
});

describe("redeemLinkToken: two browsers at once", () => {
  it("makes exactly one of them the viewer", async () => {
    const share = await newShare();
    const results = (await Promise.all(Array.from({ length: 4 }, () => redeem(share.token)))).map(ok);
    const viewers = results.filter((r) => r.role === "viewer");
    assert.equal(viewers.length, 1, JSON.stringify(results.map((r) => r.role)));
    assert.equal(results.filter((r) => r.can_share_back).length, 1);

    const viewerUid = claimsOf((await signInWithCustomToken(viewers[0]!.custom_token)).idToken).sub;
    assert.equal((await metaDoc(share.sessionId).get()).get("viewer_uid"), viewerUid);
    const docs = await signIns(share.sessionId);
    assert.equal(docs.length, 4);
    assert.deepEqual(docs.filter((d) => d.get("role") === "viewer").map((d) => d.id), [viewerUid]);
  });
});

/**
 * The sharer's pings update the session doc every few seconds (last_ping_at,
 * last_fix_at), and redeem's transaction reads that doc. Signing a token inside
 * the transaction once held its lock long enough to time out (INTERNAL).
 */
describe("redeemLinkToken: while the sharer pings", () => {
  const base = `http://${FIRESTORE.host}:${FIRESTORE.port}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

  /** The real ping batch, over REST with the sharer's ID token, through the rules (x-decisions Q-PING-WRITE). */
  async function commitPing(share: Share, recordedAt: Date): Promise<number> {
    const name = (path: string) => `projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
    const res = await fetch(`${base}:commit`, {
      method: "POST",
      headers: { authorization: `Bearer ${share.sharer.idToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: name(`shareSessions/${share.sessionId}/pings/p${recordedAt.getTime()}`),
              fields: {
                lat: { doubleValue: 51.5 }, lng: { doubleValue: -0.12 }, accuracy_m: { doubleValue: 8 },
                recorded_at: { timestampValue: recordedAt.toISOString() },
              },
            },
            currentDocument: { exists: false },
          },
          {
            update: { name: name(`shareSessions/${share.sessionId}`), fields: { last_fix_at: { timestampValue: recordedAt.toISOString() } } },
            updateMask: { fieldPaths: ["last_fix_at"] },
            updateTransforms: [{ fieldPath: "last_ping_at", setToServerValue: "REQUEST_TIME" }],
          },
        ],
      }),
    });
    await res.arrayBuffer();
    return res.status;
  }

  /**
   * A ping batch as the SDKs send it: a write that loses to a transaction on the
   * session doc comes back ABORTED (409 over REST), and the SDKs' write stream
   * sends it again. Returns the final status and how many tries it took.
   */
  async function sendPing(share: Share, recordedAt: Date): Promise<{ status: number; tries: number }> {
    for (let tries = 1; ; tries++) {
      const status = await commitPing(share, recordedAt);
      if (status !== 409 || tries === 5) return { status, tries };
      await new Promise((r) => setTimeout(r, 100 * tries));
    }
  }

  it("never fails as internal, keeps one viewer, and every token it returns names the role it recorded", async () => {
    const share = await newShare();
    const t0 = Date.now() - 30_000;
    let pinging = true;
    const pingResults: { status: number; tries: number }[] = [];
    // About one ping a second, recorded 2 s apart, so it's in order whether or not step B is on.
    const pinger = (async () => {
      for (let i = 0; pinging; i++) {
        pingResults.push(await sendPing(share, new Date(t0 + i * MIN_PING_SPACING_SECONDS * 1000)));
        await new Promise((r) => setTimeout(r, 1000));
      }
    })();

    const failures: string[] = [];
    const browsers: { browser: SignedIn; role: string }[] = [];
    const tryOpen = async (browser?: SignedIn) => {
      const r = await redeem(share.token, browser);
      if (!r.ok) {
        // Contention past the retries may answer unavailable; nothing else may fail.
        if (r.code !== "UNAVAILABLE") failures.push(`${r.code}: ${r.message}`);
        return null;
      }
      const signedIn = await signInWithCustomToken(r.data.custom_token);
      const claims = claimsOf(signedIn.idToken);
      assert.equal(claims.sid, share.sessionId);
      assert.equal(claims.role, r.data.role, "the token names the role redeem returned");
      if (browser) {
        assert.equal(signedIn.uid, browser.uid, "a refresh keeps its uid");
      }
      return { browser: signedIn, role: r.data.role };
    };

    try {
      await new Promise((r) => setTimeout(r, 1500));
      // Six browsers open at once, then each refreshes four times, all in parallel.
      for (const opened of await Promise.all(Array.from({ length: 6 }, () => tryOpen()))) if (opened) browsers.push(opened);
      for (let round = 0; round < 4; round++) {
        const again = await Promise.all(browsers.map((b) => tryOpen(b.browser)));
        again.forEach((r, i) => r && assert.equal(r.role, browsers[i]!.role, "a refresh keeps its role"));
      }
    } finally {
      pinging = false;
      await pinger;
    }

    assert.deepEqual(failures, []);
    // Every ping lands, the way the apps' SDKs land them.
    assert.ok(pingResults.length >= 3 && pingResults.every((p) => p.status === 200), `pings: ${JSON.stringify(pingResults)}`);
    const docs = await signIns(share.sessionId);
    assert.equal(docs.filter((d) => d.get("role") === "viewer").length, 1, "exactly one viewer sign-in");
    assert.equal(browsers.filter((b) => b.role === "viewer").length, 1);
    assert.equal(docs.length, browsers.length, "one sign-in doc per browser that got a token");
    const viewerUid = browsers.find((b) => b.role === "viewer")!.browser.uid;
    assert.equal((await metaDoc(share.sessionId).get()).get("viewer_uid"), viewerUid);
  });
});

describe("redeemLinkToken: at most MAX_VIEWER_SIGN_INS browsers per session", () => {
  function assertFull(r: CallableResult<RedeemLinkTokenResponse>) {
    assert.equal(!r.ok && r.code, "RESOURCE_EXHAUSTED", JSON.stringify(r));
    assert.deepEqual(!r.ok && r.details, { reason: "too_many_viewers" });
  }

  it("turns away a new browser once the session has 10, and still lets those 10 refresh", async () => {
    assert.equal(MAX_VIEWER_SIGN_INS, 10);
    const share = await newShare();
    const browsers: SignedIn[] = [];
    for (let i = 0; i < MAX_VIEWER_SIGN_INS; i++) browsers.push((await open(share.token)).browser);
    assert.equal((await signIns(share.sessionId)).length, MAX_VIEWER_SIGN_INS);

    assertFull(await redeem(share.token));
    assertFull(await redeem(share.token, await signInAnonymously()));
    assert.equal((await signIns(share.sessionId)).length, MAX_VIEWER_SIGN_INS, "nothing recorded for the refused browsers");

    const viewerAgain = await open(share.token, browsers[0]);
    assert.equal(viewerAgain.res.role, "viewer");
    assert.equal(viewerAgain.browser.uid, browsers[0]!.uid);
    const watcherAgain = await open(share.token, browsers[MAX_VIEWER_SIGN_INS - 1]);
    assert.equal(watcherAgain.res.role, "watcher");
    assert.equal((await signIns(share.sessionId)).length, MAX_VIEWER_SIGN_INS);
  });

  it("gives the last two places to exactly two of four racing browsers", async () => {
    const share = await newShare();
    for (let i = 0; i < MAX_VIEWER_SIGN_INS - 2; i++) ok(await redeem(share.token));
    const results = await Promise.all(Array.from({ length: 4 }, () => redeem(share.token)));
    assert.equal(results.filter((r) => r.ok).length, 2, JSON.stringify(results.map((r) => (r.ok ? r.data.role : r.code))));
    for (const r of results.filter((r) => !r.ok)) assertFull(r);
    const docs = await signIns(share.sessionId);
    assert.equal(docs.length, MAX_VIEWER_SIGN_INS);
    assert.equal(docs.filter((d) => d.get("role") === "viewer").length, 1);

    // Once it has ended, a new browser gets the ended state, not the cap.
    await sessionDoc(share.sessionId).update({ status: "stopped", ended_at: Timestamp.now(), end_reason: "stopped" });
    const late = await redeem(share.token);
    assert.equal(!late.ok && late.code, "FAILED_PRECONDITION");
  });
});

describe("redeemLinkToken: can_share_back", () => {
  it("is false when the share started outside a call", async () => {
    assert.equal(ok(await redeem((await newShare(manualShare)).token)).can_share_back, false);
  });

  it("is false when the sharer turned share back off", async () => {
    assert.equal(ok(await redeem((await newShare({ ...callShare, share_back_allowed: false })).token)).can_share_back, false);
  });

  it("is false once the call has ended, though the timer keeps sharing going", async () => {
    const share = await newShare({ ...callShare, stop_rule: "minutes", stop_minutes: 30 });
    await sessionDoc(share.sessionId).update({ call_active: false, call_ended_at: Timestamp.now() });
    const res = ok(await redeem(share.token));
    assert.equal(res.role, "viewer");
    assert.equal(res.can_share_back, false);
  });
});

describe("redeemLinkToken: a session that has ended", () => {
  /** The ended state: failed-precondition with the sharer's snapshot, and nothing written. */
  async function assertEnded(share: Share, browser?: SignedIn) {
    const signInsBefore = (await signIns(share.sessionId)).length;
    const r = await redeem(share.token, browser);
    assert.equal(!r.ok && r.code, "FAILED_PRECONDITION", JSON.stringify(r));
    assert.deepEqual(!r.ok && r.details, { reason: "session_ended", sharer: SNAPSHOT });
    assert.equal((await signIns(share.sessionId)).length, signInsBefore, "no sign-in minted");
  }

  it("answers a stopped session with the ended state and no token", async () => {
    const share = await newShare();
    await sessionDoc(share.sessionId).update({ status: "stopped", ended_at: Timestamp.now(), end_reason: "stopped" });
    await assertEnded(share);
    assert.equal((await metaDoc(share.sessionId).get()).get("viewer_uid"), null);
    assert.equal((await sessionDoc(share.sessionId).get()).get("first_viewed_at"), null);
  });

  it("treats a session past expires_at as ended before the scheduled stop marks it", async () => {
    const share = await newShare();
    await sessionDoc(share.sessionId).update({ expires_at: Timestamp.fromMillis(Date.now() - 1000) });
    await assertEnded(share);
  });

  it("treats a session past stop_at as ended before the scheduled stop marks it", async () => {
    const share = await newShare(manualShare);
    await sessionDoc(share.sessionId).update({ stop_at: Timestamp.fromMillis(Date.now() - 1000) });
    await assertEnded(share);
  });

  it("still opens a session with seconds left before its limit or its timer", async () => {
    const limited = await newShare();
    await sessionDoc(limited.sessionId).update({ expires_at: Timestamp.fromMillis(Date.now() + 5000) });
    assert.equal((await open(limited.token)).res.role, "viewer");
    const timed = await newShare(manualShare);
    await sessionDoc(timed.sessionId).update({ stop_at: Timestamp.fromMillis(Date.now() + 5000) });
    assert.equal((await open(timed.token)).res.role, "viewer");
  });

  it("answers the viewer's own refresh after the end the same way", async () => {
    const share = await newShare();
    const { browser } = await open(share.token);
    await sessionDoc(share.sessionId).update({ status: "stopped", ended_at: Timestamp.now(), end_reason: "call" });
    await assertEnded(share, browser);
  });
});

describe("redeemLinkToken: tokens that don't lead to a session", () => {
  const notFoundMessages = new Set<string>();

  async function assertNotFound(token: unknown) {
    const r = await redeem(token);
    assert.equal(!r.ok && r.code, "NOT_FOUND", `${JSON.stringify(token)}: ${JSON.stringify(r)}`);
    assert.equal(!r.ok && r.details, undefined);
    if (!r.ok) notFoundMessages.add(r.message);
  }

  it("answers an unknown token with not-found", async () => {
    await assertNotFound("AAAAAAAAAAAAAAAAAAAAAA");
    await assertNotFound("abcdefghijklmnopqrstuv");
  });

  it("answers a malformed token with the same not-found", async () => {
    const real = (await newShare()).token;
    const stem = real.slice(0, 21);
    // Too short, too long, a space, and characters outside base64url.
    for (const token of ["", stem, `${real}A`, ` ${stem}`, `${stem}+`, `${stem}/`, `${stem}=`, `${stem}.`, `${stem}\n`]) {
      await assertNotFound(token);
    }
  });

  it("answers a token whose session is gone with the same not-found", async () => {
    const share = await newShare();
    await sessionDoc(share.sessionId).delete();
    await assertNotFound(share.token);
  });

  it("uses one message for every not-found", () => {
    assert.equal(notFoundMessages.size, 1, [...notFoundMessages].join(" | "));
  });

  it("refuses a request that isn't {link_token: string} as invalid-argument", async () => {
    const share = await newShare();
    const real = share.token;
    const bad: [unknown, string[]][] = [
      [null, ["(root)"]],
      ["token", ["(root)"]],
      [[real], ["(root)"]],
      [{}, ["link_token"]],
      [{ link_token: 7 }, ["link_token"]],
      [{ link_token: null }, ["link_token"]],
      [{ link_token: real, session_id: "s" }, ["session_id"]],
    ];
    for (const [data, fields] of bad) {
      const r = await callFunction("redeemLinkToken", data);
      assert.equal(!r.ok && r.code, "INVALID_ARGUMENT", JSON.stringify(data));
      assert.deepEqual(!r.ok && (r.details as { errors: { field: string }[] }).errors.map((e) => e.field), fields);
    }
    assert.equal((await metaDoc(share.sessionId).get()).get("viewer_uid"), null, "none of them counted as an open");
  });
});

/**
 * What the minted sign-in can do under Backend B's Firestore rules
 * (firestore.rules; rules.test.ts proves them with mock tokens). This proves
 * the real tokens line up with them. Firestore's REST API, with the browser's
 * ID token, stands in for the web SDK.
 */
describe("redeemLinkToken: the minted sign-in under the Firestore rules", () => {
  const base = `http://${FIRESTORE.host}:${FIRESTORE.port}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

  async function status(method: "GET" | "POST" | "PATCH", path: string, idToken: string, body?: unknown): Promise<number> {
    const res = await fetch(`${base}/${path}`, {
      method,
      headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    await res.arrayBuffer();
    return res.status;
  }
  const get = (path: string, who: SignedIn) => status("GET", path, who.idToken);
  const viewerPing = () => ({
    fields: {
      lat: { doubleValue: 51.5 },
      lng: { doubleValue: -0.12 },
      accuracy_m: { doubleValue: 12 },
      recorded_at: { timestampValue: new Date().toISOString() },
    },
  });

  let share: Share;
  let viewer: SignedIn;
  let watcher: SignedIn;

  before(async () => {
    share = await newShare();
    viewer = (await open(share.token)).browser;
    watcher = (await open(share.token)).browser;
    await db.collection(`shareSessions/${share.sessionId}/pings`).add({
      lat: 51.5, lng: -0.12, accuracy_m: 8, recorded_at: Timestamp.now(),
    });
  });

  it("lets the viewer and watchers read the live session and its pings", async () => {
    for (const who of [viewer, watcher]) {
      assert.equal(await get(`shareSessions/${share.sessionId}`, who), 200);
      assert.equal(await get(`shareSessions/${share.sessionId}/pings`, who), 200);
    }
  });

  it("never lets them read private/meta, viewerSignIns, the sharer's profile or another session", async () => {
    const other = await newShare();
    for (const who of [viewer, watcher]) {
      for (const path of [
        `shareSessions/${share.sessionId}/private/meta`,
        `shareSessions/${share.sessionId}/viewerSignIns`,
        `shareSessions/${share.sessionId}/viewerSignIns/${who.uid}`,
        `users/${share.sharer.uid}`,
        `shareSessions/${other.sessionId}`,
        `shareSessions/${other.sessionId}/pings`,
      ]) {
        assert.equal(await get(path, who), 403, `${claimsOf(who.idToken).role} reading ${path}`);
      }
    }
  });

  // Share my location: turn viewer_sharing on, then write viewer pings.
  const shareBackSwitch = (who: SignedIn) => status(
    "PATCH",
    `shareSessions/${share.sessionId}?updateMask.fieldPaths=viewer_sharing`,
    who.idToken,
    { fields: { viewer_sharing: { booleanValue: true } } },
  );

  it("lets only the viewer share back", async () => {
    assert.equal(await shareBackSwitch(watcher), 403);
    assert.equal(await shareBackSwitch(viewer), 200);
    assert.equal(await status("POST", `shareSessions/${share.sessionId}/viewerPings`, viewer.idToken, viewerPing()), 200);
    assert.equal(await status("POST", `shareSessions/${share.sessionId}/viewerPings`, watcher.idToken, viewerPing()), 403);
  });

  it("takes a viewer ping created over REST with the id left to the server, and still bounds an id it's given", async () => {
    // The rules check the id through request.resource.id; on such a create the
    // emulator can't evaluate the path's {pingId}, which once refused every one.
    const pings = `shareSessions/${share.sessionId}/viewerPings`;
    assert.equal(await shareBackSwitch(viewer), 200);
    assert.equal(await status("POST", pings, viewer.idToken, viewerPing()), 200);
    assert.equal(await status("POST", `${pings}?documentId=${"x".repeat(PING_ID_MAX_LENGTH)}`, viewer.idToken, viewerPing()), 200);
    assert.equal(await status("POST", `${pings}?documentId=${"x".repeat(PING_ID_MAX_LENGTH + 1)}`, viewer.idToken, viewerPing()), 403);
  });

  it("past expires_at, before the stop job marks it: the session doc still reads, for the ended state, and the pings don't", async () => {
    const ref = sessionDoc(share.sessionId);
    const { expires_at: expiresAt } = (await ref.get()).data()!;
    await ref.update({ expires_at: Timestamp.fromMillis(Date.now() - 1000) });
    try {
      for (const who of [viewer, watcher]) {
        // Still status active: the page reads it as ended from expires_at (x-decisions Q-READ-ENDED).
        assert.equal(await get(`shareSessions/${share.sessionId}`, who), 200);
        assert.equal(await get(`shareSessions/${share.sessionId}/pings`, who), 403);
      }
    } finally {
      await ref.update({ expires_at: expiresAt });
    }
  });

  it("after the end, keeps the session doc readable for the ended state and closes the pings", async () => {
    await sessionDoc(share.sessionId).update({ status: "stopped", ended_at: Timestamp.now(), end_reason: "stopped" });
    for (const who of [viewer, watcher]) {
      assert.equal(await get(`shareSessions/${share.sessionId}`, who), 200);
      assert.equal(await get(`shareSessions/${share.sessionId}/pings`, who), 403);
    }
    assert.equal(await status("POST", `shareSessions/${share.sessionId}/viewerPings`, viewer.idToken, viewerPing()), 403);
  });
});
