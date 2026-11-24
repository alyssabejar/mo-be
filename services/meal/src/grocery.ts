import type { GroceryItem, GroceryList, IsoDate, PlannedMeal, Recipe } from "@mamamo/contracts";
import { addDays, compact, uid, type Queryable } from "@mamamo/service-kit";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { groceryItems, groceryLists, householdSettings, meals, recipes, supplyLevels } from "./schema";

const UNIT_ALIASES: Record<string, string> = { pc: "pcs", piece: "pcs", pieces: "pcs", kilo: "kg", kgs: "kg", liter: "L", l: "L", litre: "L" };

/** "pc" and "pcs" are the same unit; merge them. */
export function normalizeUnit(unit?: string | null): string | undefined {
  if (!unit) return undefined;
  const u = unit.trim();
  return UNIT_ALIASES[u.toLowerCase()] ?? u;
}

export const itemKey = (name: string, unit?: string | null) => `${name.trim().toLowerCase()}|${(normalizeUnit(unit) ?? "").toLowerCase()}`;

type NewItem = Omit<GroceryItem, "id">;

/** Sum the week's recipe ingredients into list items. */
export function ingredientsForWeek(plan: Pick<PlannedMeal, "date" | "recipeId">[], recipeList: Pick<Recipe, "id" | "ingredients">[], weekStart: IsoDate): NewItem[] {
  const weekEnd = addDays(weekStart, 6);
  const byId = new Map(recipeList.map((r) => [r.id, r]));
  const merged = new Map<string, NewItem>();
  for (const meal of plan) {
    if (meal.date < weekStart || meal.date > weekEnd || !meal.recipeId) continue;
    const recipe = byId.get(meal.recipeId);
    if (!recipe) continue;
    for (const i of recipe.ingredients) {
      const k = itemKey(i.name, i.unit);
      const existing = merged.get(k);
      if (existing) {
        existing.qty = Math.round((existing.qty + i.qty) * 100) / 100;
        if (i.estPrice) existing.estPrice = (existing.estPrice ?? 0) + i.estPrice;
      } else {
        merged.set(k, compact({ name: i.name, qty: i.qty, unit: normalizeUnit(i.unit), estPrice: i.estPrice, checked: false, source: "meal" as const }) as NewItem);
      }
    }
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function supplyItems(db: Queryable<any>, householdId: string): Promise<NewItem[]> {
  const rows = await db
    .select()
    .from(supplyLevels)
    .where(and(eq(supplyLevels.householdId, householdId), or(eq(supplyLevels.lastStatus, "low"), eq(supplyLevels.lastStatus, "out"))));
  return rows.map((s) => compact({ name: s.name, qty: s.restockQty, unit: s.restockUnit ?? undefined, estPrice: s.estPrice ?? undefined, checked: false, source: "supply" as const }) as NewItem);
}

async function weekPlan(db: Queryable<any>, householdId: string, weekStart: IsoDate) {
  const plan = await db.select().from(meals).where(eq(meals.householdId, householdId));
  const ids = [...new Set(plan.filter((m) => m.date >= weekStart && m.date <= addDays(weekStart, 6) && m.recipeId).map((m) => m.recipeId!))];
  const rs = ids.length ? await db.select().from(recipes).where(inArray(recipes.id, ids)) : [];
  return { plan: plan.map((m) => ({ date: m.date, recipeId: m.recipeId ?? undefined })), recipes: rs };
}

function toItem(r: typeof groceryItems.$inferSelect): GroceryItem {
  return compact({
    id: r.id,
    name: r.name,
    qty: r.qty,
    unit: r.unit ?? undefined,
    estPrice: r.estPrice ?? undefined,
    actualPrice: r.actualPrice ?? undefined,
    checked: r.checked,
    checkedBy: r.checkedBy ?? undefined,
    checkedAt: r.checkedAt ? new Date(r.checkedAt).toISOString() : undefined,
    source: r.source,
  }) as GroceryItem;
}

export const toGroceryItem = toItem;

export async function loadList(db: Queryable<any>, listId: string): Promise<GroceryList | undefined> {
  const [l] = await db.select().from(groceryLists).where(eq(groceryLists.id, listId));
  if (!l) return undefined;
  const items = await db.select().from(groceryItems).where(eq(groceryItems.listId, l.id)).orderBy(asc(groceryItems.position));
  return { id: l.id, householdId: l.householdId, weekStart: l.weekStart, budget: l.budget, items: items.map(toItem), generatedAt: new Date(l.generatedAt).toISOString() };
}

async function insertItems(db: Queryable<any>, listId: string, items: NewItem[]) {
  if (!items.length) return;
  await db.insert(groceryItems).values(
    items.map((i) => ({ id: uid("gi"), listId, name: i.name, qty: i.qty, unit: i.unit ?? null, estPrice: i.estPrice ?? null, checked: false, source: i.source })),
  );
}

/** The week's list, generated from the plan and low supplies the first time it's asked for. */
export async function getOrCreateList(db: Queryable<any>, householdId: string, weekStart: IsoDate): Promise<{ list: GroceryList; created: boolean }> {
  const [existing] = await db.select().from(groceryLists).where(and(eq(groceryLists.householdId, householdId), eq(groceryLists.weekStart, weekStart)));
  if (existing) return { list: (await loadList(db, existing.id))!, created: false };

  const [settings] = await db.select().from(householdSettings).where(eq(householdSettings.householdId, householdId));
  const id = uid("gl");
  const inserted = await db
    .insert(groceryLists)
    .values({ id, householdId, weekStart, budget: settings?.weeklyGroceryBudget ?? 0 })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) return getOrCreateList(db, householdId, weekStart); // someone else created it
  const { plan, recipes: rs } = await weekPlan(db, householdId, weekStart);
  await insertItems(db, id, [...ingredientsForWeek(plan, rs, weekStart), ...(await supplyItems(db, householdId))]);
  return { list: (await loadList(db, id))!, created: true };
}

/**
 * Rebuild the meal-sourced part of a list from the current plan. Items already
 * bought (checked) and manual or supply items are kept as they are.
 */
export async function regenerateList(db: Queryable<any>, list: GroceryList): Promise<GroceryList> {
  const kept = list.items.filter((i) => i.source !== "meal" || i.checked);
  const dropIds = list.items.filter((i) => !kept.includes(i)).map((i) => i.id);
  if (dropIds.length) await db.delete(groceryItems).where(inArray(groceryItems.id, dropIds));
  const keptKeys = new Set(kept.map((i) => itemKey(i.name, i.unit)));
  const { plan, recipes: rs } = await weekPlan(db, list.householdId, list.weekStart);
  const fresh = ingredientsForWeek(plan, rs, list.weekStart).filter((i) => !keptKeys.has(itemKey(i.name, i.unit)));
  const supplyFresh = (await supplyItems(db, list.householdId)).filter((i) => !keptKeys.has(itemKey(i.name, i.unit)));
  await insertItems(db, list.id, [...fresh, ...supplyFresh]);
  await db.update(groceryLists).set({ generatedAt: new Date().toISOString() }).where(eq(groceryLists.id, list.id));
  return (await loadList(db, list.id))!;
}

/** Put a Low/Out supply on this week's list unless it's already there and not yet bought. */
export async function addSupplyToList(db: Queryable<any>, householdId: string, weekStart: IsoDate, supply: { name: string; restockQty: number; restockUnit?: string; estPrice?: number }) {
  const { list, created } = await getOrCreateList(db, householdId, weekStart);
  // A freshly created list already picked up the supply from supply_levels.
  if (created) return { list, added: list.items.some((i) => i.source === "supply" && i.name.toLowerCase() === supply.name.toLowerCase()) };
  const already = list.items.some((i) => !i.checked && i.name.toLowerCase() === supply.name.toLowerCase());
  if (already) return { list, added: false };
  await insertItems(db, list.id, [compact({ name: supply.name, qty: supply.restockQty, unit: supply.restockUnit, estPrice: supply.estPrice, checked: false, source: "supply" as const }) as NewItem]);
  return { list, added: true };
}
