/**
 * The session callables' requests and failures. Requests are checked with the
 * shared schema (exact keys, the types it lists), plus a session id that can't
 * reach any other document path.
 */
import { HttpsError } from "firebase-functions/https";
import type { FieldError } from "../contracts.js";
import {
  validate,
  type DiscardSessionRequest,
  type ReportCallActiveRequest,
  type ReportCallEndedRequest,
  type StopSessionRequest,
} from "../shared/schema.js";

interface Requests {
  StopSessionRequest: StopSessionRequest;
  ReportCallEndedRequest: ReportCallEndedRequest;
  ReportCallActiveRequest: ReportCallActiveRequest;
  DiscardSessionRequest: DiscardSessionRequest;
}

/** Firestore auto-ids (what createSession makes) and the like; never a '/'. */
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The request, or invalid-argument with details.errors[] {field, message}, like createSession. */
export function parseRequest<D extends keyof Requests>(def: D, input: unknown): Requests[D] {
  const errors: FieldError[] = validate(def, input).map((issue) => ({
    field: issue.path === "$" ? "(root)" : issue.path.replace(/^\$\./, ""),
    message: issue.message,
  }));
  if (errors.length === 0) {
    const request = input as Requests[D];
    if (SESSION_ID.test(request.session_id)) return request;
    errors.push({ field: "session_id", message: "is not a session id" });
  }
  throw new HttpsError("invalid-argument", "The request isn't valid.", { errors });
}

/** Why a session callable can't do what was asked: failed-precondition with details {reason}. */
export type Refusal = "no_call" | "call_mismatch" | "call_ended" | "session_ended" | "link_opened";

export function refuse(reason: Refusal, message: string): HttpsError {
  return new HttpsError("failed-precondition", message, { reason });
}

/** The session's own call: refused for a manual share or for another call. */
export function requireSessionCall(sessionCallId: string | null, callId: string): void {
  if (sessionCallId === null) throw refuse("no_call", "This share isn't tied to a call.");
  if (sessionCallId !== callId) throw refuse("call_mismatch", "That isn't the call this share started with.");
}
