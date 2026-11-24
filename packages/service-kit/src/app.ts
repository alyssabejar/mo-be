import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { bearer, type TokenVerifier } from "./auth";
import { ApiError, installErrorHandler } from "./errors";

declare module "fastify" {
  interface FastifyContextConfig {
    /** Route works without a token (login, health, webhooks). */
    public?: boolean;
  }
}

export interface AppOptions {
  name: string;
  verifier: TokenVerifier;
  logger?: FastifyServerOptions["logger"];
  /** Origins allowed by CORS. Behind Traefik the gateway handles this; set it for local dev. */
  corsOrigins?: string[];
}

export async function createApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? { level: process.env.LOG_LEVEL ?? "info" },
    // Slack and courier payloads can carry photos; receipts arrive as data URLs.
    bodyLimit: 8 * 1024 * 1024,
  });
  installErrorHandler(app);
  if (opts.corsOrigins?.length) {
    await app.register(cors, { origin: opts.corsOrigins, credentials: true });
  }

  app.decorateRequest("claims", undefined);
  app.addHook("onRequest", async (req) => {
    const token = bearer(req);
    if (!token) return;
    try {
      req.claims = await opts.verifier(token);
    } catch (err) {
      // A stale token on a public route (e.g. logging in again) is ignored.
      if (!req.routeOptions.config?.public) throw err;
    }
  });
  app.addHook("preHandler", async (req) => {
    if (!req.routeOptions.config?.public && !req.claims) {
      throw new ApiError(401, "unauthenticated", "Please sign in again.");
    }
  });

  app.get("/healthz", { config: { public: true } }, async () => ({ ok: true, service: opts.name }));
  return app;
}
