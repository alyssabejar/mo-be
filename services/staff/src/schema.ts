import type { LeaveStatus, LeaveType, Weekday } from "@mamamo/contracts";
import { date, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export { outbox, processedEvents } from "@mamamo/service-kit/tables";

export const helperProfiles = pgTable(
  "helper_profiles",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    userId: text("user_id").notNull().unique(),
    hireDate: date("hire_date", { mode: "string" }).notNull(),
    birthDate: date("birth_date", { mode: "string" }),
    restDay: text("rest_day").$type<Weekday>().notNull(),
    /** Unused weekly rest days earned so far (capped at 5 when read). */
    accumulatedRestEarned: integer("accumulated_rest_earned").notNull().default(0),
    displayName: text("display_name").notNull().default(""),
  },
  (t) => [index("helper_profiles_household_idx").on(t.householdId)],
);

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    helperId: text("helper_id").notNull(),
    type: text("type").$type<LeaveType>().notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    swapFrom: date("swap_from", { mode: "string" }),
    reason: text("reason"),
    status: text("status").$type<LeaveStatus>().notNull(),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "string" }),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [index("leave_requests_household_idx").on(t.householdId), index("leave_requests_helper_idx").on(t.helperId)],
);
