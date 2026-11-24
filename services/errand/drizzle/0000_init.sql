CREATE TABLE "errands" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"category" text NOT NULL,
	"priority" text NOT NULL,
	"assignee_id" text,
	"start_date" date NOT NULL,
	"time" text,
	"rrule" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "occurrences" (
	"errand_id" text NOT NULL,
	"household_id" text NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"completed_by" text,
	"completed_at" timestamp with time zone,
	"rescheduled_to" date,
	"note" text,
	CONSTRAINT "occurrences_errand_id_date_pk" PRIMARY KEY("errand_id","date")
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
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_errand_id_errands_id_fk" FOREIGN KEY ("errand_id") REFERENCES "public"."errands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "errands_household_idx" ON "errands" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "occurrences_household_idx" ON "occurrences" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox" USING btree ("created_at") WHERE published_at is null;