/**
 * parseSaveProfileRequest, the built functions code (functions/lib) against the
 * shared schema: names counted as people see them, the mascot catalog's
 * accessory table, the typed settings, and unknown keys. No emulator needed;
 * profile.test.ts runs the callable end to end.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NAME_MAX_UTF16 } from "../../functions/lib/contracts.js";
import { parseSaveProfileRequest } from "../../functions/lib/profileRequest.js";
import {
  DEFAULT_STOP_VALUES,
  DEFAULT_USER_SETTINGS,
  MASCOT_ACCESSORY_VALUES,
  MASCOT_CATALOG,
  MASCOT_COLOR_VALUES,
  NAME_MAX_LENGTH,
  SCHEMA_DEFS,
  validate,
} from "../../../shared/schema/generated/ts/schema.ts";

const base = { name: "Alex", mascot_id: "fox", mascot_color: "original", mascot_accessory: null };

/** The fields parseSaveProfileRequest reported, in order. */
function errorFields(input: unknown): string[] {
  const r = parseSaveProfileRequest(input);
  assert.equal(r.ok, false, `expected ${JSON.stringify(input)} to be rejected`);
  return r.ok ? [] : r.errors.map((e) => e.field);
}

function accepted(input: unknown) {
  const r = parseSaveProfileRequest(input);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(validate("SaveProfileRequest", r.value), []);
  return r.value;
}

// Single characters as people see them, and how many UTF-16 units each takes.
const FAMILY_SKIN_TONES = "\u{1F9D1}\u{1F3FB}\u200D\u{1F9D1}\u{1F3FC}\u200D\u{1F9D2}\u{1F3FD}\u200D\u{1F9D2}\u{1F3FE}"; // 19 units
const SCOTLAND = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}"; // tag sequence, 14 units
const FLAG_IN = "\u{1F1EE}\u{1F1F3}"; // regional indicators, 4 units
const E_ACUTE = "é"; // e + combining acute, 2 units

describe("SaveProfileRequest: the shared contract the parser relies on", () => {
  it("names the profile fields, requires all but settings, and allows no other key", () => {
    const def = SCHEMA_DEFS.SaveProfileRequest;
    assert.deepEqual(Object.keys(def.properties).sort(), ["mascot_accessory", "mascot_color", "mascot_id", "name", "settings"]);
    assert.deepEqual([...def.required].sort(), ["mascot_accessory", "mascot_color", "mascot_id", "name"]);
    assert.equal(def.additionalProperties, false);
  });
});

describe("parseSaveProfileRequest: name", () => {
  it("trims it", () => {
    assert.equal(accepted({ ...base, name: "  Alex Rivera \n" }).name, "Alex Rivera");
  });

  it("takes 1 and 24 characters and refuses 25, counting what people see", () => {
    for (const ch of ["a", "\u{1F98A}", FAMILY_SKIN_TONES, SCOTLAND, FLAG_IN, E_ACUTE]) {
      assert.equal(accepted({ ...base, name: ch }).name, ch);
      const max = ch.repeat(NAME_MAX_LENGTH);
      assert.equal(accepted({ ...base, name: ` ${max} ` }).name, max, `24 × ${JSON.stringify(ch)}`);
      assert.deepEqual(errorFields({ ...base, name: ch.repeat(NAME_MAX_LENGTH + 1) }), ["name"], `25 × ${JSON.stringify(ch)}`);
    }
  });

  it("counts a mix of emoji and letters as people see it", () => {
    const name = `${FAMILY_SKIN_TONES} Ama ${FLAG_IN} Ren${E_ACUTE}e ${SCOTLAND}`; // 15 characters
    assert.equal(accepted({ ...base, name }).name, name);
  });

  it("refuses a blank, missing or non-string name", () => {
    for (const name of ["", "   ", "\n\t", "　", null, 7, ["Alex"]]) {
      assert.deepEqual(errorFields({ ...base, name }), ["name"], JSON.stringify(name));
    }
    const { name: _name, ...noName } = base;
    assert.deepEqual(errorFields(noName), ["name"]);
  });

  it("refuses a line break inside the name (shared PersonName)", () => {
    assert.deepEqual(errorFields({ ...base, name: "Al\nex" }), ["name"]);
  });

  it("refuses control characters, direction overrides and names with nothing visible (x-decisions Q-NAME-CHARACTERS)", () => {
    const bad = [
      "Al\u0000ex", "\u0007", "Al\tex", // control characters
      "\u202Exela", "Alex\u2066", // a right-to-left override, an isolate
      "\u200B", "\u200D", "\u2060", "\u200B\u200D", // invisible only
    ];
    for (const name of bad) assert.deepEqual(errorFields({ ...base, name }), ["name"], JSON.stringify(name));
    // A joiner inside an emoji or a name is fine; only a name of nothing but joiners isn't.
    accepted({ ...base, name: `Ama${FAMILY_SKIN_TONES}` });
  });

  it("turns away a huge string before counting it", () => {
    const r = parseSaveProfileRequest({ ...base, name: "a".repeat(NAME_MAX_UTF16 + 1) });
    assert.ok(!r.ok);
    assert.deepEqual(r.errors, [{ field: "name", message: `longer than ${NAME_MAX_LENGTH}` }]);
  });
});

describe("parseSaveProfileRequest: mascot, color and accessory", () => {
  it("takes every mascot in every color, with no accessory or any one it takes", () => {
    for (const m of MASCOT_CATALOG) {
      for (const mascot_color of MASCOT_COLOR_VALUES) {
        for (const mascot_accessory of [null, ...m.accessories]) {
          accepted({ ...base, mascot_id: m.id, mascot_color, mascot_accessory });
        }
      }
    }
  });

  it("refuses every accessory a mascot doesn't take", () => {
    let refused = 0;
    for (const m of MASCOT_CATALOG) {
      for (const accessory of MASCOT_ACCESSORY_VALUES.filter((a) => !m.accessories.includes(a))) {
        const r = parseSaveProfileRequest({ ...base, mascot_id: m.id, mascot_accessory: accessory });
        assert.ok(!r.ok, `${m.id} + ${accessory}`);
        assert.deepEqual(r.errors, [{ field: "mascot_accessory", message: `${m.id} doesn't take ${accessory}` }]);
        refused++;
      }
    }
    // astronaut takes none; robot, hero, ninja, detective and cowboy take one; neko and ace take two.
    assert.equal(refused, 3 + 5 * 2 + 2 * 1);
  });

  it("refuses unknown mascots, colors and accessories", () => {
    assert.deepEqual(errorFields({ ...base, mascot_id: "pikachu" }), ["mascot_id"]);
    assert.deepEqual(errorFields({ ...base, mascot_id: "Fox" }), ["mascot_id"]);
    assert.deepEqual(errorFields({ ...base, mascot_color: "teal" }), ["mascot_color"]);
    assert.deepEqual(errorFields({ ...base, mascot_accessory: "hat" }), ["mascot_accessory"]);
  });

  it("stores no accessory as null, never the prototype's 'none'", () => {
    assert.deepEqual(errorFields({ ...base, mascot_accessory: "none" }), ["mascot_accessory"]);
    const { mascot_accessory: _a, ...noAccessory } = base;
    assert.deepEqual(errorFields(noAccessory), ["mascot_accessory"]);
  });
});

describe("parseSaveProfileRequest: settings", () => {
  it("leaves settings out when none are sent", () => {
    assert.equal("settings" in accepted(base), false);
  });

  it("takes the whole typed settings, every default stop included", () => {
    assert.deepEqual(accepted({ ...base, settings: DEFAULT_USER_SETTINGS }).settings, DEFAULT_USER_SETTINGS);
    for (const default_stop of DEFAULT_STOP_VALUES) {
      accepted({ ...base, settings: { ...DEFAULT_USER_SETTINGS, default_stop, precision: "approximate", alert_expiry: false } });
    }
  });

  it("refuses partial settings, naming the missing key", () => {
    for (const key of Object.keys(DEFAULT_USER_SETTINGS)) {
      const partial: Record<string, unknown> = { ...DEFAULT_USER_SETTINGS };
      delete partial[key];
      assert.deepEqual(errorFields({ ...base, settings: partial }), [`settings.${key}`]);
    }
  });

  it("refuses unknown settings and wrong values", () => {
    const bad: [Record<string, unknown>, string][] = [
      [{ appearance: "dark" }, "settings.appearance"], // Appearance stays on the device (x-decisions Q-APPEARANCE)
      [{ precision: "exact" }, "settings.precision"],
      [{ default_stop: 45 }, "settings.default_stop"],
      [{ default_stop: "30" }, "settings.default_stop"],
      [{ share_back: "yes" }, "settings.share_back"],
      [{ alert_link_opened: null }, "settings.alert_link_opened"],
    ];
    for (const [change, field] of bad) {
      assert.deepEqual(errorFields({ ...base, settings: { ...DEFAULT_USER_SETTINGS, ...change } }), [field]);
    }
    assert.deepEqual(errorFields({ ...base, settings: null }), ["settings"]);
    assert.deepEqual(errorFields({ ...base, settings: [] }), ["settings"]);
  });
});

describe("parseSaveProfileRequest: the request itself", () => {
  it("refuses anything that isn't an object", () => {
    for (const input of [null, undefined, "Alex", 7, []]) {
      assert.deepEqual(errorFields(input), ["(root)"]);
    }
  });

  it("refuses the fields the server owns, and any other key", () => {
    for (const key of ["last_viewer_name", "active_session_id", "created_at", "updated_at", "user_id", "phone_number"]) {
      assert.deepEqual(errorFields({ ...base, [key]: null }), [key]);
    }
  });

  it("lists one error per bad field", () => {
    const fields = errorFields({ name: " ", mascot_id: "pikachu", mascot_color: "teal", mascot_accessory: "hat", extra: 1 });
    assert.deepEqual(fields.sort(), ["extra", "mascot_accessory", "mascot_color", "mascot_id", "name"]);
  });
});
