CREATE TABLE "deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"inbox_id" text NOT NULL,
	"user_id" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "directory" (
	"user_id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"role" text NOT NULL,
	"user" jsonb NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"level" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"subject" text NOT NULL,
	"actions" text[] NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"delivered_via" text[] NOT NULL,
	"suppressed_by_quiet_hours" boolean DEFAULT false NOT NULL,
	CONSTRAINT "inbox_items_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"envelope" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"household_id" text NOT NULL,
	"keys" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_inbox_id_inbox_items_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."inbox_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deliveries_due_idx" ON "deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "directory_household_idx" ON "directory" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "inbox_user_idx" ON "inbox_items" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "inbox_subject_idx" ON "inbox_items" USING btree ("subject");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox" USING btree ("created_at") WHERE published_at is null;--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");