/**
 * Who is calling: the caller checks the callables share.
 *
 * Sharers sign in with their phone number and a text code (FSD §4 "Sign up",
 * §5). A viewer's browser gets a custom sign-in from redeemLinkToken, scoped to
 * one session by the {sid, role} claims (shared ViewerClaims). It is never a
 * sharer.
 */
import { getAuth } from "firebase-admin/auth";
import { HttpsError, type CallableRequest } from "firebase-functions/https";
import { isViewerRole, type ViewerClaims } from "./shared/schema.js";

/** The verified sign-in on a callable request, if any. */
export type CallerAuth = CallableRequest["auth"];

/** The caller's sign-in, when it's a phone-number sign-in; throws otherwise. */
function sharerAuth(auth: CallerAuth): NonNullable<CallerAuth> {
  if (!auth) {
    throw new HttpsError("unauthenticated", "Sign in with your phone number first.");
  }
  if (auth.token.firebase?.sign_in_provider !== "phone") {
    throw new HttpsError("permission-denied", "Only a phone-number sign-in can do this.");
  }
  return auth;
}

/**
 * The uid of a phone-signed-in sharer, from the verified ID token alone.
 * Throws unauthenticated when signed out, and permission-denied for any other
 * sign-in (anonymous, or a viewer's custom token).
 *
 * Only deleteAccount should use this one: its Auth user goes last, so a repeat
 * call with the same token must still get through. Every other sharer
 * callable uses requireCurrentSharer.
 */
export function requireSharer(auth: CallerAuth): string {
  return sharerAuth(auth).uid;
}

/** What verifyIdToken's revocation check reports when a sign-in no longer stands. */
const ENDED_SIGN_IN_CODES = new Set(["auth/user-not-found", "auth/user-disabled", "auth/id-token-revoked"]);

const isEndedSignIn = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error
  && typeof error.code === "string" && ENDED_SIGN_IN_CODES.has(error.code);

/**
 * requireSharer, plus a check that the sign-in still stands. An ID token
 * stays valid for up to an hour after its Auth user is deleted, disabled or
 * signed out everywhere. verifyIdToken with checkRevoked reads the Auth user,
 * so those callers get unauthenticated, and deleteAccount can't be undone by a
 * late write. Any other failure, such as Auth being unreachable, is passed on
 * as it is, so an outage never looks like a sign-out.
 */
export async function requireCurrentSharer(auth: CallerAuth): Promise<string> {
  const signIn = sharerAuth(auth);
  try {
    await getAuth().verifyIdToken(signIn.rawToken, true);
  } catch (error) {
    if (isEndedSignIn(error)) throw new HttpsError("unauthenticated", "Your sign-in has ended. Sign in again.");
    throw error;
  }
  return signIn.uid;
}

/** A browser's existing viewer sign-in: its uid and the claims redeemLinkToken gave it. */
export interface BrowserSignIn {
  uid: string;
  claims: ViewerClaims;
}

/**
 * The caller's viewer sign-in, when it is a custom-token sign-in carrying
 * {sid, role}; null otherwise (signed out, a sharer, or any other sign-in).
 * The callable SDK sends the current ID token by itself, so a page that
 * redeems its link again presents the sign-in it already has.
 */
export function viewerSignInOf(auth: CallerAuth): BrowserSignIn | null {
  if (!auth || auth.token.firebase?.sign_in_provider !== "custom") return null;
  const claims: Record<string, unknown> = auth.token;
  const { sid, role } = claims;
  if (typeof sid !== "string" || sid.length === 0 || !isViewerRole(role)) return null;
  return { uid: auth.uid, claims: { sid, role } };
}
