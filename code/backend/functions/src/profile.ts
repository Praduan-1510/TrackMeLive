import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/https";
import { requireCurrentSharer } from "./auth.js";
import { parseSaveProfileRequest } from "./profileRequest.js";
import {
  DEFAULT_USER_SETTINGS,
  docPaths,
  validate,
  type SaveProfileResponse,
  type User,
} from "./shared/schema.js";

const isUser = (value: unknown): value is User => validate("User", value).length === 0;

/** The stored profile as the callable returns it: the same fields, with times in epoch ms. */
function profileResponse(user: User): SaveProfileResponse {
  return {
    name: user.name,
    mascot_id: user.mascot_id,
    mascot_color: user.mascot_color,
    mascot_accessory: user.mascot_accessory,
    last_viewer_name: user.last_viewer_name,
    settings: user.settings,
    active_session_id: user.active_session_id,
    created_at: user.created_at.toMillis(),
    updated_at: user.updated_at.toMillis(),
  };
}

/**
 * Creates or updates the caller's profile, users/{uid} (FSD §4 "Sign up",
 * "Settings"; §6).
 *
 * The app sends the whole profile it shows: name, mascot, color, accessory
 * and, optionally, settings. In one transaction:
 *  - a new profile gets every User field: settings default to
 *    DEFAULT_USER_SETTINGS, last_viewer_name and active_session_id start null,
 *    and created_at and updated_at are the server time;
 *  - an existing profile gets the fields sent and a new updated_at. The stored
 *    settings stay when none are sent, and created_at, last_viewer_name and
 *    active_session_id (function-owned) are never touched.
 * Returns the profile as stored. The phone number stays in Firebase
 * Authentication and is never written here (FSD §8). A sign-in whose Auth user
 * was deleted, disabled or revoked is refused (requireCurrentSharer), so a
 * late save can't bring back a deleted account.
 */
export const saveProfile = onCall<unknown, Promise<SaveProfileResponse>>(async (request) => {
  const uid = await requireCurrentSharer(request.auth);

  const parsed = parseSaveProfileRequest(request.data);
  if (!parsed.ok) {
    throw new HttpsError("invalid-argument", "The profile isn't valid.", { errors: parsed.errors });
  }
  const { settings, ...identity } = parsed.value;

  const db = getFirestore();
  const ref = db.doc(docPaths.user(uid));
  const created = await db.runTransaction(async (tx) => {
    const now = FieldValue.serverTimestamp();
    if ((await tx.get(ref)).exists) {
      tx.update(ref, { ...identity, ...(settings ? { settings } : {}), updated_at: now });
      return false;
    }
    const profile: User<FieldValue> = {
      ...identity,
      last_viewer_name: null,
      settings: settings ?? DEFAULT_USER_SETTINGS,
      active_session_id: null,
      created_at: now,
      updated_at: now,
    };
    tx.create(ref, profile);
    return true;
  });

  const stored: unknown = (await ref.get()).data();
  if (!isUser(stored)) {
    logger.error("users doc doesn't match the shared User schema", { uid, issues: validate("User", stored) });
    throw new HttpsError("internal", "Your profile couldn't be saved.");
  }
  logger.info(created ? "profile created" : "profile updated", { uid });
  return profileResponse(stored);
});
