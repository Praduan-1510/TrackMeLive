/**
 * Parsing untrusted saveProfile input against the shared SaveProfileRequest
 * (code/shared/schema/schema.json).
 *
 * The shared validate() does the checking: required keys, no unknown keys, the
 * enums, the whole UserSettings, and the name as 1–24 grapheme clusters
 * (PersonName). This file adds only what a schema can't say: the name is
 * trimmed first, and the accessory must be one the mascot takes.
 */
import { NAME_MAX_UTF16, isRecord, type Validation } from "./contracts.js";
import { fieldErrors } from "./requestErrors.js";
import {
  NAME_MAX_LENGTH,
  mascotTakes,
  validate,
  type SaveProfileRequest,
} from "./shared/schema.js";

const isSaveProfileRequest = (value: unknown): value is SaveProfileRequest =>
  validate("SaveProfileRequest", value).length === 0;

/**
 * Validates untrusted callable input as a SaveProfileRequest, with the name
 * trimmed. Unknown keys are rejected, so the request can never set
 * active_session_id, last_viewer_name or the timestamps.
 */
export function parseSaveProfileRequest(input: unknown): Validation<SaveProfileRequest> {
  if (!isRecord(input)) {
    return { ok: false, errors: [{ field: "(root)", message: "must be an object" }] };
  }
  const rawName = input.name;
  // Turned away before counting graphemes, so a huge string costs nothing (same bound as createSession).
  if (typeof rawName === "string" && rawName.length > NAME_MAX_UTF16) {
    return { ok: false, errors: [{ field: "name", message: `longer than ${NAME_MAX_LENGTH}` }] };
  }
  const candidate = typeof rawName === "string" ? { ...input, name: rawName.trim() } : input;

  if (!isSaveProfileRequest(candidate)) {
    return { ok: false, errors: fieldErrors(validate("SaveProfileRequest", candidate)) };
  }
  if (!mascotTakes(candidate.mascot_id, candidate.mascot_accessory)) {
    return {
      ok: false,
      errors: [{ field: "mascot_accessory", message: `${candidate.mascot_id} doesn't take ${candidate.mascot_accessory}` }],
    };
  }
  return { ok: true, value: candidate };
}
