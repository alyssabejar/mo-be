import { can, JwtClaims, type Permission } from "@mamamo/contracts";
import type { FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { ApiError } from "./errors";

/** Verifies a bearer token and returns the claims every service reads. */
export type TokenVerifier = (token: string) => Promise<JwtClaims>;

/**
 * Verify JWTs issued by identity-service (Better Auth's jwt plugin) against its
 * JWKS endpoint. Keys are cached and refreshed by jose.
 */
export function jwksVerifier(opts: { jwksUrl: string; issuer?: string; audience?: string }): TokenVerifier {
  const jwks = createRemoteJWKSet(new URL(opts.jwksUrl));
  return keyVerifier(jwks, opts);
}

export function keyVerifier(key: JWTVerifyGetKey | Exclude<Parameters<typeof jwtVerify>[1], JWTVerifyGetKey>, opts: { issuer?: string; audience?: string } = {}): TokenVerifier {
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, key as JWTVerifyGetKey, {
        ...(opts.issuer ? { issuer: opts.issuer } : {}),
        ...(opts.audience ? { audience: opts.audience } : {}),
      });
      return JwtClaims.parse(payload);
    } catch {
      throw new ApiError(401, "unauthenticated", "Please sign in again.");
    }
  };
}

declare module "fastify" {
  interface FastifyRequest {
    claims?: JwtClaims;
  }
}

export function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7);
  // EventSource can't set headers; the SSE endpoint accepts ?access_token=.
  const q = (req.query as Record<string, unknown> | undefined)?.access_token;
  return typeof q === "string" ? q : undefined;
}

/** The caller's claims. Throws 401 when the route ran without a verified token. */
export function claims(req: FastifyRequest): JwtClaims {
  if (!req.claims) throw new ApiError(401, "unauthenticated", "Please sign in again.");
  return req.claims;
}

export function requireCan(req: FastifyRequest, permission: Permission): JwtClaims {
  const c = claims(req);
  if (!can(c.role, permission)) throw new ApiError(403, "forbidden", `Your role can't do this (${permission}).`);
  return c;
}
