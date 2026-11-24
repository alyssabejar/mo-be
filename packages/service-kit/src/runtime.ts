import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { createApp } from "./app";
import { jwksVerifier, type TokenVerifier } from "./auth";
import { memoryBus, natsBus, type EventBus } from "./bus";
import { openDatabase, runMigrations, type Database } from "./db";
import { Outbox } from "./outbox";
import type { Pool } from "pg";

export const DEFAULT_ISSUER = "mamamo-identity";
export const DEFAULT_AUDIENCE = "mamamo";

export interface ServiceContext<S extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  db: Database<S>;
  pool: Pool;
  bus: EventBus;
  outbox: Outbox;
  log: FastifyBaseLogger;
  env: NodeJS.ProcessEnv;
}

export interface ServiceModule<S extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  schema: S;
  migrationsFolder: string;
  /** Runs after the database is migrated, before routes are registered. */
  init?(ctx: ServiceContext<S>): Promise<void>;
  /** Identity verifies its own tokens locally; everyone else uses its JWKS. */
  verifier?: (ctx: ServiceContext<S>) => TokenVerifier | Promise<TokenVerifier>;
  routes(app: FastifyInstance, ctx: ServiceContext<S>): void | Promise<void>;
  consumers?(ctx: ServiceContext<S>): Promise<void>;
  /** Background work (schedulers, sweeps). Returns a stop function. */
  jobs?(ctx: ServiceContext<S>): (() => Promise<void> | void) | void;
}

export interface StartOptions {
  port?: number;
  host?: string;
  databaseUrl?: string;
  bus?: EventBus;
  env?: NodeJS.ProcessEnv;
  logger?: boolean | object;
  migrate?: boolean;
}

export interface RunningService<S extends Record<string, unknown>> {
  app: FastifyInstance;
  ctx: ServiceContext<S>;
  url: string;
  close(): Promise<void>;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`${key} is not set`);
  return v;
}

/** Wire a service: database + migrations, bus, outbox relay, HTTP routes, consumers, jobs. */
export async function startService<S extends Record<string, unknown>>(mod: ServiceModule<S>, opts: StartOptions = {}): Promise<RunningService<S>> {
  const env = opts.env ?? process.env;
  const { db, pool } = openDatabase(opts.databaseUrl ?? required(env, "DATABASE_URL"), mod.schema);
  if (opts.migrate ?? env.MIGRATE_ON_START !== "false") await runMigrations(db, mod.migrationsFolder);

  const corsOrigins = env.CORS_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean);
  // A placeholder verifier until the real one exists (identity builds its own from ctx).
  let verify: TokenVerifier = async () => {
    throw new Error("verifier not ready");
  };
  const app = await createApp({
    name: mod.name,
    verifier: (t) => verify(t),
    ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
    ...(corsOrigins ? { corsOrigins } : {}),
  });

  const bus =
    opts.bus ??
    (env.EVENT_BUS === "memory"
      ? memoryBus((m, err) => app.log.error({ err }, m))
      : await natsBus({ servers: env.NATS_URL ?? "nats://localhost:4222", name: mod.name, log: (m, err) => app.log.error({ err }, m) }));

  const outbox = new Outbox(db, bus, app.log);
  const ctx: ServiceContext<S> = { name: mod.name, db, pool, bus, outbox, log: app.log, env };
  await mod.init?.(ctx);

  verify = mod.verifier
    ? await mod.verifier(ctx)
    : jwksVerifier({ jwksUrl: required(env, "JWKS_URL"), issuer: env.JWT_ISSUER ?? DEFAULT_ISSUER, audience: env.JWT_AUDIENCE ?? DEFAULT_AUDIENCE });

  await mod.routes(app, ctx);
  await mod.consumers?.(ctx);
  outbox.start();
  const stopJobs = mod.jobs?.(ctx);

  const port = opts.port ?? Number(env.PORT ?? 0);
  const url = await app.listen({ port, host: opts.host ?? env.HOST ?? "0.0.0.0" });

  return {
    app,
    ctx,
    url,
    async close() {
      await stopJobs?.();
      await app.close();
      await outbox.stop();
      if (!opts.bus) await bus.close();
      await pool.end();
    },
  };
}

/** `main.ts` for a service: start it and shut down cleanly on SIGTERM. */
export async function runMain<S extends Record<string, unknown>>(mod: ServiceModule<S>) {
  const svc = await startService(mod);
  const stop = async () => {
    svc.app.log.info("shutting down");
    await svc.close();
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
