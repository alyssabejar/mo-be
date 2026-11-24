import type { Errand, ErrandOccurrence, LeaveRequest, PlannedMeal, Weekday } from "@mamamo/contracts";
import { boolean, date, index, jsonb, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

export { directory, outbox, processedEvents } from "@mamamo/service-kit/tables";

/**
 * The calendar read model. Every table here is rebuilt from other services'
 * events; nothing is written by calendar's own API.
 */

export const mealsView = pgTable(
  "meals_view",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    meal: jsonb("meal").$type<PlannedMeal>().notNull(),
  },
  (t) => [index("cal_meals_idx").on(t.householdId, t.date)],
);

export const errandsView = pgTable(
  "errands_view",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    errand: jsonb("errand").$type<Errand>().notNull(),
  },
  (t) => [index("cal_errands_idx").on(t.householdId)],
);

export const occurrencesView = pgTable(
  "occurrences_view",
  {
    errandId: text("errand_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    householdId: text("household_id").notNull(),
    occurrence: jsonb("occurrence").$type<ErrandOccurrence>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.errandId, t.date] }), index("cal_occ_idx").on(t.householdId)],
);

export const leavesView = pgTable(
  "leaves_view",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    leave: jsonb("leave").$type<LeaveRequest>().notNull(),
  },
  (t) => [index("cal_leaves_idx").on(t.householdId)],
);

export const restDaysView = pgTable("rest_days_view", {
  userId: text("user_id").primaryKey(),
  householdId: text("household_id").notNull(),
  restDay: text("rest_day").$type<Weekday>().notNull(),
});

export const billsView = pgTable("bills_view", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  name: text("name").notNull(),
  assigneeId: text("assignee_id").notNull(),
});

export const billCyclesView = pgTable(
  "bill_cycles_view",
  {
    id: text("id").primaryKey(),
    billId: text("bill_id").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    paid: boolean("paid").notNull(),
  },
  (t) => [index("cal_cycles_idx").on(t.billId)],
);
