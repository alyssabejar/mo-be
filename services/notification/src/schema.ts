import type { InboxItem, NotificationAction, NotificationKind } from "@mamamo/contracts";
import { boolean, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export { directory, outbox, processedEvents } from "@mamamo/service-kit/tables";

export type Channel = InboxItem["deliveredVia"][number];

/** The in-app inbox. One row per (reminder, occurrence, level, user). */
export const inboxItems = pgTable(
  "inbox_items",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    userId: text("user_id").notNull(),
    kind: text("kind").$type<NotificationKind>().notNull(),
    level: integer("level").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    subject: text("subject").notNull(),
    actions: text("actions").array().$type<NotificationAction[]>().notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true, mode: "string" }),
    deliveredVia: text("delivered_via").array().$type<Channel[]>().notNull(),
    suppressedByQuietHours: boolean("suppressed_by_quiet_hours").notNull().default(false),
  },
  (t) => [index("inbox_user_idx").on(t.userId, t.createdAt), index("inbox_subject_idx").on(t.subject)],
);

/**
 * Out-of-app deliveries (Web Push, Slack). The id is the idempotency key plus the
 * channel, so a reminder goes out at most once per channel; failures retry with backoff.
 */
export const deliveries = pgTable(
  "deliveries",
  {
    id: text("id").primaryKey(),
    inboxId: text("inbox_id")
      .notNull()
      .references(() => inboxItems.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    channel: text("channel").$type<Exclude<Channel, "inApp">>().notNull(),
    status: text("status").$type<"pending" | "sent" | "failed" | "skipped">().notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("deliveries_due_idx").on(t.status, t.nextAttemptAt)],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    endpoint: text("endpoint").primaryKey(),
    userId: text("user_id").notNull(),
    householdId: text("household_id").notNull(),
    keys: jsonb("keys").$type<{ p256dh: string; auth: string }>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);
