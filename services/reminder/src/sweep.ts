import type { User } from "@mamamo/contracts";
import {
  addDays,
  diffDays,
  expandRule,
  previousOccurrence,
  todayManila,
  type Outbox,
  type Queryable,
  type ReminderDue,
} from "@mamamo/service-kit";
import { and, eq, isNull } from "drizzle-orm";
import { directory } from "@mamamo/service-kit/tables";
import { ensureBillCycles, toCycle } from "./mappers";
import { billCycles, bills, errandsView, fired, mealsView, occurrencesView, supplies } from "./schema";

/** Sermon level for something `daysLate` days past due: 0 = due today. */
export function sermonLevel(daysLate: number): 1 | 2 | 3 {
  if (daysLate <= 1) return 1;
  if (daysLate === 2) return 2;
  return 3;
}

/**
 * The reconciler sweep. Postgres is the source of truth: every run recomputes
 * what is due and fires each reminder once per (key, level, user). Running it
 * more often, or after a crash, never sends a duplicate.
 */
export async function sweep(db: Queryable<any>, outbox: Outbox, now: Date = new Date()): Promise<ReminderDue[]> {
  const today = todayManila(now);
  const sent: ReminderDue[] = [];
  const users = new Map<string, User>(
    (await db.select().from(directory).where(isNull(directory.removedAt))).map((r) => [r.userId, r.user]),
  );

  const fire = async (householdId: string, r: ReminderDue) => {
    const inserted = await db.insert(fired).values({ key: `${r.key}:L${r.level}:${r.userId}` }).onConflictDoNothing().returning();
    if (!inserted.length) return;
    await outbox.emit(db, "reminder.due", householdId, r);
    sent.push(r);
  };

  // Bills: first nudge inside the reminder window, Sermon once overdue.
  const billRows = await db.select().from(bills);
  for (const c of await ensureBillCycles(db, billRows, today)) {
    await outbox.emit(db, "bill.cycle.upserted", c.householdId, { cycle: toCycle(c) });
  }
  const byBill = new Map(billRows.map((b) => [b.id, b]));
  for (const cycle of await db.select().from(billCycles).where(isNull(billCycles.paidAt))) {
    if (cycle.snoozedUntil && Date.parse(cycle.snoozedUntil) > now.getTime()) continue;
    const bill = byBill.get(cycle.billId);
    const user = bill && users.get(bill.assigneeId);
    if (!bill || !user) continue;
    const daysToDue = diffDays(cycle.dueDate, today);
    if (daysToDue > bill.remindDaysBefore) continue;
    const level: 1 | 2 | 3 = daysToDue >= 0 ? 1 : -daysToDue <= 2 ? 2 : 3;
    await fire(bill.householdId, {
      userId: user.id,
      kind: "bill_due",
      template: "bill_due",
      level,
      subject: `bill_cycle:${cycle.id}`,
      key: `bill:${cycle.id}`,
      actions: ["mark_paid", "snooze"],
      vars: { bill: bill.name, dueDate: cycle.dueDate, ...((cycle.amount ?? bill.typicalAmount) != null ? { amount: (cycle.amount ?? bill.typicalAmount)! } : {}) },
    });
  }

  // Supplies: nudge on check days until someone taps OK / Low / Out.
  for (const s of await db.select().from(supplies)) {
    const due = previousOccurrence(s.checkRule, s.checkStartDate, today);
    if (!due || diffDays(today, due) > 6) continue;
    if (s.lastCheckedAt && todayManila(new Date(s.lastCheckedAt)) >= due) continue;
    const targets = s.assigneeId
      ? [users.get(s.assigneeId)].filter((u): u is User => !!u)
      : [...users.values()].filter((u) => u.householdId === s.householdId && u.role === "helper");
    for (const user of targets) {
      await fire(s.householdId, {
        userId: user.id,
        kind: "supply_check",
        template: "supply_check",
        level: sermonLevel(diffDays(today, due)),
        subject: `supply:${s.id}`,
        key: `supply:${s.id}:${due}`,
        actions: ["check_supply"],
        vars: { item: s.name },
      });
    }
  }

  // Errands: due today, then the Sermon for the latest open overdue occurrence.
  const occ = await db.select().from(occurrencesView);
  const handled = new Set(occ.map((o) => `${o.errandId}|${o.date}`));
  for (const e of await db.select().from(errandsView).where(eq(errandsView.archived, false))) {
    const user = users.get(e.assigneeId ?? e.createdBy);
    if (!user) continue;
    const open = expandRule(e.rrule, e.startDate, addDays(today, -7), today).filter((d) => !handled.has(`${e.id}|${d}`));
    if (open.includes(today)) {
      await fire(e.householdId, {
        userId: user.id,
        kind: "errand_due",
        template: "errand_due",
        level: 1,
        subject: `errand:${e.id}:${today}`,
        key: `errand:${e.id}:${today}:due`,
        actions: ["mark_done"],
        vars: { errand: e.title },
      });
    }
    const latestOverdue = open.filter((d) => d < today).at(-1);
    if (latestOverdue) {
      const days = diffDays(today, latestOverdue);
      // A daily chore missed yesterday is replaced by today's; nag about it once.
      const level = e.rrule?.startsWith("FREQ=DAILY") ? 1 : sermonLevel(days);
      await fire(e.householdId, {
        userId: user.id,
        kind: "errand_overdue",
        template: "errand_overdue",
        level,
        subject: `errand:${e.id}:${latestOverdue}`,
        key: `errand:${e.id}:${latestOverdue}:overdue`,
        actions: ["mark_done"],
        vars: { errand: e.title, days },
      });
    }
  }

  // Today's cook gets told what to cook.
  for (const meal of await db.select().from(mealsView).where(and(eq(mealsView.date, today)))) {
    const user = meal.cookId ? users.get(meal.cookId) : undefined;
    if (!user) continue;
    await fire(meal.householdId, {
      userId: user.id,
      kind: "meal_cook",
      template: "meal_cook",
      level: 1,
      subject: `meal:${meal.id}`,
      key: `meal:${meal.id}`,
      actions: ["open"],
      vars: { meal: meal.title, slot: meal.slot },
    });
  }

  return sent;
}
