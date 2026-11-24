CREATE TABLE "helper_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"user_id" text NOT NULL,
	"hire_date" date NOT NULL,
	"birth_date" date,
	"rest_day" text NOT NULL,
	"accumulated_rest_earned" integer DEFAULT 0 NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	CONSTRAINT "helper_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"helper_id" text NOT NULL,
	"type" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"swap_from" date,
	"reason" text,
	"status" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE INDEX "helper_profiles_household_idx" ON "helper_profiles" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "leave_requests_household_idx" ON "leave_requests" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "leave_requests_helper_idx" ON "leave_requests" USING btree ("helper_id");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox" USING btree ("created_at") WHERE published_at is null;