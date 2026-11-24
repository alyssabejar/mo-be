import type { LiveTopic } from "@mamamo/contracts";
import type { FastifyBaseLogger, FastifyReply } from "fastify";
import type pg from "pg";

export const LIVE_CHANNEL = "mamamo_live";

export interface LiveMessage {
  householdId: string;
  topics: LiveTopic[];
}

/**
 * Server-Sent Events hub. The projection consumer calls pg_notify inside its
 * transaction, so every calendar replica hears about a change only after the read
 * model has it, and pushes it to its own connected browsers.
 */
export class LiveHub {
  private clients = new Map<string, Set<FastifyReply>>();
  private listener: pg.PoolClient | undefined;
  private heartbeat: NodeJS.Timeout | undefined;

  constructor(private log: FastifyBaseLogger) {}

  async start(pool: pg.Pool) {
    this.listener = await pool.connect();
    this.listener.on("notification", (n) => {
      if (n.channel !== LIVE_CHANNEL || !n.payload) return;
      try {
        this.broadcast(JSON.parse(n.payload) as LiveMessage);
      } catch (err) {
        this.log.warn({ err }, "bad live payload");
      }
    });
    await this.listener.query(`LISTEN ${LIVE_CHANNEL}`);
    this.heartbeat = setInterval(() => {
      for (const set of this.clients.values()) for (const r of set) r.raw.write(": keep-alive\n\n");
    }, 25_000);
    this.heartbeat.unref();
  }

  add(householdId: string, reply: FastifyReply) {
    let set = this.clients.get(householdId);
    if (!set) this.clients.set(householdId, (set = new Set()));
    set.add(reply);
    reply.raw.on("close", () => set!.delete(reply));
  }

  broadcast(msg: LiveMessage) {
    const set = this.clients.get(msg.householdId);
    if (!set?.size) return;
    const frame = `event: change\ndata: ${JSON.stringify({ topics: msg.topics })}\n\n`;
    for (const r of set) r.raw.write(frame);
  }

  async stop() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const set of this.clients.values()) for (const r of set) r.raw.end();
    if (this.listener) {
      await this.listener.query(`UNLISTEN ${LIVE_CHANNEL}`).catch(() => undefined);
      this.listener.release();
    }
  }
}
