import type { BillKind, Courier, MealSlotKind, OccurrenceStatus, ParcelStatus, SupplyCategory, SupplyStatus } from "@mamamo/contracts";
import { boolean, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export { directory, outbox, processedEvents } from "@mamamo/service-kit/tables";

export const supplies = pgTable(
  "supplies",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    name: text("name").notNull(),
    category: text("category").$type<SupplyCategory>().notNull(),
    checkRule: text("check_rule").notNull(),
    checkStartDate: date("check_start_date", { mode: "string" }).notNull(),
    assigneeId: text("assignee_id"),
    lastStatus: text("last_status").$type<SupplyStatus>(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true, mode: "string" }),
    lastCheckedBy: text("last_checked_by"),
    restockQty: doublePrecision("restock_qty").notNull(),
    restockUnit: text("restock_unit"),
    estPrice: integer("est_price"),
  },
  (t) => [index("supplies_household_idx").on(t.householdId)],
);

export const bills = pgTable(
  "bills",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").$type<BillKind>().notNull(),
    provider: text("provider"),
    accountNumber: text("account_number"),
    dueDay: integer("due_day").notNull(),
    remindDaysBefore: integer("remind_days_before").notNull(),
    assigneeId: text("assignee_id").notNull(),
    typicalAmount: integer("typical_amount"),
  },
  (t) => [index("bills_household_idx").on(t.householdId)],
);

export const billCycles = pgTable(
  "bill_cycles",
  {
    id: text("id").primaryKey(),
    billId: text("bill_id")
      .notNull()
      .references(() => bills.id, { onDelete: "cascade" }),
    householdId: text("household_id").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    amount: integer("amount"),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "string" }),
    paidBy: text("paid_by"),
    /** Receipt photo. A data URL until object storage (MinIO or S3, still open) is chosen. */
    receipt: text("receipt"),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true, mode: "string" }),
  },
  (t) => [index("bill_cycles_bill_idx").on(t.billId)],
);

export const parcels = pgTable(
  "parcels",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    trackingNumber: text("tracking_number").notNull(),
    courier: text("courier").$type<Courier>().notNull(),
    description: text("description").notNull(),
    codAmount: integer("cod_amount"),
    status: text("status").$type<ParcelStatus>().notNull(),
    events: jsonb("events").$type<{ at: string; status: ParcelStatus; message: string }[]>().notNull(),
    addedBy: text("added_by").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "string" }),
    receivedBy: text("received_by"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [index("parcels_household_idx").on(t.householdId), index("parcels_tracking_idx").on(t.trackingNumber)],
);

/** Each reminder fires once per (key, level, user); the sweep can run as often as it likes. */
export const fired = pgTable("fired_reminders", {
  key: text("key").primaryKey(),
  firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- projections the sweep reads (from errand.* and meal.* events) ----

export const errandsView = pgTable("errands_view", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  title: text("title").notNull(),
  assigneeId: text("assignee_id"),
  createdBy: text("created_by").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  rrule: text("rrule"),
  archived: boolean("archived").notNull(),
});

export const occurrencesView = pgTable(
  "occurrences_view",
  {
    errandId: text("errand_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    status: text("status").$type<OccurrenceStatus>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.errandId, t.date] })],
);

export const mealsView = pgTable("meals_view", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  slot: text("slot").$type<MealSlotKind>().notNull(),
  title: text("title").notNull(),
  cookId: text("cook_id"),
});
