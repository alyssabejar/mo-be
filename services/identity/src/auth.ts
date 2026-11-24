import type { JwtClaims } from "@mamamo/contracts";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { bearer, jwt, username } from "better-auth/plugins";
import type pg from "pg";

/** Access tokens are short-lived; the Better Auth session token is the refresh token. */
export const ACCESS_TOKEN_TTL = "1h";

/** Helpers have no email; Better Auth still wants one, so they get an unroutable address. */
export const helperEmail = (u: string) => `${u}@helper.mamamo.invalid`;

function makeAuth(pool: pg.Pool, env: NodeJS.ProcessEnv) {
  return betterAuth({
    database: pool,
    secret: env.BETTER_AUTH_SECRET ?? (env.NODE_ENV === "production" ? undefined : "dev-only-secret-change-me-dev-only-secret"),
    baseURL: env.BETTER_AUTH_URL ?? "http://localhost:4001",
    basePath: "/auth",
    emailAndPassword: {
      enabled: true,
      // Helper PINs are 4 to 6 digits. Owner and member passwords are held to 8+ by the contracts.
      minPasswordLength: 4,
    },
    session: { expiresIn: 60 * 60 * 24 * 30 },
    plugins: [
      username({ minUsernameLength: 3, maxUsernameLength: 24 }),
      bearer(),
      jwt({
        jwks: { keyPairConfig: { alg: "EdDSA", crv: "Ed25519" } },
        jwt: {
          issuer: env.JWT_ISSUER ?? "mamamo-identity",
          audience: env.JWT_AUDIENCE ?? "mamamo",
          expirationTime: ACCESS_TOKEN_TTL,
        },
      }),
    ],
    telemetry: { enabled: false },
  });
}

/**
 * Create or update Better Auth's own tables (user, session, account, verification,
 * jwks). Runs before the auth instance exists, so its startup schema check passes.
 */
export async function migrateAuth(pool: pg.Pool) {
  const { runMigrations } = await getMigrations({
    database: pool,
    emailAndPassword: { enabled: true },
    plugins: [username(), bearer(), jwt()],
  });
  await runMigrations();
}

export function createAuth(pool: pg.Pool, env: NodeJS.ProcessEnv = process.env) {
  const auth = makeAuth(pool, env);

  return {
    auth,
    /** Sign an access token carrying the claims every service reads. */
    async accessToken(claims: JwtClaims): Promise<string> {
      const { token } = await auth.api.signJWT({ body: { payload: { ...claims } } });
      return token;
    },
    async jwks() {
      return auth.api.getJwks();
    },
    async hash(secret: string) {
      return (await auth.$context).password.hash(secret);
    },
    async setPassword(userId: string, secret: string) {
      const ctx = await auth.$context;
      await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(secret));
    },
    async deleteUser(userId: string) {
      const ctx = await auth.$context;
      await ctx.internalAdapter.deleteUser(userId);
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;
