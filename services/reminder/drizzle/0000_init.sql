CREATE TABLE "bill_cycles" (
	"id" text PRIMARY KEY NOT NULL,
	"bill_id" text NOT NULL,
	"household_id" text NOT NULL,
	"due_date" date NOT NULL,
	"amount" integer,
	"paid_at" timestamp with time zone,
	"paid_by" text,
	"receipt" text,
	"snoozed_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text,
	"account_number" text,
	"due_day" integer NOT NULL,
	"remind_days_before" integer NOT NULL,
	"assignee_id" text NOT NULL,
	"typical_amount" integer
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
	"title" text NOT NULL,
	"assignee_id" text,
	"created_by" text NOT NULL,
	"start_date" date NOT NULL,
	"rrule" text,
	"archived" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fired_reminders" (
	"key" text PRIMARY KEY NOT NULL,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meals_view" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"date" date NOT NULL,
	"slot" text NOT NULL,
	"title" text NOT NULL,
	"cook_id" text
);
--> statement-breakpoint
CREATE TABLE "occurrences_view" (
	"errand_id" text NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
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
CREATE TABLE "parcels" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"tracking_number" text NOT NULL,
	"courier" text NOT NULL,
	"description" text NOT NULL,
	"cod_amount" integer,
	"status" text NOT NULL,
	"events" jsonb NOT NULL,
	"added_by" text NOT NULL,
	"received_at" timestamp with time zone,
	"received_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplies" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"check_rule" text NOT NULL,
	"check_start_date" date NOT NULL,
	"assignee_id" text,
	"last_status" text,
	"last_checked_at" timestamp with time zone,
	"last_checked_by" text,
	"restock_qty" double precision NOT NULL,
	"restock_unit" text,
	"est_price" integer
);
--> statement-breakpoint
ALTER TABLE "bill_cycles" ADD CONSTRAINT "bill_cycles_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bill_cycles_bill_idx" ON "bill_cycles" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "bills_household_idx" ON "bills" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "directory_household_idx" ON "directory" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox" USING btree ("created_at") WHERE published_at is null;--> statement-breakpoint
CREATE INDEX "parcels_household_idx" ON "parcels" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "parcels_tracking_idx" ON "parcels" USING btree ("tracking_number");--> statement-breakpoint
CREATE INDEX "supplies_household_idx" ON "supplies" USING btree ("household_id");