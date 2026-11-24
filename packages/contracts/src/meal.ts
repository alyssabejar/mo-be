import { z } from "zod";
import { Centavos, HouseholdScoped, Id, IsoDate, RecipeLanguage, Timestamp } from "./common";

export const MealSlotKind = z.enum(["breakfast", "lunch", "merienda", "dinner"]);
export type MealSlotKind = z.infer<typeof MealSlotKind>;
export const MEAL_SLOTS = MealSlotKind.options;

/** Default serving times in Asia/Manila, used to place meals on the calendar. */
export const MEAL_SLOT_TIMES: Record<MealSlotKind, string> = {
  breakfast: "07:00",
  lunch: "12:00",
  merienda: "15:30",
  dinner: "18:30",
};

export const Ingredient = z.object({
  name: z.string().min(1),
  qty: z.number().positive(),
  unit: z.string().max(16).optional(),
  estPrice: Centavos.optional(),
});
export type Ingredient = z.infer<typeof Ingredient>;

export const Recipe = HouseholdScoped.extend({
  name: z.string().min(1),
  /** Recipes stay in the language they were written in. */
  language: RecipeLanguage,
  ingredients: z.array(Ingredient),
  tags: z.array(z.string()),
  notes: z.string().optional(),
  createdAt: Timestamp,
});
export type Recipe = z.infer<typeof Recipe>;

export const CreateRecipeRequest = Recipe.pick({
  name: true,
  language: true,
  ingredients: true,
  tags: true,
  notes: true,
});
export type CreateRecipeRequest = z.infer<typeof CreateRecipeRequest>;

export const PlannedMeal = HouseholdScoped.extend({
  date: IsoDate,
  slot: MealSlotKind,
  recipeId: Id.optional(),
  /** Free text when no recipe is linked, e.g. "Leftover adobo". */
  title: z.string().min(1),
  cookId: Id.optional(),
});
export type PlannedMeal = z.infer<typeof PlannedMeal>;

export const UpsertMealRequest = PlannedMeal.pick({
  date: true,
  slot: true,
  recipeId: true,
  title: true,
  cookId: true,
});
export type UpsertMealRequest = z.infer<typeof UpsertMealRequest>;

export const GroceryItemSource = z.enum(["meal", "supply", "manual"]);

export const GroceryItem = z.object({
  id: Id,
  name: z.string().min(1),
  qty: z.number().positive(),
  unit: z.string().optional(),
  estPrice: Centavos.optional(),
  /** Actual price entered at the palengke. */
  actualPrice: Centavos.optional(),
  checked: z.boolean(),
  checkedBy: Id.optional(),
  checkedAt: Timestamp.optional(),
  source: GroceryItemSource,
});
export type GroceryItem = z.infer<typeof GroceryItem>;

export const GroceryList = HouseholdScoped.extend({
  /** Monday of the week this list covers. */
  weekStart: IsoDate,
  budget: Centavos,
  items: z.array(GroceryItem),
  generatedAt: Timestamp,
});
export type GroceryList = z.infer<typeof GroceryList>;

export const AddGroceryItemRequest = GroceryItem.pick({ name: true, qty: true, unit: true, estPrice: true });
export type AddGroceryItemRequest = z.infer<typeof AddGroceryItemRequest>;

/** Structured output the LLM must return for Anong Ulam?. */
export const MealSuggestion = z.object({
  title: z.string(),
  slot: MealSlotKind,
  reason: z.string(),
  estCost: Centavos,
  usesLowSupplies: z.array(z.string()),
  recipeId: Id.optional(),
});
export type MealSuggestion = z.infer<typeof MealSuggestion>;

export const MealSuggestionResponse = z.object({
  provider: z.string(),
  suggestions: z.array(MealSuggestion).max(10),
});
export type MealSuggestionResponse = z.infer<typeof MealSuggestionResponse>;
