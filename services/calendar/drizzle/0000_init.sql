CREATE TABLE "bill_cycles_view" (
	"id" text PRIMARY KEY NOT NULL,
	"bill_id" text NOT NULL,
	"due_date" date NOT NULL,
	"paid" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bills_view" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"name" text NOT NULL,
	"assignee_id" text NOT NULL
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
CREATE TABLE "errands_view" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"errand" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaves_view" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"leave" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meals_view" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"date" date NOT NULL,
	"meal" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "occurrences_view" (
	"errand_id" text NOT NULL,
	"date" date NOT NULL,
	"household_id" text NOT NULL,
	"occurrence" jsonb NOT NULL,
	CONSTRAINT "occurrences_view_errand_id_date_pk" PRIMARY KEY("errand_id","date")
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
CREATE TABLE "rest_days_view" (
	"user_id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"rest_day" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cal_cycles_idx" ON "bill_cycles_view" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "directory_household_idx" ON "directory" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "cal_errands_idx" ON "errands_view" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "cal_leaves_idx" ON "leaves_view" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "cal_meals_idx" ON "meals_view" USING btree ("household_id","date");--> statement-breakpoint
CREATE INDEX "cal_occ_idx" ON "occurrences_view" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox" USING btree ("created_at") WHERE published_at is null;