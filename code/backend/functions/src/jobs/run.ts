/**
 * What the scheduled jobs share: their clock, cursor paging, and running one
 * transaction per document without one failure stopping the rest. Every job is
 * idempotent, so a failed run is simply done again by the next one.
 */
import { Timestamp, type Query, type QueryDocumentSnapshot } from "firebase-admin/firestore";
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

/** How many docs a job changed, and how many failed. */
export class Tally {
  changed = 0;
  failed = 0;

  /**
   * Runs task on every doc at once. A task resolves true when it changed the
   * doc; a task that throws is logged and counted, and the others carry on.
   */
  async settle(docs: readonly QueryDocumentSnapshot[], what: string, task: (doc: QueryDocumentSnapshot) => Promise<boolean>): Promise<void> {
    const results = await Promise.allSettled(docs.map(task));
    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        if (result.value) this.changed++;
      } else {
        this.failed++;
        logger.error(`${what} failed`, { doc: docs[i]?.ref.path, error: String(result.reason) });
      }
    });
  }

  /** Logs the outcome; throws when anything failed, so the run shows as failed. */
  finish(job: string): void {
    logger.info(`${job} done`, { changed: this.changed, failed: this.failed });
    if (this.failed > 0) throw new Error(`${job}: ${this.failed} failed`);
  }
}
