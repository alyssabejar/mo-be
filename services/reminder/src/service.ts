import { AddParcelRequest, CreateBillRequest, CreateSupplyRequest, MarkBillPaidRequest, ParcelStatus, SupplyStatus, type BillCycle, type Parcel } from "@mamamo/contracts";
import {
  ApiError,
  applyUserEvent,
  consume,
  IDENTITY_USER_SUBJECTS,
  notFound,
  requireCan,
  todayManila,
  uid,
  type EventCatalog,
  type Queryable,
  type ServiceContext,
  type ServiceModule,
} from "@mamamo/service-kit";
import { and, desc, eq, ne } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { billsWithCycles, currentCycle, ensureBillCycles, toBill, toCycle, toParcel, toSupply } from "./mappers";
import * as schema from "./schema";
import { billCycles, bills, errandsView, mealsView, occurrencesView, parcels, supplies } from "./schema";
import { sweep } from "./sweep";

type Ctx = ServiceContext<typeof schema>;

const PARCEL_FLOW: ParcelStatus[] = ["info_received", "in_transit", "out_for_delivery"];
const PARCEL_MESSAGES: Record<ParcelStatus, string> = {
  info_received: "Shipment information received",
  in_transit: "In transit to the delivery hub",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  exception: "Delivery attempt failed",
};
const PARCEL_ORDER: Record<ParcelStatus, number> = { out_for_delivery: 0, exception: 1, in_transit: 2, info_received: 3, delivered: 4 };

/** Courier aggregator webhook (AfterShip or TrackingMore, still to be chosen), normalised. */
const CourierWebhook = z.object({
  trackingNumber: z.string().min(4),
  status: ParcelStatus,
  message: z.string().optional(),
  at: z.string().datetime({ offset: true }).optional(),
});

export function reminderModule(): ServiceModule<typeof schema> {
  return {
    name: "reminder",
    schema,
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),

    async routes(app, ctx: Ctx) {
      const { db, outbox } = ctx;

      /** Write a parcel status change and the events notification and the UI need. */
      const moveParcel = async (tx: Queryable<any>, p: typeof parcels.$inferSelect, status: ParcelStatus, message: string, actorId?: string, at = new Date().toISOString()) => {
        const extra = status === "delivered" ? { receivedAt: at, ...(actorId ? { receivedBy: actorId } : {}) } : {};
        const [row] = await tx
          .update(parcels)
          .set({ status, events: [...p.events, { at, status, message }], ...extra })
          .where(eq(parcels.id, p.id))
          .returning();
        const parcel = toParcel(row!);
        await outbox.emit(tx, "parcel.upserted", p.householdId, { parcel }, actorId);
        if (status !== p.status) await outbox.emit(tx, "parcel.status.changed", p.householdId, { parcel, previous: p.status }, actorId);
        return parcel;
      };

      // ---------- supplies ----------

      app.get("/supplies", async (req) => {
        const c = requireCan(req, "supplies.check");
        const rows = await db.select().from(supplies).where(eq(supplies.householdId, c.householdId));
        return rows.map(toSupply).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
      });

      app.post<{ Params: { id: string } }>("/supplies/:id/check", async (req) => {
        const c = requireCan(req, "supplies.check");
        const { status } = z.object({ status: SupplyStatus }).parse(req.body);
        return db.transaction(async (tx) => {
          const [row] = await tx
            .update(supplies)
            .set({ lastStatus: status, lastCheckedAt: new Date().toISOString(), lastCheckedBy: c.sub })
            .where(and(eq(supplies.id, req.params.id), eq(supplies.householdId, c.householdId)))
            .returning();
          if (!row) notFound("Supply");
          const supply = toSupply(row);
          await outbox.emit(tx, "supply.checked", c.householdId, { supply, status }, c.sub);
          // meal-service adds Low/Out items to this week's list from the event.
          return { supply, addedToList: status !== "ok" };
        });
      });

      app.post("/supplies", async (req, reply) => {
        const c = requireCan(req, "supplies.manage");
        const body = CreateSupplyRequest.parse(req.body);
        const supply = await db.transaction(async (tx) => {
          const [row] = await tx.insert(supplies).values({ ...body, id: uid("s"), householdId: c.householdId }).returning();
          const s = toSupply(row!);
          await outbox.emit(tx, "supply.upserted", c.householdId, { supply: s }, c.sub);
          return s;
        });
        reply.status(201);
        return supply;
      });

      app.put<{ Params: { id: string } }>("/supplies/:id", async (req) => {
        const c = requireCan(req, "supplies.manage");
        const body = CreateSupplyRequest.parse(req.body);
        return db.transaction(async (tx) => {
          const [row] = await tx
            .update(supplies)
            .set({ assigneeId: null, restockUnit: null, estPrice: null, ...body })
            .where(and(eq(supplies.id, req.params.id), eq(supplies.householdId, c.householdId)))
            .returning();
          if (!row) notFound("Supply");
          const s = toSupply(row);
          await outbox.emit(tx, "supply.upserted", c.householdId, { supply: s }, c.sub);
          return s;
        });
      });

      app.delete<{ Params: { id: string } }>("/supplies/:id", async (req) => {
        const c = requireCan(req, "supplies.manage");
        await db.transaction(async (tx) => {
          const gone = await tx.delete(supplies).where(and(eq(supplies.id, req.params.id), eq(supplies.householdId, c.householdId))).returning();
          if (gone.length) await outbox.emit(tx, "supply.removed", c.householdId, { supplyId: req.params.id }, c.sub);
        });
        return { ok: true };
      });

      // ---------- bills ----------

      app.get("/bills", async (req) => {
        const c = requireCan(req, "bills.manage");
        const today = todayManila();
        return db.transaction(async (tx) => {
          const { bills: bs } = await billsWithCycles(tx, c.householdId);
          for (const cy of await ensureBillCycles(tx, bs, today)) await outbox.emit(tx, "bill.cycle.upserted", c.householdId, { cycle: toCycle(cy) });
          const { cycles } = await billsWithCycles(tx, c.householdId);
          return bs.map((b) => {
            const mine = cycles.filter((cy) => cy.billId === b.id).map(toCycle).sort((a, z) => z.dueDate.localeCompare(a.dueDate));
            const current = currentCycle(mine, today);
            return { ...toBill(b), cycles: mine, ...(current ? { current } : {}) };
          });
        });
      });

      app.post("/bills", async (req, reply) => {
        const c = requireCan(req, "bills.manage");
        const body = CreateBillRequest.parse(req.body);
        const bill = await db.transaction(async (tx) => {
          const [row] = await tx.insert(bills).values({ ...body, id: uid("b"), householdId: c.householdId }).returning();
          await outbox.emit(tx, "bill.upserted", c.householdId, { bill: toBill(row!) }, c.sub);
          for (const cy of await ensureBillCycles(tx, [row!], todayManila())) await outbox.emit(tx, "bill.cycle.upserted", c.householdId, { cycle: toCycle(cy) });
          return toBill(row!);
        });
        reply.status(201);
        return bill;
      });

      app.put<{ Params: { id: string } }>("/bills/:id", async (req) => {
        const c = requireCan(req, "bills.manage");
        const body = CreateBillRequest.parse(req.body);
        return db.transaction(async (tx) => {
          const [prev] = await tx.select().from(bills).where(and(eq(bills.id, req.params.id), eq(bills.householdId, c.householdId)));
          if (!prev) notFound("Bill");
          const [row] = await tx
            .update(bills)
            .set({ provider: null, accountNumber: null, typicalAmount: null, ...body })
            .where(eq(bills.id, prev.id))
            .returning();
          await outbox.emit(tx, "bill.upserted", c.householdId, { bill: toBill(row!) }, c.sub);
          if (prev.dueDay !== body.dueDay) {
            // Drop unpaid future cycles on the old due day; they're recreated on the new one.
            const today = todayManila();
            const unpaidFuture = (await tx.select().from(billCycles).where(eq(billCycles.billId, prev.id))).filter((cy) => !cy.paidAt && cy.dueDate >= today);
            for (const cy of unpaidFuture) {
              await tx.delete(billCycles).where(eq(billCycles.id, cy.id));
              await outbox.emit(tx, "bill.cycle.removed", c.householdId, { cycleId: cy.id }, c.sub);
            }
            for (const cy of await ensureBillCycles(tx, [row!], today)) await outbox.emit(tx, "bill.cycle.upserted", c.householdId, { cycle: toCycle(cy) });
          }
          return toBill(row!);
        });
      });

      app.delete<{ Params: { id: string } }>("/bills/:id", async (req) => {
        const c = requireCan(req, "bills.manage");
        await db.transaction(async (tx) => {
          const gone = await tx.delete(bills).where(and(eq(bills.id, req.params.id), eq(bills.householdId, c.householdId))).returning();
          if (gone.length) await outbox.emit(tx, "bill.removed", c.householdId, { billId: req.params.id }, c.sub);
        });
        return { ok: true };
      });

      app.post("/bills/pay", async (req) => {
        const c = requireCan(req, "bills.manage");
        const body = MarkBillPaidRequest.parse(req.body);
        return db.transaction(async (tx) => {
          const [row] = await tx
            .update(billCycles)
            .set({ amount: body.amount, paidAt: new Date().toISOString(), paidBy: c.sub, ...(body.receipt ? { receipt: body.receipt } : {}) })
            .where(and(eq(billCycles.id, body.cycleId), eq(billCycles.householdId, c.householdId)))
            .returning();
          if (!row) notFound("Bill cycle");
          const cycle: BillCycle = toCycle(row);
          await outbox.emit(tx, "bill.cycle.paid", c.householdId, { cycle }, c.sub);
          return cycle;
        });
      });

      app.post<{ Params: { id: string } }>("/bills/cycles/:id/snooze", async (req) => {
        const c = requireCan(req, "bills.manage");
        const { hours } = z.object({ hours: z.number().positive().max(24 * 14) }).parse(req.body ?? { hours: 24 });
        return db.transaction(async (tx) => {
          const [row] = await tx
            .update(billCycles)
            .set({ snoozedUntil: new Date(Date.now() + hours * 3_600_000).toISOString() })
            .where(and(eq(billCycles.id, req.params.id), eq(billCycles.householdId, c.householdId)))
            .returning();
          if (!row) notFound("Bill cycle");
          const cycle = toCycle(row);
          await outbox.emit(tx, "bill.cycle.snoozed", c.householdId, { cycle }, c.sub);
          return cycle;
        });
      });

      // ---------- parcels ----------

      app.get("/parcels", async (req) => {
        const c = requireCan(req, "parcels.manage");
        const rows = await db.select().from(parcels).where(eq(parcels.householdId, c.householdId)).orderBy(desc(parcels.createdAt));
        return rows.map(toParcel).sort((a, b) => PARCEL_ORDER[a.status] - PARCEL_ORDER[b.status] || b.createdAt.localeCompare(a.createdAt));
      });

      app.post("/parcels", async (req, reply) => {
        const c = requireCan(req, "parcels.manage");
        const body = AddParcelRequest.parse(req.body);
        const parcel = await db.transaction(async (tx) => {
          const dup = await tx
            .select({ id: parcels.id })
            .from(parcels)
            .where(and(eq(parcels.householdId, c.householdId), eq(parcels.trackingNumber, body.trackingNumber), ne(parcels.status, "delivered")));
          if (dup.length) throw new ApiError(409, "duplicate", "That tracking number is already being tracked.");
          const now = new Date().toISOString();
          const [row] = await tx
            .insert(parcels)
            .values({
              ...body,
              id: uid("p"),
              householdId: c.householdId,
              status: "info_received",
              addedBy: c.sub,
              events: [{ at: now, status: "info_received", message: `Registered with the tracking aggregator (${body.courier})` }],
            })
            .returning();
          const p: Parcel = toParcel(row!);
          await outbox.emit(tx, "parcel.upserted", c.householdId, { parcel: p }, c.sub);
          return p;
        });
        reply.status(201);
        return parcel;
      });

      /** Manual refresh: moves the parcel one step until the aggregator webhook is live. */
      app.post<{ Params: { id: string } }>("/parcels/:id/refresh", async (req) => {
        const c = requireCan(req, "parcels.manage");
        return db.transaction(async (tx) => {
          const [p] = await tx.select().from(parcels).where(and(eq(parcels.id, req.params.id), eq(parcels.householdId, c.householdId))).for("update");
          if (!p) notFound("Parcel");
          const i = PARCEL_FLOW.indexOf(p.status);
          if (i < 0 || i >= PARCEL_FLOW.length - 1) return toParcel(p);
          const next = PARCEL_FLOW[i + 1]!;
          return moveParcel(tx, p, next, PARCEL_MESSAGES[next], c.sub);
        });
      });

      app.post<{ Params: { id: string } }>("/parcels/:id/received", async (req) => {
        const c = requireCan(req, "parcels.manage");
        const { by } = z.object({ by: z.string().optional() }).parse(req.body ?? {});
        return db.transaction(async (tx) => {
          const [p] = await tx.select().from(parcels).where(and(eq(parcels.id, req.params.id), eq(parcels.householdId, c.householdId))).for("update");
          if (!p) notFound("Parcel");
          return moveParcel(tx, p, "delivered", by ? `Received by ${by}` : "Received", c.sub);
        });
      });

      app.delete<{ Params: { id: string } }>("/parcels/:id", async (req) => {
        const c = requireCan(req, "parcels.manage");
        await db.transaction(async (tx) => {
          const gone = await tx.delete(parcels).where(and(eq(parcels.id, req.params.id), eq(parcels.householdId, c.householdId))).returning();
          if (gone.length) await outbox.emit(tx, "parcel.removed", c.householdId, { parcelId: req.params.id }, c.sub);
        });
        return { ok: true };
      });

      app.post("/webhooks/courier", { config: { public: true } }, async (req) => {
        const secret = ctx.env.COURIER_WEBHOOK_SECRET;
        const given = String(req.headers["x-webhook-secret"] ?? "");
        if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
          throw new ApiError(401, "bad_signature", "Webhook secret did not match.");
        }
        const body = CourierWebhook.parse(req.body);
        return db.transaction(async (tx) => {
          const rows = await tx.select().from(parcels).where(and(eq(parcels.trackingNumber, body.trackingNumber), ne(parcels.status, "delivered"))).for("update");
          for (const p of rows) await moveParcel(tx, p, body.status, body.message ?? PARCEL_MESSAGES[body.status], undefined, body.at);
          return { updated: rows.length };
        });
      });

      // ---------- sweep ----------

      /** Run the reconciler now (owner only; it also runs every 5 minutes). */
      app.post("/sweep", async (req) => {
        requireCan(req, "household.settings");
        const due = await db.transaction((tx) => sweep(tx, outbox));
        return { fired: due.length };
      });
    },

    async consumers(ctx: Ctx) {
      const { db, bus, outbox } = ctx;
      await consume(db, bus, outbox, "reminder-identity", IDENTITY_USER_SUBJECTS, async (tx, event) => {
        await applyUserEvent(tx, event);
      });
      await consume(db, bus, outbox, "reminder-errands", ["errand.upserted", "errand.archived", "errand.occurrence.completed", "errand.occurrence.cleared"], async (tx, event) => {
        switch (event.subject) {
          case "errand.upserted": {
            const { errand: e } = event.data as EventCatalog["errand.upserted"];
            const values = { householdId: e.householdId, title: e.title, assigneeId: e.assigneeId ?? null, createdBy: e.createdBy, startDate: e.startDate, rrule: e.rrule ?? null, archived: e.archived };
            await tx.insert(errandsView).values({ id: e.id, ...values }).onConflictDoUpdate({ target: errandsView.id, set: values });
            break;
          }
          case "errand.archived": {
            const { errandId } = event.data as EventCatalog["errand.archived"];
            await tx.update(errandsView).set({ archived: true }).where(eq(errandsView.id, errandId));
            break;
          }
          case "errand.occurrence.completed": {
            const { occurrence: o } = event.data as EventCatalog["errand.occurrence.completed"];
            await tx
              .insert(occurrencesView)
              .values({ errandId: o.errandId, date: o.date, status: o.status })
              .onConflictDoUpdate({ target: [occurrencesView.errandId, occurrencesView.date], set: { status: o.status } });
            break;
          }
          case "errand.occurrence.cleared": {
            const { errandId, date } = event.data as EventCatalog["errand.occurrence.cleared"];
            await tx.delete(occurrencesView).where(and(eq(occurrencesView.errandId, errandId), eq(occurrencesView.date, date)));
            break;
          }
        }
      });
      await consume(db, bus, outbox, "reminder-meals", ["meal.slot.upserted", "meal.slot.removed"], async (tx, event) => {
        if (event.subject === "meal.slot.removed") {
          const { mealId } = event.data as EventCatalog["meal.slot.removed"];
          await tx.delete(mealsView).where(eq(mealsView.id, mealId));
          return;
        }
        const { meal: m } = event.data as EventCatalog["meal.slot.upserted"];
        const values = { householdId: m.householdId, date: m.date, slot: m.slot, title: m.title, cookId: m.cookId ?? null };
        await tx.insert(mealsView).values({ id: m.id, ...values }).onConflictDoUpdate({ target: mealsView.id, set: values });
      });
    },

    jobs(ctx: Ctx) {
      const every = Number(ctx.env.SWEEP_INTERVAL_MS ?? 5 * 60_000);
      const run = () =>
        ctx.db
          .transaction((tx) => sweep(tx, ctx.outbox))
          .then((due) => due.length && ctx.log.info({ fired: due.length }, "reminder sweep"))
          .catch((err) => ctx.log.error({ err }, "reminder sweep failed"));
      const first = setTimeout(run, 5_000);
      const timer = setInterval(run, every);
      timer.unref();
      first.unref();
      return () => {
        clearTimeout(first);
        clearInterval(timer);
      };
    },
  };
}
