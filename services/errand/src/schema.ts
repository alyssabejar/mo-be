import type { ErrandCategory, OccurrenceStatus, Priority } from "@mamamo/contracts";
import { boolean, date, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export { outbox, processedEvents } from "@mamamo/service-kit/tables";

/** RRULE stored once; occurrences are expanded on read. */
export const errands = pgTable(
  "errands",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    title: text("title").notNull(),
    notes: text("notes"),
    category: text("category").$type<ErrandCategory>().notNull(),
    priority: text("priority").$type<Priority>().notNull(),
    assigneeId: text("assignee_id"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    time: text("time"),
    rrule: text("rrule"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    archived: boolean("archived").notNull().default(false),
  },
  (t) => [index("errands_household_idx").on(t.householdId)],
);

/** Exception rows: one per occurrence someone marked done, skipped or rescheduled. */
export const occurrences = pgTable(
  "occurrences",
  {
    errandId: text("errand_id")
      .notNull()
      .references(() => errands.id, { onDelete: "cascade" }),
    householdId: text("household_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    status: text("status").$type<OccurrenceStatus>().notNull(),
    completedBy: text("completed_by"),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    rescheduledTo: date("rescheduled_to", { mode: "string" }),
    note: text("note"),
  },
  (t) => [primaryKey({ columns: [t.errandId, t.date] }), index("occurrences_household_idx").on(t.householdId)],
);
