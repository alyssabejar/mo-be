import type { AiSettings, ChannelPrefs, Locale, QuietHours, Role } from "@mamamo/contracts";
import { boolean, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export { outbox, processedEvents } from "@mamamo/service-kit/tables";

export const households = pgTable("households", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  weeklyGroceryBudget: integer("weekly_grocery_budget").notNull().default(0),
  ai: jsonb("ai").$type<AiSettings>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

/**
 * Household members. `id` is the Better Auth user id; credentials live in Better
 * Auth's own tables (user, account, session, jwks) in this same database.
 */
export const members = pgTable(
  "members",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id),
    role: text("role").$type<Role>().notNull(),
    displayName: text("display_name").notNull(),
    email: text("email"),
    username: text("username"),
    mamaCallsMe: text("mama_calls_me").notNull(),
    locale: text("locale").$type<Locale>().notNull(),
    plainMode: boolean("plain_mode").notNull().default(false),
    channels: jsonb("channels").$type<ChannelPrefs>().notNull(),
    quietHours: jsonb("quiet_hours").$type<QuietHours>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [index("members_household_idx").on(t.householdId)],
);

export const notes = pgTable(
  "notes",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id),
    authorId: text("author_id").notNull(),
    body: text("body").notNull(),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [index("notes_household_idx").on(t.householdId)],
);
