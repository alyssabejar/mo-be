CREATE TABLE "directory" (
	"user_id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"role" text NOT NULL,
	"user" jsonb NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "grocery_items" (
	"id" text PRIMARY KEY NOT NULL,
	"list_id" text NOT NULL,
	"position" serial NOT NULL,
	"name" text NOT NULL,
	"qty" double precision NOT NULL,
	"unit" text,
	"est_price" integer,
	"actual_price" integer,
	"checked" boolean DEFAULT false NOT NULL,
	"checked_by" text,
	"checked_at" timestamp with time zone,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grocery_lists" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"week_start" date NOT NULL,
	"budget" integer NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_settings" (
	"household_id" text PRIMARY KEY NOT NULL,
	"weekly_grocery_budget" integer NOT NULL,
	"ai" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meals" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"date" date NOT NULL,
	"slot" text NOT NULL,
	"recipe_id" text,
	"title" text NOT NULL,
	"cook_id" text
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
CREATE TABLE "recipes" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"name" text NOT NULL,
	"language" text NOT NULL,
	"ingredients" jsonb NOT NULL,
	"tags" text[] NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supply_levels" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"name" text NOT NULL,
	"last_status" text,
	"restock_qty" double precision NOT NULL,
	"restock_unit" text,
	"est_price" integer
);
--> statement-breakpoint
ALTER TABLE "grocery_items" ADD CONSTRAINT "grocery_items_list_id_grocery_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."grocery_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "directory_household_idx" ON "directory" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "grocery_items_list_idx" ON "grocery_items" USING btree ("list_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grocery_lists_week_uq" ON "grocery_lists" USING btree ("household_id","week_start");--> statement-breakpoint
CREATE UNIQUE INDEX "meals_slot_uq" ON "meals" USING btree ("household_id","date","slot");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox" USING btree ("created_at") WHERE published_at is null;--> statement-breakpoint
CREATE INDEX "recipes_household_idx" ON "recipes" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "supply_levels_household_idx" ON "supply_levels" USING btree ("household_id");