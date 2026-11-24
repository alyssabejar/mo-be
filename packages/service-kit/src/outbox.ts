import { asc, eq, isNull, sql } from "drizzle-orm";
import { envelope, type EventBus, type EventEnvelope } from "./bus";
import type { Database, Tx } from "./db";
import type { EventCatalog, Subject } from "./subjects";
import { outbox, processedEvents } from "./tables";

type Log = { error: (obj: unknown, msg?: string) => void };

/**
 * Transactional outbox. `emit` writes the event in the caller's transaction; the
 * relay publishes committed rows to the bus and marks them sent. A crash between
 * commit and publish only delays the event; NATS dedupes retries by event id.
 */
export class Outbox {
  private timer: NodeJS.Timeout | undefined;
  private draining: Promise<void> | undefined;
  private again = false;

  constructor(
    private db: Database<any>,
    private bus: EventBus,
    private log: Log,
  ) {}

  async emit<S extends Subject>(tx: Tx<any> | Database<any>, subject: S, householdId: string, data: EventCatalog[S], actorId?: string) {
    const env = envelope(subject, householdId, data, actorId);
    await tx.insert(outbox).values({ id: env.id, subject, envelope: env });
    this.kick();
    return env;
  }

  /** Publish soon. Called after emits; harmless if the transaction rolled back. */
  kick() {
    if (this.draining) {
      this.again = true;
      return;
    }
    this.draining = this.drain()
      .catch((err) => this.log.error({ err }, "outbox drain failed"))
      .finally(() => {
        this.draining = undefined;
        if (this.again) {
          this.again = false;
          this.kick();
        }
      });
  }

  start(intervalMs = 1000) {
    this.timer = setInterval(() => this.kick(), intervalMs);
    this.timer.unref();
    this.kick();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    await this.draining;
  }

  /** Resolves when nothing is left to publish (tests and graceful shutdown). */
  async flush() {
    for (let i = 0; i < 50; i++) {
      await this.draining;
      await this.drain();
      const [row] = await this.db.select({ n: sql<number>`count(*)::int` }).from(outbox).where(isNull(outbox.publishedAt));
      if (!row || row.n === 0) return;
    }
  }

  private async drain() {
    for (;;) {
      const sent = await this.db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(outbox)
          .where(isNull(outbox.publishedAt))
          .orderBy(asc(outbox.createdAt))
          .limit(100)
          .for("update", { skipLocked: true });
        for (const row of rows) {
          await this.bus.publish(row.envelope as EventEnvelope);
          await tx.update(outbox).set({ publishedAt: new Date() }).where(eq(outbox.id, row.id));
        }
        return rows.length;
      });
      if (sent < 100) return;
    }
  }
}

/**
 * Subscribe a handler that runs inside a transaction and at most once per
 * event id, so redelivery never applies an event twice.
 */
export async function consume(
  db: Database<any>,
  bus: EventBus,
  outboxRelay: Outbox,
  durable: string,
  subjects: string[],
  handler: (tx: Tx<any>, event: EventEnvelope<any>) => Promise<void>,
) {
  await bus.subscribe(durable, subjects, async (event) => {
    await db.transaction(async (tx) => {
      const fresh = await tx.insert(processedEvents).values({ eventId: event.id }).onConflictDoNothing().returning();
      if (!fresh.length) return;
      await handler(tx, event);
    });
    outboxRelay.kick();
  });
}
