/**
 * Transactions on a session doc, which the sharer's app updates with every ping
 * (last_ping_at and last_fix_at, every 3–60 s; x-decisions Q-PING-WRITE).
 *
 * A transaction that reads the session doc holds it until it commits, and the
 * pings wait on it, or it loses to them and retries. So two rules for every
 * transaction here: only Firestore reads and writes go inside (nothing slow,
 * such as signing a token or calling another service), and contention that
 * outlasts the Admin SDK's retries is answered as unavailable ("try again"),
 * never internal.
 */
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError } from "firebase-functions/https";

/**
 * gRPC codes for "the transaction couldn't get or keep its locks": ABORTED (a
 * conflict, or the emulator's lock timeout), DEADLINE_EXCEEDED, UNAVAILABLE.
 */
const CONTENTION_CODES = new Set<unknown>([10, 4, 14, "aborted", "deadline-exceeded", "unavailable", "ABORTED", "DEADLINE_EXCEEDED", "UNAVAILABLE"]);

/** Whether an error from runTransaction is contention or a lost connection, which a retry can fix. */
export function isContention(error: unknown): boolean {
  if (error instanceof HttpsError) return false;
  return typeof error === "object" && error !== null && "code" in error && CONTENTION_CODES.has(error.code);
}

/**
 * db.runTransaction, with the Admin SDK's own retries, and contention that
 * outlasts them turned into unavailable. HttpsErrors thrown inside pass
 * through unchanged.
 */
export async function runContended<T>(db: Firestore, what: string, update: (tx: Transaction) => Promise<T>): Promise<T> {
  try {
    return await db.runTransaction(update);
  } catch (error) {
    if (!isContention(error)) throw error;
    logger.warn(`${what}: transaction contention after retries`, { error: String(error) });
    throw new HttpsError("unavailable", "That didn't go through. Try again.", { reason: "busy" });
  }
}
