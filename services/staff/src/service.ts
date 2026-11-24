import {
  computeBalance,
  DecideLeaveRequest,
  FileLeaveRequest,
  IsoDate,
  validateLeave,
  Weekday,
  type HelperProfile,
  type LeaveRequest,
} from "@mamamo/contracts";
import {
  ApiError,
  claims,
  compact,
  consume,
  notFound,
  requireCan,
  todayManila,
  uid,
  type EventCatalog,
  type Queryable,
  type ServiceContext,
  type ServiceModule,
} from "@mamamo/service-kit";
import { and, asc, eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import * as schema from "./schema";
import { helperProfiles, leaveRequests } from "./schema";

type Ctx = ServiceContext<typeof schema>;

export function toProfile(r: typeof helperProfiles.$inferSelect): HelperProfile {
  return compact({ id: r.id, householdId: r.householdId, userId: r.userId, hireDate: r.hireDate, birthDate: r.birthDate ?? undefined, restDay: r.restDay }) as HelperProfile;
}

export function toLeave(r: typeof leaveRequests.$inferSelect): LeaveRequest {
  return compact({
    id: r.id,
    householdId: r.householdId,
    helperId: r.helperId,
    type: r.type,
    startDate: r.startDate,
    endDate: r.endDate,
    swapFrom: r.swapFrom ?? undefined,
    reason: r.reason ?? undefined,
    status: r.status,
    decidedBy: r.decidedBy ?? undefined,
    decidedAt: r.decidedAt ? new Date(r.decidedAt).toISOString() : undefined,
    decisionNote: r.decisionNote ?? undefined,
    createdAt: new Date(r.createdAt).toISOString(),
  }) as LeaveRequest;
}

async function balanceFor(db: Queryable<any>, householdId: string, helperId: string) {
  const [p] = await db.select().from(helperProfiles).where(and(eq(helperProfiles.userId, helperId), eq(helperProfiles.householdId, householdId)));
  if (!p) notFound("Helper profile");
  const requests = (await db.select().from(leaveRequests).where(eq(leaveRequests.helperId, helperId))).map(toLeave);
  const balance = computeBalance({ helperId, hireDate: p.hireDate, today: todayManila(), accumulatedRestEarned: p.accumulatedRestEarned, requests });
  return { profile: toProfile(p), balance, requests };
}

const UpdateProfile = z.object({
  restDay: Weekday.optional(),
  hireDate: IsoDate.optional(),
  birthDate: IsoDate.nullable().optional(),
  /** Unused weekly rest days earned so far; owners correct it when a rest day goes unused. */
  accumulatedRestEarned: z.number().int().min(0).max(60).optional(),
});

export function staffModule(): ServiceModule<typeof schema> {
  return {
    name: "staff",
    schema,
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),

    async routes(app, ctx: Ctx) {
      const { db } = ctx;

      app.get("/profiles", async (req) => {
        const c = claims(req);
        const rows = await db.select().from(helperProfiles).where(eq(helperProfiles.householdId, c.householdId));
        return rows.map(toProfile);
      });

      app.patch<{ Params: { userId: string } }>("/profiles/:userId", async (req) => {
        const c = requireCan(req, "members.manage");
        const body = UpdateProfile.parse(req.body);
        return db.transaction(async (tx) => {
          const [p] = await tx
            .update(helperProfiles)
            .set(compact({ restDay: body.restDay, hireDate: body.hireDate, accumulatedRestEarned: body.accumulatedRestEarned }))
            .where(and(eq(helperProfiles.userId, req.params.userId), eq(helperProfiles.householdId, c.householdId)))
            .returning();
          if (!p) notFound("Helper profile");
          let row = p;
          if (body.birthDate !== undefined) {
            [row] = (await tx.update(helperProfiles).set({ birthDate: body.birthDate }).where(eq(helperProfiles.id, p.id)).returning()) as [typeof p];
          }
          const profile = toProfile(row);
          await ctx.outbox.emit(tx, "staff.profile.upserted", c.householdId, { profile }, c.sub);
          return profile;
        });
      });

      /** A helper's requests and balance. Helpers always get their own; others pick one (default: first helper). */
      app.get("/leaves", async (req) => {
        const c = claims(req);
        const { helperId } = z.object({ helperId: z.string().optional() }).parse(req.query);
        let id = c.role === "helper" ? c.sub : helperId;
        if (!id) {
          const [first] = await db.select().from(helperProfiles).where(eq(helperProfiles.householdId, c.householdId)).orderBy(asc(helperProfiles.hireDate));
          if (!first) throw new ApiError(404, "no_helper", "No helper in this household yet.");
          id = first.userId;
        }
        const { profile, balance, requests } = await balanceFor(db, c.householdId, id);
        return { requests: requests.sort((a, b) => b.startDate.localeCompare(a.startDate)), balance, profile };
      });

      app.get("/leaves/pending", async (req) => {
        const c = requireCan(req, "leave.approve");
        const rows = await db
          .select()
          .from(leaveRequests)
          .where(and(eq(leaveRequests.householdId, c.householdId), eq(leaveRequests.status, "pending")))
          .orderBy(asc(leaveRequests.startDate));
        return rows.map(toLeave);
      });

      app.post("/leaves", async (req, reply) => {
        const c = requireCan(req, "leave.file");
        const body = FileLeaveRequest.parse(req.body);
        const leave = await db.transaction(async (tx) => {
          // Serialise filings per helper so two requests can't both pass the balance check.
          await tx.select().from(helperProfiles).where(eq(helperProfiles.userId, c.sub)).for("update");
          const { balance, requests } = await balanceFor(tx, c.householdId, c.sub);
          const err = validateLeave({ ...body, today: todayManila(), balance, existing: requests });
          if (err) throw new ApiError(422, `leave.${err.code}`, err.code, err);
          const [row] = await tx
            .insert(leaveRequests)
            .values({ ...body, id: uid("l"), householdId: c.householdId, helperId: c.sub, status: "pending" })
            .returning();
          const l = toLeave(row!);
          await ctx.outbox.emit(tx, "staff.leave.requested", c.householdId, { leave: l }, c.sub);
          return l;
        });
        reply.status(201);
        return leave;
      });

      app.post<{ Params: { id: string } }>("/leaves/:id/cancel", async (req) => {
        const c = claims(req);
        return db.transaction(async (tx) => {
          const [l] = await tx
            .select()
            .from(leaveRequests)
            .where(and(eq(leaveRequests.id, req.params.id), eq(leaveRequests.helperId, c.sub)))
            .for("update");
          if (!l) notFound("Request");
          if (l.status !== "pending") throw new ApiError(409, "not_pending", "Only pending requests can be cancelled.");
          const [row] = await tx.update(leaveRequests).set({ status: "cancelled" }).where(eq(leaveRequests.id, l.id)).returning();
          const leave = toLeave(row!);
          await ctx.outbox.emit(tx, "staff.leave.cancelled", c.householdId, { leave }, c.sub);
          return leave;
        });
      });

      app.post<{ Params: { id: string } }>("/leaves/:id/decide", async (req) => {
        const c = requireCan(req, "leave.approve");
        const body = DecideLeaveRequest.parse({ ...(req.body as object), id: req.params.id });
        return db.transaction(async (tx) => {
          const [l] = await tx
            .select()
            .from(leaveRequests)
            .where(and(eq(leaveRequests.id, body.id), eq(leaveRequests.householdId, c.householdId)))
            .for("update");
          if (!l) notFound("Request");
          if (l.status !== "pending") throw new ApiError(409, "not_pending", "Already decided.");
          const [row] = await tx
            .update(leaveRequests)
            .set({ status: body.decision, decidedBy: c.sub, decidedAt: new Date().toISOString(), decisionNote: body.note ?? null })
            .where(eq(leaveRequests.id, l.id))
            .returning();
          const leave = toLeave(row!);
          await ctx.outbox.emit(tx, body.decision === "approved" ? "staff.leave.approved" : "staff.leave.rejected", c.householdId, { leave }, c.sub);
          return leave;
        });
      });
    },

    async consumers(ctx: Ctx) {
      await consume(ctx.db, ctx.bus, ctx.outbox, "staff-identity", ["identity.user.created", "identity.user.updated", "identity.user.removed"], async (tx, event) => {
        if (event.subject === "identity.user.removed") {
          const { userId } = event.data as EventCatalog["identity.user.removed"];
          await tx.delete(helperProfiles).where(eq(helperProfiles.userId, userId));
          return;
        }
        const { user, helper } = event.data as EventCatalog["identity.user.created"];
        if (user.role !== "helper") return;
        if (event.subject === "identity.user.updated") {
          await tx.update(helperProfiles).set({ displayName: user.displayName }).where(eq(helperProfiles.userId, user.id));
          return;
        }
        const [row] = await tx
          .insert(helperProfiles)
          .values({
            id: `hp_${user.id}`,
            householdId: user.householdId,
            userId: user.id,
            hireDate: helper?.hireDate ?? todayManila(),
            birthDate: helper?.birthDate ?? null,
            restDay: "SU",
            displayName: user.displayName,
          })
          .onConflictDoNothing()
          .returning();
        if (row) await ctx.outbox.emit(tx, "staff.profile.upserted", user.householdId, { profile: toProfile(row) }, event.actorId);
      });
    },
  };
}

