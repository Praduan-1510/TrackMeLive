/**
 * The backend's side of the shared contract: the built functions code
 * (functions/lib, what the emulator runs) against the shared schema
 * (code/shared/schema/generated/ts/schema.ts, built from schema.json).
 * No emulator needed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  NAME_MAX_CHARS,
  REQUEST_KEYS,
  SESSION_LIMIT_MS,
  charCount,
  parseCreateSessionRequest,
} from "../../functions/lib/contracts.js";
import { NAME_MAX_LENGTH, SCHEMA_DEFS, SESSION_LIMIT_MINUTES, validate } from "../../../shared/schema/generated/ts/schema.ts";

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

  it("counts characters as people see them", () => {
    assert.equal(charCount("\u{1F469}\u{1F3FD}‍\u{1F9B1}"), 1); // one emoji, four code points
    assert.equal(charCount("é"), 1); // e + combining acute
    assert.equal(charCount("Mom"), 3);
  });
});
