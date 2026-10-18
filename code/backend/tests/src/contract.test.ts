/**
 * The backend's side of the shared contract: the built functions code
 * (functions/lib, what the emulator runs) against the shared schema
 * (code/shared/schema/generated/ts/schema.ts, built from schema.json).
 * No emulator needed.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  NAME_MAX_CHARS,
  REQUEST_KEYS,
  SESSION_LIMIT_MS,
  charCount,
  parseCreateSessionRequest,
} from "../../functions/lib/contracts.js";
import { NAME_MAX_LENGTH, SCHEMA_DEFS, SESSION_LIMIT_MINUTES, validate } from "../../../shared/schema/generated/ts/schema.ts";
import { checkedViewerOrigin } from "../../functions/lib/viewerOrigin.js";

const SHARED_TS = new URL("../../../shared/schema/generated/ts/schema.ts", import.meta.url);
const FUNCTIONS_COPY = new URL("../../functions/src/shared/schema.ts", import.meta.url);

describe("the functions build uses the current shared schema", () => {
  it("functions/src/shared/schema.ts is an exact copy of the generated file", () => {
    assert.equal(readFileSync(FUNCTIONS_COPY, "utf8"), readFileSync(SHARED_TS, "utf8"), "run: npm --prefix functions run sync:schema");
  });

  it("the request keys are CreateSessionRequest's properties", () => {
    const def = SCHEMA_DEFS.CreateSessionRequest;
    assert.deepEqual([...REQUEST_KEYS].sort(), Object.keys(def.properties).sort());
    assert.equal(def.additionalProperties, false);
  });

  it("the name limit and the session limit", () => {
    assert.equal(NAME_MAX_CHARS, NAME_MAX_LENGTH);
    assert.equal(SESSION_LIMIT_MS, SESSION_LIMIT_MINUTES * 60_000);
  });
});

describe("parseCreateSessionRequest", () => {
  const base = { stop_rule: "minutes", stop_minutes: 30, call_id: null, share_back_allowed: false, precision: "precise" };

  it("accepts a manual share, a call share and the limit, and its output passes the shared validator", () => {
    for (const req of [
      base,
      { ...base, stop_rule: "call", stop_minutes: null, call_id: "c1", share_back_allowed: true },
      { ...base, stop_rule: "limit", stop_minutes: null, viewer_name: "Mom" },
    ]) {
      const r = parseCreateSessionRequest(req);
      assert.ok(r.ok, JSON.stringify(req));
      assert.deepEqual(validate("CreateSessionRequest", r.value), []);
    }
  });

  it("forces share back off without a call", () => {
    const r = parseCreateSessionRequest({ ...base, share_back_allowed: true });
    assert.ok(r.ok);
    assert.equal(r.value.share_back_allowed, false);
  });

  it("requires every required key", () => {
    for (const key of SCHEMA_DEFS.CreateSessionRequest.required) {
      const missing: Record<string, unknown> = { ...base };
      delete missing[key];
      assert.equal(parseCreateSessionRequest(missing).ok, false, `missing ${key}`);
    }
  });

  it("rejects stop_minutes with a rule other than minutes", () => {
    assert.equal(parseCreateSessionRequest({ ...base, stop_rule: "limit" }).ok, false);
  });

  it("trims the viewer name and treats blank as none", () => {
    const r = parseCreateSessionRequest({ ...base, viewer_name: "  Mom  " });
    assert.ok(r.ok);
    assert.equal(r.value.viewer_name, "Mom");
    const blank = parseCreateSessionRequest({ ...base, viewer_name: "   " });
    assert.ok(blank.ok);
    assert.equal(blank.value.viewer_name, null);
  });

  describe("holds names to the shared PersonName", () => {
    const named = (viewer_name: string) => parseCreateSessionRequest({ ...base, viewer_name });
    const accepted = (name: string) => {
      const r = named(name);
      assert.ok(r.ok, JSON.stringify(name));
      assert.equal(r.value.viewer_name, name);
    };

    it("accepts an emoji-only name, an Arabic name, and 24 family emoji", () => {
      accepted("\u{1F98A}");
      accepted("مريم");
      accepted("\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}".repeat(24));
    });

    it("refuses invisible names, control characters and text-direction overrides", () => {
      for (const name of ["\u200B\u200D\u2060", "Mom\u202E", "\u202Emo\u043C", "Al\u2066ex\u2069", "Mo\tm", "Mo\u0007m", "..."]) {
        const r = named(name);
        assert.ok(!r.ok, JSON.stringify(name));
        assert.deepEqual(r.errors.map((e) => e.field), ["viewer_name"]);
      }
    });

    it("is the same rule saveProfile's schema check uses", () => {
      for (const name of ["\u{1F98A}", "مريم", "\u200B\u200D\u2060", "Mom\u202E", "Mo\tm"]) {
        assert.equal(validate("PersonName", name).length === 0, named(name).ok, JSON.stringify(name));
      }
    });
  });

  it("counts characters as people see them", () => {
    assert.equal(charCount("\u{1F469}\u{1F3FD}\u200D\u{1F9B1}"), 1); // one emoji, four code points
    assert.equal(charCount("é"), 1); // e + combining acute
    assert.equal(charCount("Mom"), 3);
  });
});

describe("VIEWER_ORIGIN: a local origin only ever on a demo- project", () => {
  it("a demo project may use the viewer's dev server, http or https", () => {
    assert.equal(checkedViewerOrigin("http://localhost:5173", "demo-trackmelive"), "http://localhost:5173");
    assert.equal(checkedViewerOrigin("http://127.0.0.1:5050/", "demo-trackmelive-test"), "http://127.0.0.1:5050");
    assert.equal(checkedViewerOrigin("https://trackme.live/s/", "demo-x"), "https://trackme.live");
  });

  it("any other project must be https, and never a local host", () => {
    assert.equal(checkedViewerOrigin("https://trackme.live", "trackmelive-prod"), "https://trackme.live");
    assert.equal(checkedViewerOrigin("https://trackmelive.web.app/", "trackmelive-prod"), "https://trackmelive.web.app");
    for (const local of [
      "http://localhost:5173", "https://localhost:5173", "https://127.0.0.1", "https://[::1]:443", "https://0.0.0.0",
      "https://viewer.localhost", "http://trackme.live",
    ]) {
      assert.throws(() => checkedViewerOrigin(local, "trackmelive-prod"), /must be an https origin that isn't local/, local);
    }
    // No project id at all is treated as a real project.
    assert.throws(() => checkedViewerOrigin("http://localhost:5173", ""));
  });

  it("refuses what isn't an http(s) URL, on any project", () => {
    for (const bad of ["", "localhost:5173", "ftp://trackme.live", "javascript:alert(1)"]) {
      assert.throws(() => checkedViewerOrigin(bad, "demo-trackmelive"), Error, bad);
    }
  });

  it("every functions/.env.<project> file passes, so a real project's file can't hold a local origin", () => {
    const dir = new URL("../../functions/", import.meta.url);
    const files = readdirSync(dir).filter((f) => /^\.env\.[a-z0-9-]+$/.test(f) && f !== ".env.local");
    assert.ok(files.includes(".env.demo-trackmelive"));
    for (const file of files) {
      const project = file.slice(".env.".length);
      const origin = /^VIEWER_ORIGIN=(.*)$/m.exec(readFileSync(new URL(file, dir), "utf8"))?.[1]?.trim();
      assert.ok(origin, `${file} sets VIEWER_ORIGIN`);
      assert.doesNotThrow(() => checkedViewerOrigin(origin, project), file);
    }
  });
});

describe("tests/package.json: every test file is in a scoped script too", () => {
  it("test:contract, test:rules, test:functions and test:auth together list every src/*.test.ts", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
    const listed = new Set(
      ["test:contract", "test:rules", "test:functions", "test:auth"].flatMap((k) => (pkg.scripts[k] ?? "").split(/\s+/).filter((w) => w.endsWith(".test.ts"))),
    );
    const files = readdirSync(new URL(".", import.meta.url)).filter((f) => f.endsWith(".test.ts")).map((f) => `src/${f}`);
    assert.deepEqual(files.filter((f) => !listed.has(f)), [], "add these to a script in tests/package.json");
  });
});
