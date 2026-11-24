import type { InboxItem, NotificationAction, NotificationKind, User } from "@mamamo/contracts";
import {
  applyUserEvent,
  claims,
  compact,
  consume,
  directoryUser,
  directoryUsers,
  IDENTITY_USER_SUBJECTS,
  inQuietHours,
  nowTimeManila,
  uid,
  type EventCatalog,
  type Outbox,
  type ReminderVars,
  type ServiceContext,
  type ServiceModule,
  type TemplateKey,
  type Tx,
} from "@mamamo/service-kit";
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { slackChannel, webPushChannel } from "./channels";
import { localizeVars } from "./localize";
import * as schema from "./schema";
import { deliveries, inboxItems, pushSubscriptions, type Channel } from "./schema";
import { renderTemplate } from "./templates";

type Ctx = ServiceContext<typeof schema>;
const MAX_ATTEMPTS = 5;
const INBOX_LIMIT = 300;

export function toInbox(r: typeof inboxItems.$inferSelect): InboxItem {
  return compact({
    id: r.id,
    householdId: r.householdId,
    userId: r.userId,
    kind: r.kind,
    level: r.level,
    title: r.title,
    body: r.body,
    subject: r.subject,
    actions: r.actions,
    idempotencyKey: r.idempotencyKey,
    createdAt: new Date(r.createdAt).toISOString(),
    readAt: r.readAt ? new Date(r.readAt).toISOString() : undefined,
    deliveredVia: r.deliveredVia,
    suppressedByQuietHours: r.suppressedByQuietHours,
  }) as InboxItem;
}

export interface DeliverArgs {
  user: User;
  kind: NotificationKind;
  template: TemplateKey;
  level?: 1 | 2 | 3;
  vars: ReminderVars;
  subject: string;
  /** Unique per reminder and occurrence; level and user are appended. */
  key: string;
  actions?: NotificationAction[];
}

/**
 * Render in the reader's locale and voice, store the inbox item, and queue
 * out-of-app channels. Idempotent on (key, level, user); quiet hours keep it
 * in-app only.
 */
export async function deliver(tx: Tx<any>, outbox: Outbox, args: DeliverArgs, now = new Date()): Promise<InboxItem | null> {
  const level = args.level ?? 1;
  const { user } = args;
  const idempotencyKey = `${args.key}:L${level}:${user.id}`;
  const { title, body } = renderTemplate(args.template, user, localizeVars(args.vars, user.locale, now), level);
  const quiet = user.quietHours.enabled && inQuietHours(nowTimeManila(now), user.quietHours.start, user.quietHours.end);
  const via: Channel[] = ["inApp"];
  if (!quiet && user.channels.webPush) via.push("webPush");
  if (!quiet && user.channels.slack) via.push("slack");
  const [row] = await tx
    .insert(inboxItems)
    .values({
      id: uid("ib"),
      householdId: user.householdId,
      userId: user.id,
      kind: args.kind,
      level,
      title,
      body,
      subject: args.subject,
      actions: args.actions ?? ["open"],
      idempotencyKey,
      deliveredVia: via,
      suppressedByQuietHours: quiet,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return null;
  const outside = via.filter((c): c is Exclude<Channel, "inApp"> => c !== "inApp");
  if (outside.length) {
    await tx
      .insert(deliveries)
      .values(outside.map((channel) => ({ id: `${idempotencyKey}:${channel}`, inboxId: row.id, userId: user.id, channel, status: "pending" as const })))
      .onConflictDoNothing();
  }
  // Keep each inbox bounded.
  await tx.execute(sql`delete from inbox_items where user_id = ${user.id} and id in (
    select id from inbox_items where user_id = ${user.id} order by created_at desc offset ${INBOX_LIMIT})`);
  await outbox.emit(tx, "notification.inbox.changed", user.householdId, { userId: user.id });
  return toInbox(row);
}

/** Mark every unread item about `subject` as read (optionally only one user's). */
async function markSubjectRead(tx: Tx<any>, outbox: Outbox, householdId: string, subject: string, userId?: string) {
  const rows = await tx
    .update(inboxItems)
    .set({ readAt: new Date().toISOString() })
    .where(and(eq(inboxItems.householdId, householdId), eq(inboxItems.subject, subject), isNull(inboxItems.readAt), ...(userId ? [eq(inboxItems.userId, userId)] : [])))
    .returning({ userId: inboxItems.userId });
  for (const u of new Set(rows.map((r) => r.userId))) await outbox.emit(tx, "notification.inbox.changed", householdId, { userId: u });
}

export function notificationModule(): ServiceModule<typeof schema> {
  return {
    name: "notification",
    schema,
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),

    async routes(app, ctx: Ctx) {
      const { db, outbox } = ctx;
      const push = webPushChannel(ctx.env);

      app.get("/inbox", async (req) => {
        const c = claims(req);
        const rows = await db.select().from(inboxItems).where(eq(inboxItems.userId, c.sub)).orderBy(desc(inboxItems.createdAt)).limit(INBOX_LIMIT);
        return rows.map(toInbox);
      });

      app.post<{ Params: { id: string } }>("/inbox/:id/read", async (req) => {
        const c = claims(req);
        await db.transaction(async (tx) => {
          const rows = await tx
            .update(inboxItems)
            .set({ readAt: new Date().toISOString() })
            .where(and(eq(inboxItems.id, req.params.id), eq(inboxItems.userId, c.sub), isNull(inboxItems.readAt)))
            .returning();
          if (rows.length) await outbox.emit(tx, "notification.inbox.changed", c.householdId, { userId: c.sub });
        });
        return { ok: true };
      });

      app.post("/inbox/read-all", async (req) => {
        const c = claims(req);
        await db.transaction(async (tx) => {
          await tx.update(inboxItems).set({ readAt: new Date().toISOString() }).where(and(eq(inboxItems.userId, c.sub), isNull(inboxItems.readAt)));
          await outbox.emit(tx, "notification.inbox.changed", c.householdId, { userId: c.sub });
        });
        return { ok: true };
      });

      app.get("/push/vapid-public-key", async () => ({ publicKey: push.publicKey ?? null }));

      app.post("/push/subscriptions", async (req, reply) => {
        const c = claims(req);
        const body = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }).parse(req.body);
        await db
          .insert(pushSubscriptions)
          .values({ endpoint: body.endpoint, keys: body.keys, userId: c.sub, householdId: c.householdId })
          .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { keys: body.keys, userId: c.sub, householdId: c.householdId } });
        reply.status(201);
        return { ok: true };
      });

      app.delete("/push/subscriptions", async (req) => {
        const c = claims(req);
        const { endpoint } = z.object({ endpoint: z.string().url() }).parse(req.body);
        await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, c.sub)));
        return { ok: true };
      });
    },

    async consumers(ctx: Ctx) {
      const { db, bus, outbox } = ctx;

      await consume(db, bus, outbox, "notification-identity", IDENTITY_USER_SUBJECTS, async (tx, event) => {
        await applyUserEvent(tx, event);
      });

      await consume(db, bus, outbox, "notification-reminders", ["reminder.due"], async (tx, event) => {
        const r = event.data as EventCatalog["reminder.due"];
        const user = await directoryUser(tx, r.userId);
        if (!user) return;
        await deliver(tx, outbox, { user, kind: r.kind, template: r.template, level: r.level, vars: r.vars, subject: r.subject, key: r.key, actions: r.actions });
      });

      await consume(db, bus, outbox, "notification-staff", ["staff.leave.requested", "staff.leave.approved", "staff.leave.rejected", "staff.leave.cancelled"], async (tx, event) => {
        const { leave } = event.data as EventCatalog["staff.leave.requested"];
        const subject = `leave:${leave.id}`;
        const vars = { leaveType: leave.type, startDate: leave.startDate, endDate: leave.endDate };
        if (event.subject === "staff.leave.requested") {
          const helper = await directoryUser(tx, leave.helperId);
          const owners = (await directoryUsers(tx, leave.householdId)).filter((u) => u.role === "owner");
          for (const user of owners) {
            await deliver(tx, outbox, { user, kind: "leave_requested", template: "leave_requested", subject, key: `leave:${leave.id}:requested`, vars: { ...vars, helper: helper?.displayName ?? "" } });
          }
        } else if (event.subject === "staff.leave.cancelled") {
          await markSubjectRead(tx, outbox, leave.householdId, subject);
        } else {
          const approved = event.subject === "staff.leave.approved";
          const helper = await directoryUser(tx, leave.helperId);
          if (helper) {
            await deliver(tx, outbox, {
              user: helper,
              kind: "leave_decided",
              template: approved ? "leave_approved" : "leave_rejected",
              subject,
              key: `leave:${leave.id}:${approved ? "approved" : "rejected"}`,
              vars: { ...vars, ...(leave.decisionNote ? { note: leave.decisionNote } : {}) },
            });
          }
          if (event.actorId) await markSubjectRead(tx, outbox, leave.householdId, subject, event.actorId);
        }
      });

      await consume(db, bus, outbox, "notification-parcels", ["parcel.status.changed"], async (tx, event) => {
        const { parcel: p } = event.data as EventCatalog["parcel.status.changed"];
        const everyone = await directoryUsers(tx, p.householdId);
        if (p.status === "out_for_delivery") {
          for (const user of everyone) {
            await deliver(tx, outbox, {
              user,
              kind: "parcel_update",
              template: "parcel_update",
              subject: `parcel:${p.id}`,
              key: `parcel:${p.id}:out_for_delivery`,
              vars: { item: p.description, courier: p.courier, ...(p.codAmount ? { cod: p.codAmount } : {}) },
            });
          }
        }
        if (p.status === "delivered") {
          const by = (event.actorId && everyone.find((u) => u.id === event.actorId)?.displayName) || "someone";
          for (const user of everyone.filter((u) => u.id !== event.actorId && u.role !== "helper")) {
            await deliver(tx, outbox, { user, kind: "parcel_update", template: "parcel_delivered", subject: `parcel:${p.id}`, key: `parcel:${p.id}:delivered`, vars: { item: p.description, by } });
          }
          if (event.actorId) await markSubjectRead(tx, outbox, p.householdId, `parcel:${p.id}`, event.actorId);
        }
      });

      // The thing a nudge was about got handled: its nudges are read.
      await consume(db, bus, outbox, "notification-handled", ["errand.occurrence.completed", "supply.checked", "bill.cycle.paid", "bill.cycle.snoozed"], async (tx, event) => {
        switch (event.subject) {
          case "errand.occurrence.completed": {
            const { occurrence: o } = event.data as EventCatalog["errand.occurrence.completed"];
            await markSubjectRead(tx, outbox, event.householdId, `errand:${o.errandId}:${o.date}`);
            break;
          }
          case "supply.checked": {
            const { supply } = event.data as EventCatalog["supply.checked"];
            await markSubjectRead(tx, outbox, event.householdId, `supply:${supply.id}`);
            break;
          }
          default: {
            const { cycle } = event.data as EventCatalog["bill.cycle.paid"];
            await markSubjectRead(tx, outbox, event.householdId, `bill_cycle:${cycle.id}`);
          }
        }
      });
    },

    /** Send queued Web Push / Slack deliveries; retry failures with exponential backoff. */
    jobs(ctx: Ctx) {
      const push = webPushChannel(ctx.env);
      const slack = slackChannel(ctx.env);
      let running = false;
      const run = async () => {
        if (running) return;
        running = true;
        try {
          const due = await ctx.db
            .select()
            .from(deliveries)
            .where(and(eq(deliveries.status, "pending"), lte(deliveries.nextAttemptAt, new Date())))
            .orderBy(asc(deliveries.nextAttemptAt))
            .limit(50);
          if (!due.length) return;
          const items = new Map((await ctx.db.select().from(inboxItems).where(inArray(inboxItems.id, due.map((d) => d.inboxId)))).map((i) => [i.id, i]));
          for (const d of due) {
            const item = items.get(d.inboxId);
            if (!item) continue;
            const msg = { inboxId: item.id, title: item.title, body: item.body, subject: item.subject, actions: item.actions };
            const result =
              d.channel === "webPush"
                ? await push.send(await ctx.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, d.userId)), msg)
                : await slack.send();
            if (!result.ok && result.goneEndpoints?.length) await ctx.db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, result.goneEndpoints));
            const attempts = d.attempts + 1;
            if (result.ok) {
              await ctx.db.update(deliveries).set({ status: "sent", attempts, sentAt: new Date(), lastError: null }).where(eq(deliveries.id, d.id));
            } else if (result.retry && attempts < MAX_ATTEMPTS) {
              const backoff = 30_000 * 2 ** (attempts - 1);
              await ctx.db.update(deliveries).set({ attempts, lastError: result.error, nextAttemptAt: new Date(Date.now() + backoff) }).where(eq(deliveries.id, d.id));
            } else {
              await ctx.db.update(deliveries).set({ status: result.retry ? "failed" : "skipped", attempts, lastError: result.error }).where(eq(deliveries.id, d.id));
            }
          }
        } catch (err) {
          ctx.log.error({ err }, "delivery run failed");
        } finally {
          running = false;
        }
      };
      const timer = setInterval(run, Number(ctx.env.DELIVERY_INTERVAL_MS ?? 15_000));
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}
