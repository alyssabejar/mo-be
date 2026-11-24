CREATE TABLE "households" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"weekly_grocery_budget" integer DEFAULT 0 NOT NULL,
	"ai" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"role" text NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"username" text,
	"mama_calls_me" text NOT NULL,
	"locale" text NOT NULL,
	"plain_mode" boolean DEFAULT false NOT NULL,
	"channels" jsonb NOT NULL,
	"quiet_hours" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
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
ALTER TABLE "members" ADD CONSTRAINT "members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "members_household_idx" ON "members" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "notes_household_idx" ON "notes" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox" USING btree ("created_at") WHERE published_at is null;