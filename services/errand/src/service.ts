import { CreateErrandRequest, IsoDate, UpdateOccurrenceRequest, type Errand, type ErrandOccurrence } from "@mamamo/contracts";
import {
  ApiError,
  claims,
  compact,
  consume,
  errandInstances,
  notFound,
  requireCan,
  todayManila,
  uid,
  type EventCatalog,
  type ServiceContext,
  type ServiceModule,
} from "@mamamo/service-kit";
import { and, eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import * as schema from "./schema";
import { errands, occurrences } from "./schema";

type Ctx = ServiceContext<typeof schema>;

export function toErrand(r: typeof errands.$inferSelect): Errand {
  return compact({
    id: r.id,
    householdId: r.householdId,
    title: r.title,
    notes: r.notes ?? undefined,
    category: r.category,
    priority: r.priority,
    assigneeId: r.assigneeId ?? undefined,
    startDate: r.startDate,
    time: r.time ?? undefined,
    rrule: r.rrule ?? undefined,
    createdBy: r.createdBy,
    createdAt: new Date(r.createdAt).toISOString(),
    archived: r.archived,
  }) as Errand;
}

export function toOccurrence(r: typeof occurrences.$inferSelect): ErrandOccurrence {
  return compact({
    errandId: r.errandId,
    date: r.date,
    status: r.status,
    completedBy: r.completedBy ?? undefined,
    completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : undefined,
    rescheduledTo: r.rescheduledTo ?? undefined,
    note: r.note ?? undefined,
  }) as ErrandOccurrence;
}

const Range = z.object({ from: IsoDate, to: IsoDate });

export function errandModule(): ServiceModule<typeof schema> {
  return {
    name: "errand",
    schema,
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),

    async routes(app, ctx: Ctx) {
      const { db } = ctx;

      const loadErrand = async (householdId: string, id: string) => {
        const [e] = await db.select().from(errands).where(and(eq(errands.id, id), eq(errands.householdId, householdId)));
        return e ?? notFound("Errand");
      };

      app.get("/errands", async (req) => {
        const c = claims(req);
        const rows = await db.select().from(errands).where(and(eq(errands.householdId, c.householdId), eq(errands.archived, false)));
        return rows.filter((e) => c.role !== "helper" || e.assigneeId === c.sub).map(toErrand);
      });

      app.get("/errands/instances", async (req) => {
        const c = claims(req);
        const { from, to } = Range.parse(req.query);
        const [es, os] = await Promise.all([
          db.select().from(errands).where(and(eq(errands.householdId, c.householdId), eq(errands.archived, false))),
          db.select().from(occurrences).where(eq(occurrences.householdId, c.householdId)),
        ]);
        return errandInstances({ errands: es.map(toErrand), occurrences: os.map(toOccurrence), from, to, today: todayManila(), viewer: { id: c.sub, role: c.role } });
      });

      app.post("/errands", async (req, reply) => {
        const c = requireCan(req, "errands.manage");
        const body = CreateErrandRequest.parse(req.body);
        const errand = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(errands)
            .values({ ...body, id: uid("e"), householdId: c.householdId, createdBy: c.sub })
            .returning();
          const e = toErrand(row!);
          await ctx.outbox.emit(tx, "errand.upserted", c.householdId, { errand: e }, c.sub);
          return e;
        });
        reply.status(201);
        return errand;
      });

      app.put<{ Params: { id: string } }>("/errands/:id", async (req) => {
        const c = requireCan(req, "errands.manage");
        const body = CreateErrandRequest.parse(req.body);
        await loadErrand(c.householdId, req.params.id);
        return db.transaction(async (tx) => {
          const [row] = await tx
            .update(errands)
            // Optional fields left out of the request are cleared, like the mock.
            .set({ notes: null, assigneeId: null, time: null, rrule: null, ...body })
            .where(eq(errands.id, req.params.id))
            .returning();
          const e = toErrand(row!);
          await ctx.outbox.emit(tx, "errand.upserted", c.householdId, { errand: e }, c.sub);
          return e;
        });
      });

      app.post<{ Params: { id: string } }>("/errands/:id/archive", async (req) => {
        const c = requireCan(req, "errands.manage");
        await loadErrand(c.householdId, req.params.id);
        await db.transaction(async (tx) => {
          await tx.update(errands).set({ archived: true }).where(eq(errands.id, req.params.id));
          await ctx.outbox.emit(tx, "errand.archived", c.householdId, { errandId: req.params.id }, c.sub);
        });
        return { ok: true };
      });

      app.put("/occurrences", async (req) => {
        const c = requireCan(req, "errands.complete");
        const body = UpdateOccurrenceRequest.parse(req.body);
        const errand = await loadErrand(c.householdId, body.errandId);
        if (c.role === "helper" && errand.assigneeId !== c.sub) throw new ApiError(403, "forbidden", "Not assigned to you.");
        if (body.status === "rescheduled") requireCan(req, "errands.manage");
        if (body.status === "rescheduled" && !body.rescheduledTo) throw new ApiError(400, "validation", "Pick the new date.");
        return db.transaction(async (tx) => {
          const values = {
            errandId: body.errandId,
            householdId: c.householdId,
            date: body.date,
            status: body.status,
            completedBy: c.sub,
            completedAt: new Date().toISOString(),
            rescheduledTo: body.rescheduledTo ?? null,
            note: body.note ?? null,
          };
          const [row] = await tx
            .insert(occurrences)
            .values(values)
            .onConflictDoUpdate({ target: [occurrences.errandId, occurrences.date], set: values })
            .returning();
          const occurrence = toOccurrence(row!);
          await ctx.outbox.emit(tx, "errand.occurrence.completed", c.householdId, { occurrence }, c.sub);
          return occurrence;
        });
      });

      app.delete("/occurrences", async (req) => {
        const c = requireCan(req, "errands.complete");
        const { errandId, date } = z.object({ errandId: z.string().min(1), date: IsoDate }).parse(req.query);
        const errand = await loadErrand(c.householdId, errandId);
        if (c.role === "helper" && errand.assigneeId !== c.sub) throw new ApiError(403, "forbidden", "Not assigned to you.");
        await db.transaction(async (tx) => {
          const gone = await tx
            .delete(occurrences)
            .where(and(eq(occurrences.errandId, errandId), eq(occurrences.date, date)))
            .returning();
          if (gone.length) await ctx.outbox.emit(tx, "errand.occurrence.cleared", c.householdId, { errandId, date }, c.sub);
        });
        return { ok: true };
      });
    },

    async consumers(ctx: Ctx) {
      // A removed member's errands become unassigned.
      await consume(ctx.db, ctx.bus, ctx.outbox, "errand-identity", ["identity.user.removed"], async (tx, event) => {
        const { userId } = event.data as EventCatalog["identity.user.removed"];
        const rows = await tx
          .update(errands)
          .set({ assigneeId: null })
          .where(and(eq(errands.householdId, event.householdId), eq(errands.assigneeId, userId)))
          .returning();
        for (const r of rows) await ctx.outbox.emit(tx, "errand.upserted", event.householdId, { errand: toErrand(r) }, event.actorId);
      });
    },
  };
}
