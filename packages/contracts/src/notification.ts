import { z } from "zod";
import { Id, Timestamp } from "./common";

export const NotificationKind = z.enum([
  "bill_due",
  "supply_check",
  "errand_due",
  "errand_overdue",
  "leave_requested",
  "leave_decided",
  "parcel_update",
  "meal_cook",
]);
export type NotificationKind = z.infer<typeof NotificationKind>;

export const NotificationAction = z.enum(["mark_paid", "snooze", "open", "mark_done", "check_supply"]);
export type NotificationAction = z.infer<typeof NotificationAction>;

export const InboxItem = z.object({
  id: Id,
  householdId: Id,
  userId: Id,
  kind: NotificationKind,
  /** Sermon level: 1 = first reminder, 2 and 3 escalate in tone. */
  level: z.number().int().min(1).max(3),
  title: z.string(),
  body: z.string(),
  /** Points at the thing the reminder is about, e.g. "bill_cycle:abc". */
  subject: z.string(),
  actions: z.array(NotificationAction),
  /** reminder + occurrence + channel; delivery is idempotent on this key. */
  idempotencyKey: z.string(),
  createdAt: Timestamp,
  readAt: Timestamp.optional(),
  /** Channels it went out on (or would have, in the mock). */
  deliveredVia: z.array(z.enum(["inApp", "webPush", "slack"])),
  suppressedByQuietHours: z.boolean().default(false),
});
export type InboxItem = z.infer<typeof InboxItem>;
