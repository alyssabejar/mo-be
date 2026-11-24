import type { AiSettings, GroceryItem, Ingredient, MealSlotKind, RecipeLanguage, SupplyStatus } from "@mamamo/contracts";
import { boolean, date, doublePrecision, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export { directory, outbox, processedEvents } from "@mamamo/service-kit/tables";

export const recipes = pgTable(
  "recipes",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    name: text("name").notNull(),
    language: text("language").$type<RecipeLanguage>().notNull(),
    ingredients: jsonb("ingredients").$type<Ingredient[]>().notNull(),
    tags: text("tags").array().notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [index("recipes_household_idx").on(t.householdId)],
);

/** One row per (household, date, slot). */
export const meals = pgTable(
  "meals",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    slot: text("slot").$type<MealSlotKind>().notNull(),
    recipeId: text("recipe_id"),
    title: text("title").notNull(),
    cookId: text("cook_id"),
  },
  (t) => [uniqueIndex("meals_slot_uq").on(t.householdId, t.date, t.slot)],
);

export const groceryLists = pgTable(
  "grocery_lists",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    budget: integer("budget").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("grocery_lists_week_uq").on(t.householdId, t.weekStart)],
);

export const groceryItems = pgTable(
  "grocery_items",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => groceryLists.id, { onDelete: "cascade" }),
    position: serial("position").notNull(),
    name: text("name").notNull(),
    qty: doublePrecision("qty").notNull(),
    unit: text("unit"),
    estPrice: integer("est_price"),
    actualPrice: integer("actual_price"),
    checked: boolean("checked").notNull().default(false),
    checkedBy: text("checked_by"),
    checkedAt: timestamp("checked_at", { withTimezone: true, mode: "string" }),
    source: text("source").$type<GroceryItem["source"]>().notNull(),
  },
  (t) => [index("grocery_items_list_idx").on(t.listId)],
);

/** Household budget and AI settings, kept from identity.household.updated. */
export const householdSettings = pgTable("household_settings", {
  householdId: text("household_id").primaryKey(),
  weeklyGroceryBudget: integer("weekly_grocery_budget").notNull(),
  ai: jsonb("ai").$type<AiSettings>().notNull(),
});

/** Supply levels, kept from supply.* events: Low and Out go on the grocery list. */
export const supplyLevels = pgTable(
  "supply_levels",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    name: text("name").notNull(),
    lastStatus: text("last_status").$type<SupplyStatus>(),
    restockQty: doublePrecision("restock_qty").notNull(),
    restockUnit: text("restock_unit"),
    estPrice: integer("est_price"),
  },
  (t) => [index("supply_levels_household_idx").on(t.householdId)],
);
