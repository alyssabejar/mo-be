/**
 * Run every service in one process for local development and end-to-end tests:
 * one Postgres server (a database per service), an in-memory event bus instead
 * of NATS, and a small gateway that routes /api/<service>/… like Traefik does.
 *
 *   DATABASE_URL_BASE=postgres://postgres@localhost:5432 pnpm dev:all
 */
import { memoryBus, startService, type RunningService, type ServiceModule } from "@mamamo/service-kit";
import http from "node:http";
import pg from "pg";
import { calendarModule } from "../services/calendar/src/service";
import { errandModule } from "../services/errand/src/service";
import { identityModule } from "../services/identity/src/service";
import { mealModule } from "../services/meal/src/service";
import { notificationModule } from "../services/notification/src/service";
import { reminderModule } from "../services/reminder/src/service";
import { staffModule } from "../services/staff/src/service";

export const SERVICES = [
  { name: "identity", port: 4001, mod: identityModule },
  { name: "meal", port: 4002, mod: mealModule },
  { name: "errand", port: 4003, mod: errandModule },
  { name: "staff", port: 4004, mod: staffModule },
  { name: "reminder", port: 4005, mod: reminderModule },
  { name: "notification", port: 4006, mod: notificationModule },
  { name: "calendar", port: 4007, mod: calendarModule },
] as const;

export interface AllOptions {
  databaseUrlBase: string;
  /** Prefix for database names, e.g. "mamamo" → mamamo_identity. */
  dbPrefix?: string;
  /** Drop and recreate the databases first. */
  fresh?: boolean;
  gatewayPort?: number;
  /** 0 picks free ports (tests). */
  basePort?: number;
  logger?: boolean | object;
  env?: NodeJS.ProcessEnv;
}

async function ensureDatabases(base: string, names: string[], fresh: boolean) {
  const admin = new pg.Client({ connectionString: `${base}/postgres` });
  await admin.connect();
  try {
    for (const n of names) {
      if (fresh) await admin.query(`drop database if exists "${n}" with (force)`);
      const { rowCount } = await admin.query("select 1 from pg_database where datname = $1", [n]);
      if (!rowCount) await admin.query(`create database "${n}"`);
    }
  } finally {
    await admin.end();
  }
}

/** Path-prefix gateway: /api/<service>/rest → http://localhost:<port>/rest. Streams bodies (SSE included). */
function gateway(targets: Map<string, string>, corsOrigins: string[]) {
  return http.createServer((req, res) => {
    const origin = req.headers.origin;
    if (origin && (corsOrigins.includes("*") || corsOrigins.includes(origin))) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("access-control-allow-credentials", "true");
      res.setHeader("vary", "origin");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "authorization,content-type",
        "access-control-max-age": "600",
      });
      return res.end();
    }
    const m = /^\/api\/([a-z]+)(\/.*)?$/.exec(req.url ?? "");
    const target = m && targets.get(m[1]!);
    if (!target) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ code: "not_found", message: `No service for ${req.url}` }));
    }
    const url = new URL(m![2] ?? "/", target);
    const headers = { ...req.headers, host: url.host };
    delete headers.origin; // the gateway answered CORS; services see a same-origin call
    const up = http.request(url, { method: req.method, headers }, (r) => {
      const h = { ...r.headers };
      for (const k of Object.keys(h)) if (k.startsWith("access-control-")) delete h[k];
      res.writeHead(r.statusCode ?? 502, h);
      r.pipe(res);
    });
    up.on("error", (err) => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "bad_gateway", message: err.message }));
    });
    req.pipe(up);
    res.on("close", () => up.destroy());
  });
}

export async function startAll(opts: AllOptions) {
  const prefix = opts.dbPrefix ?? "mamamo";
  await ensureDatabases(opts.databaseUrlBase, SERVICES.map((s) => `${prefix}_${s.name}`), !!opts.fresh);
  const bus = memoryBus((m, err) => console.error(m, err));
  const running: RunningService<any>[] = [];
  const targets = new Map<string, string>();
  const env = { ...process.env, ...opts.env };

  for (const s of SERVICES) {
    const port = opts.basePort === 0 ? 0 : (opts.basePort ?? 4001) + (s.port - 4001);
    const svc = await startService(s.mod() as ServiceModule<any>, {
      port,
      host: "127.0.0.1",
      databaseUrl: `${opts.databaseUrlBase}/${prefix}_${s.name}`,
      bus,
      logger: opts.logger ?? { level: env.LOG_LEVEL ?? "warn" },
      env: { ...env, JWKS_URL: `${targets.get("identity") ?? ""}/auth/jwks` },
    });
    running.push(svc);
    targets.set(s.name, svc.url.replace("0.0.0.0", "127.0.0.1"));
  }

  const corsOrigins = (env.CORS_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173").split(",");
  const gw = gateway(targets, corsOrigins);
  await new Promise<void>((r) => gw.listen(opts.gatewayPort ?? 8080, "127.0.0.1", r));
  const addr = gw.address();
  const gatewayUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 8080}/api`;

  return {
    gatewayUrl,
    targets,
    bus,
    services: running,
    /** Wait until every outbox is empty and every event handler has run. */
    async settle() {
      for (let i = 0; i < 5; i++) {
        await Promise.all(running.map((s) => s.ctx.outbox.flush()));
        await bus.idle();
      }
    },
    async close() {
      gw.closeAllConnections();
      await new Promise((r) => gw.close(r));
      for (const s of running.reverse()) await s.close();
    },
  };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.env.DATABASE_URL_BASE ?? "postgres://postgres@localhost:5432";
  const all = await startAll({ databaseUrlBase: base, fresh: process.argv.includes("--fresh"), gatewayPort: Number(process.env.GATEWAY_PORT ?? 8080) });
  console.log(`Mama Mo backend up. Gateway: ${all.gatewayUrl}`);
  for (const [n, u] of all.targets) console.log(`  ${n.padEnd(13)} ${u}`);
  const stop = async () => {
    await all.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
