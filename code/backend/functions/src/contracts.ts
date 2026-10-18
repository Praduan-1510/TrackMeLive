/**
 * The backend side of the shared contract.
 *
 * Types, enum values and FSD constants come from the shared schema
 * (code/shared/schema/schema.json, generated to TypeScript and copied into
 * src/shared/ by scripts/sync-schema.mjs). This file adds only what the server
 * needs on top: parsing untrusted callable input, and building the sharer
 * snapshot from a profile.
 *
 * Request parsing is hand-written rather than the shared validate(), because
 * the server trims names before checking them and turns a blank one into none.
 * The trimmed name is then held to the shared PersonName: 1–24 characters as
 * people see them (grapheme clusters), so it never rejects a name the app
 * allowed, at least one of them visible, and no control or text-direction
 * characters (x-decisions Q-NAME-LENGTH, Q-NAME-CHARACTERS).
 */
import {
  DEFAULT_MASCOT_COLOR,
  DEFAULT_MASCOT_ID,
  NAME_MAX_LENGTH,
  SESSION_LIMIT_MINUTES,
  STOP_MINUTES_VALUES,
  STOP_RULE_VALUES,
  PRECISION_VALUES,
  isMascotAccessory,
  isMascotColor,
  isMascotId,
  isPrecision,
  isStopMinutes,
  isStopRule,
  validate,
  type CreateSessionRequest,
  type SharerSnapshot,
} from "./shared/schema.js";

export type {
  CreateSessionRequest,
  CreateSessionResponse,
  SessionPrivateMeta,
  ShareSession,
  SharerSnapshot,
  StopRule,
  StopMinutes,
  User,
} from "./shared/schema.js";

export {
  APPROXIMATE_ROUNDING_METERS,
  INITIAL_PING_INTERVAL_SECONDS,
  LINK_TOKEN_BITS,
  LINK_TOKEN_LENGTH,
  SHARE_LINK_PATH,
} from "./shared/schema.js";

/** The hard limit on every session (FSD §4 "Auto-expiry"). */
export const SESSION_LIMIT_MS = SESSION_LIMIT_MINUTES * 60_000;

/** Names are 1–24 characters after trimming (FSD §4 "Sign up", "Who it's for"). */
export const NAME_MAX_CHARS = NAME_MAX_LENGTH;

/**
 * A bound on the raw name, checked before counting graphemes so a huge string
 * costs nothing. 32 UTF-16 units per character is above the longest emoji
 * sequence Unicode defines (a family of four with skin tones is 19), so no
 * 24-character name an app accepts comes near it.
 */
export const NAME_MAX_UTF16 = NAME_MAX_CHARS * 32;

const CALL_ID_MAX = 128;

/** The keys CreateSessionRequest allows; anything else is rejected. */
export const REQUEST_KEYS = [
  "stop_rule", "stop_minutes", "call_id", "share_back_allowed", "precision", "viewer_name",
] as const satisfies readonly (keyof CreateSessionRequest)[];
const requestKeys = new Set<string>(REQUEST_KEYS);

export interface FieldError {
  field: string;
  message: string;
}

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * Counts user-perceived characters (grapheme clusters), so an emoji or an
 * accented letter counts once. That is the loosest count any client uses (iOS
 * counts graphemes; Android and JSON Schema count UTF-16 units or code points).
 */
export function charCount(s: string): number {
  let n = 0;
  for (const _ of segmenter.segment(s)) n++;
  return n;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Trims and checks a person's name; returns null for a blank one. */
export function parsePersonName(raw: unknown): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, message: "must be a string or null" };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > NAME_MAX_UTF16 || charCount(trimmed) > NAME_MAX_CHARS) {
    return { ok: false, message: `must be at most ${NAME_MAX_CHARS} characters after trimming` };
  }
  if (validate("PersonName", trimmed).length > 0) {
    return { ok: false, message: "must have a letter, number, symbol or emoji, and no control or text-direction characters" };
  }
  return { ok: true, value: trimmed };
}

/**
 * Validates untrusted callable input against CreateSessionRequest. Unknown keys
 * are rejected (the schema sets additionalProperties: false), so the request can
 * never name an owner: the owner always comes from the caller's auth token.
 */
export function parseCreateSessionRequest(input: unknown): Validation<CreateSessionRequest> {
  if (!isRecord(input)) {
    return { ok: false, errors: [{ field: "(root)", message: "must be an object" }] };
  }
  const errors: FieldError[] = [];

  for (const key of Object.keys(input)) {
    if (!requestKeys.has(key)) errors.push({ field: key, message: "is not part of the request" });
  }

  // call_id: required; null for a manual share.
  const callId = input.call_id;
  if (callId !== null && !(typeof callId === "string" && callId.trim().length > 0 && callId.length <= CALL_ID_MAX)) {
    errors.push({ field: "call_id", message: `must be null or a non-empty string of at most ${CALL_ID_MAX} characters` });
  }
  const onCall = typeof callId === "string";

  // stop_rule, and stop_minutes only with the minutes rule.
  const stopRule = input.stop_rule;
  const stopMinutes = input.stop_minutes;
  if (!isStopRule(stopRule)) {
    errors.push({ field: "stop_rule", message: `must be one of ${STOP_RULE_VALUES.join(", ")}` });
  } else if (stopRule === "minutes") {
    if (!isStopMinutes(stopMinutes)) {
      errors.push({ field: "stop_minutes", message: `must be one of ${STOP_MINUTES_VALUES.join(", ")} when stop_rule is minutes` });
    }
  } else if (stopMinutes !== null) {
    errors.push({ field: "stop_minutes", message: "must be null unless stop_rule is minutes" });
  }
  if (stopRule === "call" && !onCall) {
    errors.push({ field: "stop_rule", message: "call needs a call_id; a manual share stops on a timer or at the limit" });
  }

  const shareBack = input.share_back_allowed;
  if (typeof shareBack !== "boolean") {
    errors.push({ field: "share_back_allowed", message: "must be a boolean" });
  }

  const precision = input.precision;
  if (!isPrecision(precision)) {
    errors.push({ field: "precision", message: `must be one of ${PRECISION_VALUES.join(", ")}` });
  }

  const name = parsePersonName(input.viewer_name);
  if (!name.ok) errors.push({ field: "viewer_name", message: name.message });

  if (errors.length > 0 || !name.ok || !isStopRule(stopRule) || !isPrecision(precision)) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      stop_rule: stopRule,
      stop_minutes: stopRule === "minutes" && isStopMinutes(stopMinutes) ? stopMinutes : null,
      call_id: onCall ? callId : null,
      // Share back must never outlive the call, so a manual share can't allow it.
      share_back_allowed: onCall && shareBack === true,
      precision,
      viewer_name: name.value,
    },
  };
}

/** The sharer snapshot from users/{uid}; null when the profile has no usable name. */
export function sharerSnapshotFrom(profile: Record<string, unknown>): SharerSnapshot | null {
  const name = parsePersonName(profile.name);
  if (!name.ok || name.value === null) return null;
  return {
    name: name.value,
    mascot_id: isMascotId(profile.mascot_id) ? profile.mascot_id : DEFAULT_MASCOT_ID,
    mascot_color: isMascotColor(profile.mascot_color) ? profile.mascot_color : DEFAULT_MASCOT_COLOR,
    mascot_accessory: isMascotAccessory(profile.mascot_accessory) ? profile.mascot_accessory : null,
  };
}
