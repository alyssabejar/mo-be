import {
  AddNoteRequest,
  can,
  CreateHelperRequest,
  CreateMemberRequest,
  LoginRequest,
  UpdateHouseholdRequest,
  UpdateProfileRequest,
  type Household,
  type User,
} from "@mamamo/contracts";
import {
  ApiError,
  claims,
  compact,
  DEFAULT_AUDIENCE,
  DEFAULT_ISSUER,
  notFound,
  requireCan,
  uid,
  type Queryable,
  type ServiceContext,
  type ServiceModule,
  type TokenVerifier,
} from "@mamamo/service-kit";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createAuth, helperEmail, migrateAuth, type Auth } from "./auth";
import * as schema from "./schema";
import { households, members, notes } from "./schema";

type Ctx = ServiceContext<typeof schema>;
type MemberRow = typeof members.$inferSelect;
type HouseholdRow = typeof households.$inferSelect;

export function toUser(m: MemberRow): User {
  return compact({
    id: m.id,
    householdId: m.householdId,
    role: m.role,
    displayName: m.displayName,
    email: m.email ?? undefined,
    username: m.username ?? undefined,
    mamaCallsMe: m.mamaCallsMe,
    locale: m.locale,
    plainMode: m.plainMode,
    channels: m.channels,
    quietHours: m.quietHours,
    createdAt: new Date(m.createdAt).toISOString(),
  }) as User;
}

export function toHousehold(h: HouseholdRow): Household {
  return { id: h.id, name: h.name, weeklyGroceryBudget: h.weeklyGroceryBudget, ai: h.ai, createdAt: new Date(h.createdAt).toISOString() };
}

async function memberById(db: Queryable<any>, householdId: string, id: string) {
  const [m] = await db.select().from(members).where(and(eq(members.id, id), eq(members.householdId, householdId)));
  return m;
}

async function householdById(db: Queryable<any>, id: string) {
  const [h] = await db.select().from(households).where(eq(households.id, id));
  return h ?? notFound("Household");
}

const DEFAULT_CHANNELS = { inApp: true, webPush: true, slack: false };

const BootstrapRequest = z.object({
  householdName: z.string().min(1),
  weeklyGroceryBudget: z.number().int().nonnegative().default(0),
  owner: CreateMemberRequest,
});

const UpdateMemberRequest = z.object({ displayName: z.string().min(1).optional(), mamaCallsMe: z.string().min(1).max(40).optional() });

/** Map Better Auth sign-in failures to the one error the UI expects. */
async function signIn(auth: Auth, body: LoginRequest): Promise<{ userId: string; sessionToken: string }> {
  try {
    const res =
      body.kind === "email"
        ? await auth.auth.api.signInEmail({ body: { email: body.email.toLowerCase(), password: body.password } })
        : await auth.auth.api.signInUsername({ body: { username: body.username.toLowerCase(), password: body.pin } });
    if (!res?.token || !res.user) throw new Error("no session");
    return { userId: res.user.id, sessionToken: res.token };
  } catch {
    throw new ApiError(401, "bad_credentials", "Wrong login details.");
  }
}

export function identityModule(): ServiceModule<typeof schema> & { auth(): Auth } {
  let auth: Auth | undefined;
  const getAuth = () => auth ?? (() => { throw new Error("auth not initialised"); })();

  async function issue(m: MemberRow) {
    return getAuth().accessToken({ sub: m.id, householdId: m.householdId, role: m.role });
  }

  async function publishUser(ctx: Ctx, tx: Queryable<any>, m: MemberRow, subject: "identity.user.created" | "identity.user.updated", actorId?: string, helper?: { hireDate: string; birthDate?: string }) {
    await ctx.outbox.emit(tx, subject, m.householdId, { user: toUser(m), ...(helper ? { helper } : {}) }, actorId);
  }

  return {
    name: "identity",
    schema,
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    auth: getAuth,

    async init(ctx) {
      await migrateAuth(ctx.pool);
      auth = createAuth(ctx.pool, ctx.env);
    },

    async verifier(ctx): Promise<TokenVerifier> {
      let cached: { at: number; get: ReturnType<typeof createLocalJWKSet> } | undefined;
      const keys = async () => {
        if (!cached || Date.now() - cached.at > 5 * 60_000) {
          cached = { at: Date.now(), get: createLocalJWKSet((await getAuth().jwks()) as JSONWebKeySet) };
        }
        return cached.get;
      };
      const issuer = ctx.env.JWT_ISSUER ?? DEFAULT_ISSUER;
      const audience = ctx.env.JWT_AUDIENCE ?? DEFAULT_AUDIENCE;
      return async (token) => {
        try {
          const { payload } = await jwtVerify(token, await keys(), { issuer, audience });
          const { JwtClaims } = await import("@mamamo/contracts");
          return JwtClaims.parse(payload);
        } catch {
          cached = undefined; // a rotated key: refetch next time
          throw new ApiError(401, "unauthenticated", "Please sign in again.");
        }
      };
    },

    async routes(app: FastifyInstance, ctx: Ctx) {
      const { db } = ctx;

      // ---------- auth ----------

      app.post("/auth/login", { config: { public: true } }, async (req) => {
        const body = LoginRequest.parse(req.body);
        const { userId, sessionToken } = await signIn(getAuth(), body);
        const m = (await db.select().from(members).where(eq(members.id, userId)))[0];
        if (!m) throw new ApiError(401, "bad_credentials", "Wrong login details.");
        // Helpers sign in with username + PIN only.
        if (body.kind === "email" && m.role === "helper") throw new ApiError(401, "bad_credentials", "Wrong login details.");
        const household = await householdById(db, m.householdId);
        return { user: toUser(m), household: toHousehold(household), token: await issue(m), refreshToken: sessionToken };
      });

      app.post("/auth/refresh", { config: { public: true } }, async (req) => {
        const { refreshToken } = z.object({ refreshToken: z.string().min(1) }).parse(req.body);
        const session = await getAuth().auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${refreshToken}` }) });
        const m = session && (await db.select().from(members).where(eq(members.id, session.user.id)))[0];
        if (!m) throw new ApiError(401, "unauthenticated", "Please sign in again.");
        return { token: await issue(m) };
      });

      app.post("/auth/logout", { config: { public: true } }, async (req) => {
        const { refreshToken } = z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {});
        if (refreshToken) {
          await getAuth()
            .auth.api.signOut({ headers: new Headers({ authorization: `Bearer ${refreshToken}` }) })
            .catch(() => undefined);
        }
        return { ok: true };
      });

      app.get("/auth/jwks", { config: { public: true } }, async () => getAuth().jwks());

      /** First run only: create the household and its owner. */
      app.post("/households/bootstrap", { config: { public: true } }, async (req, reply) => {
        const body = BootstrapRequest.parse(req.body);
        const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(households);
        if (n > 0) throw new ApiError(409, "already_bootstrapped", "This Mama Mo already has a household.");
        const user = await createLogin(getAuth(), { email: body.owner.email, password: body.owner.password, name: body.owner.displayName });
        const householdId = uid("hh");
        const m = await db.transaction(async (tx) => {
          const [h] = await tx
            .insert(households)
            .values({ id: householdId, name: body.householdName, weeklyGroceryBudget: body.weeklyGroceryBudget, ai: { provider: "none", enabled: false } })
            .returning();
          const [row] = await tx
            .insert(members)
            .values({
              id: user.id,
              householdId,
              role: "owner",
              displayName: body.owner.displayName,
              email: body.owner.email.toLowerCase(),
              mamaCallsMe: body.owner.mamaCallsMe,
              locale: body.owner.locale,
              channels: DEFAULT_CHANNELS,
              quietHours: { enabled: true, start: "22:00", end: "06:00" },
            })
            .returning();
          await ctx.outbox.emit(tx, "identity.household.updated", householdId, { household: toHousehold(h!) });
          await publishUser(ctx, tx, row!, "identity.user.created");
          return row!;
        });
        reply.status(201);
        return { user: toUser(m), household: toHousehold(await householdById(db, householdId)) };
      });

      // ---------- me ----------

      app.get("/me", async (req) => {
        const c = claims(req);
        const m = (await memberById(db, c.householdId, c.sub)) ?? notFound("User");
        return { user: toUser(m), household: toHousehold(await householdById(db, c.householdId)) };
      });

      app.patch("/profile", async (req) => {
        const c = claims(req);
        const body = UpdateProfileRequest.parse(req.body);
        return db.transaction(async (tx) => {
          const [m] = await tx.update(members).set(body).where(and(eq(members.id, c.sub), eq(members.householdId, c.householdId))).returning();
          if (!m) notFound("User");
          await publishUser(ctx, tx, m, "identity.user.updated", c.sub);
          return toUser(m);
        });
      });

      app.patch("/household", async (req) => {
        const c = requireCan(req, "household.settings");
        const body = UpdateHouseholdRequest.parse(req.body);
        if (body.ai && !can(c.role, "ai.settings")) throw new ApiError(403, "forbidden", "Your role can't do this (ai.settings).");
        if (body.weeklyGroceryBudget !== undefined && !can(c.role, "budget.manage")) throw new ApiError(403, "forbidden", "Your role can't do this (budget.manage).");
        return db.transaction(async (tx) => {
          const [h] = await tx.update(households).set(body).where(eq(households.id, c.householdId)).returning();
          if (!h) notFound("Household");
          await ctx.outbox.emit(tx, "identity.household.updated", h.id, { household: toHousehold(h) }, c.sub);
          return toHousehold(h);
        });
      });

      // ---------- members ----------

      app.get("/members", async (req) => {
        const c = claims(req);
        const rows = await db.select().from(members).where(eq(members.householdId, c.householdId)).orderBy(asc(members.createdAt));
        return rows.map(toUser);
      });

      app.post("/members/helpers", async (req, reply) => {
        const c = requireCan(req, "members.manage");
        const body = CreateHelperRequest.parse(req.body);
        const taken = await db.select({ id: members.id }).from(members).where(eq(members.username, body.username));
        if (taken.length) throw new ApiError(409, "username_taken", "That username is already used.");
        const login = await createLogin(getAuth(), { email: helperEmail(body.username), password: body.pin, name: body.displayName, username: body.username });
        const m = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(members)
            .values({
              id: login.id,
              householdId: c.householdId,
              role: "helper",
              displayName: body.displayName,
              username: body.username,
              mamaCallsMe: body.mamaCallsMe,
              locale: body.locale,
              channels: DEFAULT_CHANNELS,
              quietHours: { enabled: true, start: "21:00", end: "05:30" },
            })
            .returning();
          await publishUser(ctx, tx, row!, "identity.user.created", c.sub, compact({ hireDate: body.hireDate, birthDate: body.birthDate }));
          return row!;
        });
        reply.status(201);
        // staff-service creates the profile from the event; echo the starting values.
        return {
          ...toUser(m),
          helperProfile: compact({ id: `hp_${m.id}`, householdId: m.householdId, userId: m.id, hireDate: body.hireDate, birthDate: body.birthDate, restDay: "SU" as const }),
        };
      });

      app.post("/members", async (req, reply) => {
        const c = requireCan(req, "members.manage");
        const body = CreateMemberRequest.parse(req.body);
        const email = body.email.toLowerCase();
        const taken = await db.select({ id: members.id }).from(members).where(eq(members.email, email));
        if (taken.length) throw new ApiError(409, "email_taken", "That email is already used.");
        const login = await createLogin(getAuth(), { email, password: body.password, name: body.displayName });
        const m = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(members)
            .values({
              id: login.id,
              householdId: c.householdId,
              role: "member",
              displayName: body.displayName,
              email,
              mamaCallsMe: body.mamaCallsMe,
              locale: body.locale,
              channels: DEFAULT_CHANNELS,
              quietHours: { enabled: true, start: "22:00", end: "06:00" },
            })
            .returning();
          await publishUser(ctx, tx, row!, "identity.user.created", c.sub);
          return row!;
        });
        reply.status(201);
        return toUser(m);
      });

      app.patch<{ Params: { id: string } }>("/members/:id", async (req) => {
        const c = requireCan(req, "members.manage");
        const body = UpdateMemberRequest.parse(req.body);
        return db.transaction(async (tx) => {
          const [m] = await tx
            .update(members)
            .set(compact(body))
            .where(and(eq(members.id, req.params.id), eq(members.householdId, c.householdId)))
            .returning();
          if (!m) notFound("Member");
          if (Object.keys(compact(body)).length) await publishUser(ctx, tx, m, "identity.user.updated", c.sub);
          return toUser(m);
        });
      });

      app.post<{ Params: { id: string } }>("/members/:id/pin", async (req) => {
        const c = requireCan(req, "members.manage");
        const { pin } = z.object({ pin: z.string().regex(/^\d{4,6}$/, "PIN is 4 to 6 digits") }).parse(req.body);
        const m = await memberById(db, c.householdId, req.params.id);
        if (!m || m.role !== "helper") notFound("Helper");
        await getAuth().setPassword(m.id, pin);
        return { ok: true };
      });

      app.delete<{ Params: { id: string } }>("/members/:id", async (req) => {
        const c = requireCan(req, "members.manage");
        if (req.params.id === c.sub) throw new ApiError(400, "self", "You can't remove yourself.");
        const m = (await memberById(db, c.householdId, req.params.id)) ?? notFound("Member");
        await db.transaction(async (tx) => {
          await tx.delete(members).where(eq(members.id, m.id));
          await ctx.outbox.emit(tx, "identity.user.removed", c.householdId, { userId: m.id }, c.sub);
        });
        await getAuth().deleteUser(m.id);
        return { ok: true };
      });

      // ---------- household notes ----------

      app.get("/notes", async (req) => {
        const c = claims(req);
        const rows = await db.select().from(notes).where(eq(notes.householdId, c.householdId)).orderBy(desc(notes.pinned), desc(notes.createdAt));
        return rows.map((n) => ({ ...n, createdAt: new Date(n.createdAt).toISOString() }));
      });

      app.post("/notes", async (req, reply) => {
        const c = requireCan(req, "notes.add");
        const body = AddNoteRequest.parse(req.body);
        const note = await db.transaction(async (tx) => {
          const [n] = await tx.insert(notes).values({ id: uid("n"), householdId: c.householdId, authorId: c.sub, body: body.body }).returning();
          await ctx.outbox.emit(tx, "identity.note.changed", c.householdId, { noteId: n!.id }, c.sub);
          return n!;
        });
        reply.status(201);
        return { ...note, createdAt: new Date(note.createdAt).toISOString() };
      });

      app.delete<{ Params: { id: string } }>("/notes/:id", async (req) => {
        const c = claims(req);
        await db.transaction(async (tx) => {
          const [n] = await tx.select().from(notes).where(and(eq(notes.id, req.params.id), eq(notes.householdId, c.householdId)));
          if (!n) notFound("Note");
          if (n.authorId !== c.sub && c.role !== "owner") throw new ApiError(403, "forbidden", "Only the author or the owner can remove a note.");
          await tx.delete(notes).where(eq(notes.id, n.id));
          await ctx.outbox.emit(tx, "identity.note.changed", c.householdId, { noteId: n.id }, c.sub);
        });
        return { ok: true };
      });

      app.post<{ Params: { id: string } }>("/notes/:id/pin", async (req) => {
        const c = claims(req);
        if (c.role === "helper") throw new ApiError(403, "forbidden", "Helpers can't pin notes.");
        return db.transaction(async (tx) => {
          const [n] = await tx
            .update(notes)
            .set({ pinned: sql`not ${notes.pinned}` })
            .where(and(eq(notes.id, req.params.id), eq(notes.householdId, c.householdId)))
            .returning();
          if (!n) notFound("Note");
          await ctx.outbox.emit(tx, "identity.note.changed", c.householdId, { noteId: n.id }, c.sub);
          return { ...n, createdAt: new Date(n.createdAt).toISOString() };
        });
      });
    },
  };
}

/** Create the Better Auth login (user + credential account). */
export async function createLogin(auth: Auth, input: { email: string; password: string; name: string; username?: string }) {
  try {
    const res = await auth.auth.api.signUpEmail({
      body: { email: input.email, password: input.password, name: input.name, ...(input.username ? { username: input.username } : {}) },
    });
    // signUpEmail starts a session we don't need: the person signs in themselves.
    if (res.token) await auth.auth.api.signOut({ headers: new Headers({ authorization: `Bearer ${res.token}` }) }).catch(() => undefined);
    return res.user;
  } catch (err) {
    const code = (err as { body?: { code?: string } }).body?.code ?? "";
    if (/USERNAME/.test(code)) throw new ApiError(409, "username_taken", "That username is already used.");
    if (/EXIST|EMAIL/.test(code)) throw new ApiError(409, "email_taken", "That email is already used.");
    throw err;
  }
}
