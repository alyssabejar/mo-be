import type { User } from "@mamamo/contracts";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Tables every service carries. Re-export them from a service's schema so
 * drizzle-kit includes them in that service's migrations.
 */

/** Transactional outbox: events are written with the change and relayed to NATS after commit. */
export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").primaryKey(),
    subject: text("subject").notNull(),
    envelope: jsonb("envelope").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [index("outbox_unpublished_idx").on(t.createdAt).where(sql`published_at is null`)],
);

/** Consumer-side dedupe: an event id is handled once per service. */
export const processedEvents = pgTable("processed_events", {
  eventId: uuid("event_id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Read-only copy of household members, kept from identity.user.* events.
 * Services that address or name people read it instead of calling identity.
 */
export const directory = pgTable(
  "directory",
  {
    userId: text("user_id").primaryKey(),
    householdId: text("household_id").notNull(),
    role: text("role").notNull(),
    user: jsonb("user").$type<User>().notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [index("directory_household_idx").on(t.householdId)],
);
