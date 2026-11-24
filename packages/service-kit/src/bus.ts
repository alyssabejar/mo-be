import { randomUUID } from "node:crypto";
import { AckPolicy, connect, DeliverPolicy, RetentionPolicy, StorageType, StringCodec, type NatsConnection } from "nats";

/** What travels on the bus. `id` makes redelivery and outbox retries idempotent. */
export interface EventEnvelope<T = unknown> {
  id: string;
  subject: string;
  householdId: string;
  actorId?: string;
  occurredAt: string;
  data: T;
}

export type EventHandler = (event: EventEnvelope) => Promise<void>;

export interface EventBus {
  publish(event: EventEnvelope): Promise<void>;
  /** Durable subscription: each durable name gets every matching event at least once, in order. */
  subscribe(durable: string, subjects: string[], handler: EventHandler): Promise<void>;
  close(): Promise<void>;
}

export function envelope<T>(subject: string, householdId: string, data: T, actorId?: string): EventEnvelope<T> {
  return { id: randomUUID(), subject, householdId, ...(actorId ? { actorId } : {}), occurredAt: new Date().toISOString(), data };
}

/** NATS subject match with `*` (one token) and `>` (the rest). */
export function subjectMatches(pattern: string, subject: string): boolean {
  const p = pattern.split(".");
  const s = subject.split(".");
  for (let i = 0; i < p.length; i++) {
    if (p[i] === ">") return s.length > i;
    if (i >= s.length) return false;
    if (p[i] !== "*" && p[i] !== s[i]) return false;
  }
  return p.length === s.length;
}

// ---------------------------------------------------------------------------

export const STREAM = "MAMAMO";
/** Every subject family the services publish. The stream captures all of them. */
export const STREAM_SUBJECTS = ["identity.>", "meal.>", "errand.>", "staff.>", "reminder.>", "supply.>", "bill.>", "parcel.>", "notification.>"];

/** NATS JetStream: one stream, one durable pull consumer per (service, purpose). */
export async function natsBus(opts: { servers: string; name: string; log?: (msg: string, err?: unknown) => void }): Promise<EventBus> {
  const nc: NatsConnection = await connect({ servers: opts.servers, name: opts.name });
  const jsm = await nc.jetstreamManager();
  const js = nc.jetstream();
  const sc = StringCodec();
  const log = opts.log ?? (() => {});

  const streamConfig = {
    name: STREAM,
    subjects: STREAM_SUBJECTS,
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    max_age: 30 * 24 * 3600 * 1e9, // nanoseconds: 30 days
    duplicate_window: 10 * 60 * 1e9, // dedupe outbox retries by event id for 10 minutes
  };
  try {
    await jsm.streams.info(STREAM);
    await jsm.streams.update(STREAM, streamConfig);
  } catch {
    await jsm.streams.add(streamConfig);
  }

  const loops: Promise<void>[] = [];
  let closing = false;

  return {
    async publish(event) {
      await js.publish(event.subject, sc.encode(JSON.stringify(event)), { msgID: event.id });
    },
    async subscribe(durable, subjects, handler) {
      const config = {
        durable_name: durable,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.All,
        filter_subjects: subjects,
        ack_wait: 30 * 1e9,
        max_ack_pending: 1, // one at a time keeps per-consumer ordering
      };
      try {
        await jsm.consumers.info(STREAM, durable);
        await jsm.consumers.update(STREAM, durable, config);
      } catch {
        await jsm.consumers.add(STREAM, config);
      }
      const consumer = await js.consumers.get(STREAM, durable);
      const messages = await consumer.consume();
      loops.push(
        (async () => {
          for await (const m of messages) {
            if (closing) break;
            try {
              await handler(JSON.parse(sc.decode(m.data)) as EventEnvelope);
              m.ack();
            } catch (err) {
              log(`handler ${durable} failed on ${m.subject}; retrying`, err);
              m.nak(5_000);
            }
          }
        })(),
      );
    },
    async close() {
      closing = true;
      await nc.drain();
      await Promise.allSettled(loops);
    },
  };
}

// ---------------------------------------------------------------------------

/**
 * In-process bus for tests and for running every service in one process
 * (`pnpm dev:all`). Same delivery contract: ordered, at-least-once, per durable.
 */
export function memoryBus(log: (msg: string, err?: unknown) => void = () => {}): EventBus & { idle(): Promise<void> } {
  type Sub = { durable: string; subjects: string[]; handler: EventHandler; queue: Promise<void> };
  const subs = new Map<string, Sub>();
  const history: EventEnvelope[] = [];

  const deliver = (sub: Sub, event: EventEnvelope) => {
    sub.queue = sub.queue.then(async () => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          await sub.handler(structuredClone(event));
          return;
        } catch (err) {
          log(`handler ${sub.durable} failed on ${event.subject} (attempt ${attempt})`, err);
          await new Promise((r) => setTimeout(r, 20 * attempt));
        }
      }
    });
  };

  return {
    async publish(event) {
      if (history.some((e) => e.id === event.id)) return; // msgID dedupe, like JetStream
      history.push(event);
      for (const sub of subs.values()) if (sub.subjects.some((p) => subjectMatches(p, event.subject))) deliver(sub, event);
    },
    async subscribe(durable, subjects, handler) {
      const sub: Sub = { durable, subjects, handler, queue: Promise.resolve() };
      subs.set(durable, sub);
      // Replay history, as a new durable consumer with DeliverPolicy.All would.
      for (const event of history) if (subjects.some((p) => subjectMatches(p, event.subject))) deliver(sub, event);
    },
    async close() {
      await this.idle();
    },
    /** Resolves once every queued delivery has run. */
    async idle() {
      let before = -1;
      while (before !== history.length) {
        before = history.length;
        await Promise.all([...subs.values()].map((s) => s.queue));
      }
    },
  };
}
