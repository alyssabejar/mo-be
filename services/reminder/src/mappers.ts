import type { Bill, BillCycle, Parcel, SupplyItem } from "@mamamo/contracts";
import { addDays, billDueDate, compact, diffDays, toUtcDate, type Queryable } from "@mamamo/service-kit";
import { eq, inArray } from "drizzle-orm";
import { billCycles, bills, parcels, supplies } from "./schema";

const iso = (v: string | null) => (v ? new Date(v).toISOString() : undefined);

export function toSupply(r: typeof supplies.$inferSelect): SupplyItem {
  return compact({
    id: r.id,
    householdId: r.householdId,
    name: r.name,
    category: r.category,
    checkRule: r.checkRule,
    checkStartDate: r.checkStartDate,
    assigneeId: r.assigneeId ?? undefined,
    lastStatus: r.lastStatus ?? undefined,
    lastCheckedAt: iso(r.lastCheckedAt),
    lastCheckedBy: r.lastCheckedBy ?? undefined,
    restockQty: r.restockQty,
    restockUnit: r.restockUnit ?? undefined,
    estPrice: r.estPrice ?? undefined,
  }) as SupplyItem;
}

export function toBill(r: typeof bills.$inferSelect): Bill {
  return compact({
    id: r.id,
    householdId: r.householdId,
    name: r.name,
    kind: r.kind,
    provider: r.provider ?? undefined,
    accountNumber: r.accountNumber ?? undefined,
    dueDay: r.dueDay,
    remindDaysBefore: r.remindDaysBefore,
    assigneeId: r.assigneeId,
    typicalAmount: r.typicalAmount ?? undefined,
  }) as Bill;
}

export function toCycle(r: typeof billCycles.$inferSelect): BillCycle {
  return compact({
    id: r.id,
    billId: r.billId,
    dueDate: r.dueDate,
    amount: r.amount ?? undefined,
    paidAt: iso(r.paidAt),
    paidBy: r.paidBy ?? undefined,
    receipt: r.receipt ?? undefined,
    snoozedUntil: iso(r.snoozedUntil),
  }) as BillCycle;
}

export function toParcel(r: typeof parcels.$inferSelect): Parcel {
  return compact({
    id: r.id,
    householdId: r.householdId,
    trackingNumber: r.trackingNumber,
    courier: r.courier,
    description: r.description,
    codAmount: r.codAmount ?? undefined,
    status: r.status,
    events: r.events,
    addedBy: r.addedBy,
    receivedAt: iso(r.receivedAt),
    receivedBy: r.receivedBy ?? undefined,
    createdAt: new Date(r.createdAt).toISOString(),
  }) as Parcel;
}

/** Cycle due dates for last, this and next month. */
export function cycleDates(dueDay: number, today: string): string[] {
  const t = toUtcDate(today);
  return [-1, 0, 1].map((offset) => {
    const m = t.getUTCMonth() + offset;
    return billDueDate(t.getUTCFullYear() + Math.floor(m / 12), ((m % 12) + 12) % 12, dueDay);
  });
}

/**
 * Make sure each bill has a cycle for last, this and next month. Returns the
 * cycles it created so the caller can publish them.
 */
export async function ensureBillCycles(db: Queryable<any>, billRows: (typeof bills.$inferSelect)[], today: string) {
  if (!billRows.length) return [];
  const existing = await db.select({ id: billCycles.id }).from(billCycles).where(inArray(billCycles.billId, billRows.map((b) => b.id)));
  const have = new Set(existing.map((c) => c.id));
  const fresh: (typeof billCycles.$inferInsert)[] = [];
  for (const b of billRows) {
    for (const due of cycleDates(b.dueDay, today)) {
      const id = `bc_${b.id}_${due}`;
      if (!have.has(id)) fresh.push({ id, billId: b.id, householdId: b.householdId, dueDate: due });
    }
  }
  if (!fresh.length) return [];
  return db.insert(billCycles).values(fresh).onConflictDoNothing().returning();
}

/** The current cycle is the oldest unpaid one due within a month, else the next unpaid. */
export function currentCycle(cycles: BillCycle[], today: string): BillCycle | undefined {
  const unpaid = cycles.filter((c) => !c.paidAt).sort((a, z) => a.dueDate.localeCompare(z.dueDate));
  return unpaid.find((c) => diffDays(c.dueDate, today) <= 31) ?? unpaid[0];
}

export async function billsWithCycles(db: Queryable<any>, householdId: string) {
  const bs = await db.select().from(bills).where(eq(bills.householdId, householdId));
  const cs = bs.length ? await db.select().from(billCycles).where(inArray(billCycles.billId, bs.map((b) => b.id))) : [];
  return { bills: bs, cycles: cs };
}

export { addDays };
