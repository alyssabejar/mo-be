import { can, IsoDate, type IsoDate as Day, type Role } from "@mamamo/contracts";
import {
  addDays,
  applyUserEvent,
  claims,
  consume,
  directoryUsers,
  errandInstances,
  liveTopicsFor,
  notFound,
  requireCan,
  STREAM_SUBJECTS,
  todayManila,
  weekdayOf,
  type EventCatalog,
  type EventEnvelope,
  type Queryable,
  type ServiceContext,
  type ServiceModule,
  type Tx,
} from "@mamamo/service-kit";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { LIVE_CHANNEL, LiveHub } from "./live";
import * as schema from "./schema";
import { billCyclesView, billsView, errandsView, leavesView, mealsView, occurrencesView, restDaysView } from "./schema";

type Ctx = ServiceContext<typeof schema>;

export type CalendarEntryKind = "meal" | "errand" | "leave" | "restday" | "bill";
export interface CalendarEntry {
  id: string;
  kind: CalendarEntryKind;
  title: string;
  date: Day;
  endDate?: Day;
  time?: string;
  allDay: boolean;
  done?: boolean;
  overdue?: boolean;
  assigneeId?: string;
  slot?: string;
  status?: string;
}

async function loadErrands(db: Queryable<any>, householdId: string) {
  const [es, os] = await Promise.all([
    db.select().from(errandsView).where(eq(errandsView.householdId, householdId)),
    db.select().from(occurrencesView).where(eq(occurrencesView.householdId, householdId)),
  ]);
  return { errands: es.map((e) => e.errand), occurrences: os.map((o) => o.occurrence) };
}

export async function calendarRange(db: Queryable<any>, viewer: { id: string; householdId: string; role: Role }, from: Day, to: Day): Promise<CalendarEntry[]> {
  const hh = viewer.householdId;
  const [ms, { errands, occurrences }, ls, rds, users] = await Promise.all([
    db.select().from(mealsView).where(and(eq(mealsView.householdId, hh), gte(mealsView.date, from), lte(mealsView.date, to))),
    loadErrands(db, hh),
    db.select().from(leavesView).where(eq(leavesView.householdId, hh)),
    db.select().from(restDaysView).where(eq(restDaysView.householdId, hh)),
    directoryUsers(db, hh),
  ]);
  const name = (id: string) => users.find((u) => u.id === id)?.displayName ?? "Helper";
  const out: CalendarEntry[] = [];

  for (const { meal: m } of ms) {
    out.push({ id: `meal:${m.id}`, kind: "meal", title: m.title, date: m.date, slot: m.slot, allDay: false, ...(m.cookId ? { assigneeId: m.cookId } : {}) });
  }
  for (const i of errandInstances({ errands, occurrences, from, to, today: todayManila(), viewer })) {
    out.push({
      id: `errand:${i.errand.id}:${i.dueDate}`,
      kind: "errand",
      title: i.errand.title,
      date: i.date,
      ...(i.errand.time ? { time: i.errand.time } : {}),
      allDay: !i.errand.time,
      done: i.occurrence?.status === "done",
      overdue: i.overdue,
      ...(i.errand.assigneeId ? { assigneeId: i.errand.assigneeId } : {}),
      ...(i.occurrence ? { status: i.occurrence.status } : {}),
    });
  }
  for (const { leave: l } of ls) {
    if (l.status !== "approved" && l.status !== "pending") continue;
    if (l.endDate < from || l.startDate > to) continue;
    out.push({ id: `leave:${l.id}`, kind: "leave", title: name(l.helperId), date: l.startDate, endDate: l.endDate, allDay: true, status: l.status, assigneeId: l.helperId });
  }
  for (const rd of rds) {
    if (!users.some((u) => u.id === rd.userId)) continue;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (weekdayOf(d) === rd.restDay) out.push({ id: `rest:${rd.userId}:${d}`, kind: "restday", title: name(rd.userId), date: d, allDay: true, assigneeId: rd.userId });
    }
  }
  if (can(viewer.role, "bills.manage")) {
    const bs = await db.select().from(billsView).where(eq(billsView.householdId, hh));
    const cs = bs.length
      ? await db
          .select()
          .from(billCyclesView)
          .where(and(inArray(billCyclesView.billId, bs.map((b) => b.id)), gte(billCyclesView.dueDate, from), lte(billCyclesView.dueDate, to)))
      : [];
    for (const c of cs) {
      const b = bs.find((x) => x.id === c.billId);
      if (b) out.push({ id: `bill:${c.id}`, kind: "bill", title: b.name, date: c.dueDate, allDay: true, done: c.paid, assigneeId: b.assigneeId });
    }
  }
  return out;
}

/** Apply one event to the read model. Returns true if it touched calendar data. */
async function project(tx: Tx<any>, event: EventEnvelope<any>): Promise<boolean> {
  const hh = event.householdId;
  switch (event.subject) {
    case "meal.slot.upserted": {
      const { meal } = event.data as EventCatalog["meal.slot.upserted"];
      await tx.insert(mealsView).values({ id: meal.id, householdId: hh, date: meal.date, meal }).onConflictDoUpdate({ target: mealsView.id, set: { date: meal.date, meal } });
      return true;
    }
    case "meal.slot.removed": {
      const { mealId } = event.data as EventCatalog["meal.slot.removed"];
      await tx.delete(mealsView).where(eq(mealsView.id, mealId));
      return true;
    }
    case "errand.upserted": {
      const { errand } = event.data as EventCatalog["errand.upserted"];
      await tx.insert(errandsView).values({ id: errand.id, householdId: hh, errand }).onConflictDoUpdate({ target: errandsView.id, set: { errand } });
      return true;
    }
    case "errand.archived": {
      const { errandId } = event.data as EventCatalog["errand.archived"];
      await tx.update(errandsView).set({ errand: sql`jsonb_set(${errandsView.errand}, '{archived}', 'true')` }).where(eq(errandsView.id, errandId));
      return true;
    }
    case "errand.occurrence.completed": {
      const { occurrence } = event.data as EventCatalog["errand.occurrence.completed"];
      await tx
        .insert(occurrencesView)
        .values({ errandId: occurrence.errandId, date: occurrence.date, householdId: hh, occurrence })
        .onConflictDoUpdate({ target: [occurrencesView.errandId, occurrencesView.date], set: { occurrence } });
      return true;
    }
    case "errand.occurrence.cleared": {
      const { errandId, date } = event.data as EventCatalog["errand.occurrence.cleared"];
      await tx.delete(occurrencesView).where(and(eq(occurrencesView.errandId, errandId), eq(occurrencesView.date, date)));
      return true;
    }
    case "staff.leave.requested":
    case "staff.leave.approved":
    case "staff.leave.rejected":
    case "staff.leave.cancelled": {
      const { leave } = event.data as EventCatalog["staff.leave.requested"];
      await tx.insert(leavesView).values({ id: leave.id, householdId: hh, leave }).onConflictDoUpdate({ target: leavesView.id, set: { leave } });
      return true;
    }
    case "staff.profile.upserted": {
      const { profile } = event.data as EventCatalog["staff.profile.upserted"];
      await tx
        .insert(restDaysView)
        .values({ userId: profile.userId, householdId: hh, restDay: profile.restDay })
        .onConflictDoUpdate({ target: restDaysView.userId, set: { restDay: profile.restDay } });
      return true;
    }
    case "bill.upserted": {
      const { bill } = event.data as EventCatalog["bill.upserted"];
      await tx
        .insert(billsView)
        .values({ id: bill.id, householdId: hh, name: bill.name, assigneeId: bill.assigneeId })
        .onConflictDoUpdate({ target: billsView.id, set: { name: bill.name, assigneeId: bill.assigneeId } });
      return true;
    }
    case "bill.removed": {
      const { billId } = event.data as EventCatalog["bill.removed"];
      await tx.delete(billCyclesView).where(eq(billCyclesView.billId, billId));
      await tx.delete(billsView).where(eq(billsView.id, billId));
      return true;
    }
    case "bill.cycle.upserted":
    case "bill.cycle.paid":
    case "bill.cycle.snoozed": {
      const { cycle } = event.data as EventCatalog["bill.cycle.upserted"];
      const values = { billId: cycle.billId, dueDate: cycle.dueDate, paid: !!cycle.paidAt };
      await tx.insert(billCyclesView).values({ id: cycle.id, ...values }).onConflictDoUpdate({ target: billCyclesView.id, set: values });
      return true;
    }
    case "bill.cycle.removed": {
      const { cycleId } = event.data as EventCatalog["bill.cycle.removed"];
      await tx.delete(billCyclesView).where(eq(billCyclesView.id, cycleId));
      return true;
    }
    case "identity.user.removed": {
      const { userId } = event.data as EventCatalog["identity.user.removed"];
      await applyUserEvent(tx, event);
      await tx.delete(restDaysView).where(eq(restDaysView.userId, userId));
      return true;
    }
    case "identity.user.created":
    case "identity.user.updated":
      await applyUserEvent(tx, event);
      return true;
    default:
      return false;
  }
}

export function calendarModule(): ServiceModule<typeof schema> {
  let hub: LiveHub | undefined;
  return {
    name: "calendar",
    schema,
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),

    async routes(app, ctx: Ctx) {
      const { db } = ctx;
      hub = new LiveHub(ctx.log);
      await hub.start(ctx.pool);

      app.get("/calendar", async (req) => {
        const c = claims(req);
        const { from, to } = z.object({ from: IsoDate, to: IsoDate }).parse(req.query);
        return calendarRange(db, { id: c.sub, householdId: c.householdId, role: c.role }, from, to);
      });

      /** Errands and meals that fall on the helper while they'd be away. */
      app.get<{ Params: { leaveId: string } }>("/leave-impact/:leaveId", async (req) => {
        const c = requireCan(req, "leave.approve");
        const [row] = await db.select().from(leavesView).where(and(eq(leavesView.id, req.params.leaveId), eq(leavesView.householdId, c.householdId)));
        if (!row) notFound("Request");
        const l = row.leave;
        const { errands, occurrences } = await loadErrands(db, c.householdId);
        const instances = errandInstances({ errands, occurrences, from: l.startDate, to: l.endDate, today: todayManila() }).filter((i) => i.errand.assigneeId === l.helperId);
        const ms = await db
          .select()
          .from(mealsView)
          .where(and(eq(mealsView.householdId, c.householdId), gte(mealsView.date, l.startDate), lte(mealsView.date, l.endDate)));
        const meals = ms.map((m) => m.meal).filter((m) => m.cookId === l.helperId).sort((a, b) => a.date.localeCompare(b.date));
        return { errands: instances, meals };
      });

      /** SSE stream of changed topics for the caller's household. EventSource passes ?access_token=. */
      app.get("/live", async (req, reply) => {
        const c = claims(req);
        reply.hijack();
        reply.raw.writeHead(200, {
          ...(reply.getHeaders() as Record<string, string>),
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        reply.raw.write(`retry: 5000\nevent: ready\ndata: {}\n\n`);
        hub!.add(c.householdId, reply);
      });
    },

    async consumers(ctx: Ctx) {
      await consume(ctx.db, ctx.bus, ctx.outbox, "calendar-projection", STREAM_SUBJECTS, async (tx, event) => {
        await project(tx, event);
        // The browser refetches calendar queries on any non-inbox topic.
        const topics = liveTopicsFor(event.subject);
        if (!topics.length) return;
        // Delivered to every replica's LISTEN connection when this transaction commits.
        await tx.execute(sql`select pg_notify(${LIVE_CHANNEL}, ${JSON.stringify({ householdId: event.householdId, topics: [...new Set(topics)] })})`);
      });
    },

    jobs() {
      return () => hub?.stop();
    },
  };
}
