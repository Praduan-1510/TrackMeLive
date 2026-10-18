/**
 * What the scheduled jobs share: their clock, cursor paging, and running one
 * transaction per document without one failure stopping the rest. Every job is
 * idempotent, so a failed run is simply done again by the next one.
 */
import { Timestamp, type BulkWriter, type DocumentReference, type Query, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import type { ScheduledEvent } from "firebase-functions/scheduler";

/** Sessions handled per query page. */
const PAGE_SIZE = 100;

/** The job's clock: the time Cloud Scheduler set for this run (the execution time when run by hand). */
export function runTime(event: ScheduledEvent): Timestamp {
  return Timestamp.fromDate(new Date(event.scheduleTime));
}

export function minus(t: Timestamp, ms: number): Timestamp {
  return Timestamp.fromMillis(t.toMillis() - ms);
}

/**
 * Calls handle with each page of the query, in order, until it runs out. Pages
 * follow a cursor, so docs that handle changes (and that stop matching) never
 * make a page repeat or skip.
 */
export async function forEachPage(query: Query, handle: (docs: QueryDocumentSnapshot[]) => Promise<void>): Promise<void> {
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    const page = await (cursor ? query.startAfter(cursor) : query).limit(PAGE_SIZE).get();
    if (page.empty) return;
    await handle(page.docs);
    if (page.size < PAGE_SIZE) return;
    cursor = page.docs[page.size - 1];
  }
}

/** gRPC NOT_FOUND and FAILED_PRECONDITION, as Firestore errors carry them in `code`. */
const NOT_FOUND = 5;
const FAILED_PRECONDITION = 9;
const codeOf = (error: unknown): unknown => (typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined);

/**
 * For a write whose doc may be gone or changed by a job running at the same
 * time (the purge deleting a session the cleanup is marking, or an app
 * rewriting a device the sweep is deleting): that write simply has nothing
 * left to do. Resolves false then; any other error is passed on.
 */
export function unlessGoneOrChanged(write: Promise<unknown>): Promise<boolean> {
  return write.then(
    () => true,
    (error: unknown) => {
      const code = codeOf(error);
      if (code === NOT_FOUND || code === FAILED_PRECONDITION) return false;
      throw error;
    },
  );
}

/** How many docs a job changed, and how many failed. */
export class Tally {
  changed = 0;
  failed = 0;

  /**
   * Runs task on every doc at once. A task resolves true when it changed the
   * doc; a task that throws is logged and counted, and the others carry on.
   */
  async settle(docs: readonly QueryDocumentSnapshot[], what: string, task: (doc: QueryDocumentSnapshot) => Promise<boolean>): Promise<void> {
    this.record(docs.map((doc) => doc.ref), what, await Promise.allSettled(docs.map(task)));
  }

  /**
   * Queues write for each doc on the BulkWriter, flushes it, and counts the
   * outcomes as settle does. BulkWriter sends a part-filled batch only when
   * flushed, so the flush comes before waiting on the writes.
   */
  async bulk(writer: BulkWriter, refs: readonly DocumentReference[], what: string, write: (ref: DocumentReference) => Promise<boolean>): Promise<void> {
    const writes = refs.map(write);
    await writer.flush();
    this.record(refs, what, await Promise.allSettled(writes));
  }

  private record(refs: readonly DocumentReference[], what: string, results: PromiseSettledResult<boolean>[]): void {
    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        if (result.value) this.changed++;
      } else {
        this.failed++;
        logger.error(`${what} failed`, { doc: refs[i]?.path, error: String(result.reason) });
      }
    });
  }

  /** Logs the outcome; throws when anything failed, so the run shows as failed. */
  finish(job: string): void {
    logger.info(`${job} done`, { changed: this.changed, failed: this.failed });
    if (this.failed > 0) throw new Error(`${job}: ${this.failed} failed`);
  }
}
