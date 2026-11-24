import {
  AddGroceryItemRequest,
  Centavos,
  CreateRecipeRequest,
  IsoDate,
  MealSlotKind,
  UpsertMealRequest,
  type PlannedMeal,
  type Recipe,
} from "@mamamo/contracts";
import {
  addDays,
  applyUserEvent,
  claims,
  compact,
  consume,
  directoryUser,
  IDENTITY_USER_SUBJECTS,
  notFound,
  requireCan,
  startOfWeek,
  todayManila,
  uid,
  type EventCatalog,
  type Queryable,
  type ServiceContext,
  type ServiceModule,
  type Tx,
} from "@mamamo/service-kit";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { addSupplyToList, getOrCreateList, loadList, regenerateList, toGroceryItem } from "./grocery";
import * as schema from "./schema";
import { groceryItems, groceryLists, householdSettings, meals, recipes, supplyLevels } from "./schema";
import { suggestMeals } from "./suggest";

type Ctx = ServiceContext<typeof schema>;

export function toRecipe(r: typeof recipes.$inferSelect): Recipe {
  return compact({
    id: r.id,
    householdId: r.householdId,
    name: r.name,
    language: r.language,
    ingredients: r.ingredients,
    tags: r.tags,
    notes: r.notes ?? undefined,
    createdAt: new Date(r.createdAt).toISOString(),
  }) as Recipe;
}

export function toMeal(r: typeof meals.$inferSelect): PlannedMeal {
  return compact({ id: r.id, householdId: r.householdId, date: r.date, slot: r.slot, recipeId: r.recipeId ?? undefined, title: r.title, cookId: r.cookId ?? undefined }) as PlannedMeal;
}

const WeekQuery = z.object({ weekStart: IsoDate });

export function mealModule(): ServiceModule<typeof schema> {
  return {
    name: "meal",
    schema,
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),

    async routes(app, ctx: Ctx) {
      const { db } = ctx;

      const listChanged = (tx: Queryable<any>, householdId: string, listId: string, actorId: string) =>
        ctx.outbox.emit(tx, "meal.grocery_list.changed", householdId, { listId }, actorId);

      const listFor = async (tx: Queryable<any>, householdId: string, listId: string) => {
        const [l] = await tx.select().from(groceryLists).where(and(eq(groceryLists.id, listId), eq(groceryLists.householdId, householdId)));
        return l ?? notFound("List");
      };

      // ---------- recipes ----------

      app.get("/recipes", async (req) => {
        const c = requireCan(req, "meals.view");
        const rows = await db.select().from(recipes).where(eq(recipes.householdId, c.householdId)).orderBy(asc(recipes.name));
        return rows.map(toRecipe);
      });

      app.post("/recipes", async (req, reply) => {
        const c = requireCan(req, "meals.plan");
        const body = CreateRecipeRequest.parse(req.body);
        const recipe = await db.transaction(async (tx) => {
          const [r] = await tx.insert(recipes).values({ ...body, id: uid("r"), householdId: c.householdId }).returning();
          await ctx.outbox.emit(tx, "meal.recipe.changed", c.householdId, { recipeId: r!.id }, c.sub);
          return toRecipe(r!);
        });
        reply.status(201);
        return recipe;
      });

      app.put<{ Params: { id: string } }>("/recipes/:id", async (req) => {
        const c = requireCan(req, "meals.plan");
        const body = CreateRecipeRequest.parse(req.body);
        return db.transaction(async (tx) => {
          const [r] = await tx
            .update(recipes)
            .set({ notes: null, ...body })
            .where(and(eq(recipes.id, req.params.id), eq(recipes.householdId, c.householdId)))
            .returning();
          if (!r) notFound("Recipe");
          await ctx.outbox.emit(tx, "meal.recipe.changed", c.householdId, { recipeId: r.id }, c.sub);
          return toRecipe(r);
        });
      });

      app.delete<{ Params: { id: string } }>("/recipes/:id", async (req) => {
        const c = requireCan(req, "meals.plan");
        await db.transaction(async (tx) => {
          await tx.delete(recipes).where(and(eq(recipes.id, req.params.id), eq(recipes.householdId, c.householdId)));
          const unlinked = await tx.update(meals).set({ recipeId: null }).where(and(eq(meals.householdId, c.householdId), eq(meals.recipeId, req.params.id))).returning();
          for (const m of unlinked) await ctx.outbox.emit(tx, "meal.slot.upserted", c.householdId, { meal: toMeal(m) }, c.sub);
          await ctx.outbox.emit(tx, "meal.recipe.changed", c.householdId, { recipeId: req.params.id, removed: true }, c.sub);
        });
        return { ok: true };
      });

      // ---------- meal plan ----------

      app.get("/meals", async (req) => {
        const c = requireCan(req, "meals.view");
        const { weekStart } = WeekQuery.parse(req.query);
        const end = new Date(Date.parse(`${weekStart}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
        const rows = await db
          .select()
          .from(meals)
          .where(and(eq(meals.householdId, c.householdId), gte(meals.date, weekStart), lte(meals.date, end)))
          .orderBy(asc(meals.date));
        return rows.map(toMeal);
      });

      app.put("/meals", async (req) => {
        const c = requireCan(req, "meals.plan");
        const body = UpsertMealRequest.parse(req.body);
        return db.transaction(async (tx) => {
          const values = { householdId: c.householdId, date: body.date, slot: body.slot, title: body.title, recipeId: body.recipeId ?? null, cookId: body.cookId ?? null };
          const [m] = await tx
            .insert(meals)
            .values({ id: uid("m"), ...values })
            .onConflictDoUpdate({ target: [meals.householdId, meals.date, meals.slot], set: { title: values.title, recipeId: values.recipeId, cookId: values.cookId } })
            .returning();
          const meal = toMeal(m!);
          await ctx.outbox.emit(tx, "meal.slot.upserted", c.householdId, { meal }, c.sub);
          return meal;
        });
      });

      app.delete("/meals", async (req) => {
        const c = requireCan(req, "meals.plan");
        const { date, slot } = z.object({ date: IsoDate, slot: MealSlotKind }).parse(req.query);
        await db.transaction(async (tx) => {
          const gone = await tx.delete(meals).where(and(eq(meals.householdId, c.householdId), eq(meals.date, date), eq(meals.slot, slot))).returning();
          for (const m of gone) await ctx.outbox.emit(tx, "meal.slot.removed", c.householdId, { mealId: m.id, date, slot }, c.sub);
        });
        return { ok: true };
      });

      // ---------- Anong Ulam? ----------

      app.get("/suggestions", async (req) => {
        const c = requireCan(req, "ai.suggest");
        const { slot } = z.object({ slot: MealSlotKind.optional() }).parse(req.query);
        const today = todayManila();
        const [rs, ms, low, settings, me] = await Promise.all([
          db.select().from(recipes).where(eq(recipes.householdId, c.householdId)),
          db.select().from(meals).where(and(eq(meals.householdId, c.householdId), gte(meals.date, addDays(today, -6)), lte(meals.date, today))),
          db.select().from(supplyLevels).where(eq(supplyLevels.householdId, c.householdId)),
          db.select().from(householdSettings).where(eq(householdSettings.householdId, c.householdId)),
          directoryUser(db, c.sub),
        ]);
        const [list] = await db.select().from(groceryLists).where(and(eq(groceryLists.householdId, c.householdId), eq(groceryLists.weekStart, startOfWeek(today))));
        const items = list ? await db.select().from(groceryItems).where(eq(groceryItems.listId, list.id)) : [];
        const spent = items.reduce((n, i) => n + (i.actualPrice ?? i.estPrice ?? 0), 0);
        const budget = settings[0]?.weeklyGroceryBudget ?? 0;
        const ai = settings[0]?.ai;
        return suggestMeals({
          today,
          locale: me?.locale ?? "en",
          ...(slot ? { slot } : {}),
          recipes: rs.map(toRecipe),
          meals: ms.map((m) => ({ date: m.date, recipeId: m.recipeId ?? undefined })),
          lowSupplies: low.filter((s) => s.lastStatus === "low" || s.lastStatus === "out").map((s) => s.name),
          budgetLeft: Math.max(0, budget - spent),
          provider: ai?.enabled && ai.provider !== "none" ? ai.provider : "sample",
        });
      });

      // ---------- grocery ----------

      app.get("/grocery", async (req) => {
        const c = requireCan(req, "grocery.check");
        const { weekStart } = WeekQuery.parse(req.query);
        return db.transaction(async (tx) => {
          const { list, created } = await getOrCreateList(tx, c.householdId, startOfWeek(weekStart));
          if (created) await ctx.outbox.emit(tx, "meal.grocery_list.generated", c.householdId, { list }, c.sub);
          return list;
        });
      });

      app.post("/grocery/regenerate", async (req) => {
        const c = requireCan(req, "grocery.manage");
        const { weekStart } = WeekQuery.parse(req.body);
        return db.transaction(async (tx) => {
          const { list, created } = await getOrCreateList(tx, c.householdId, startOfWeek(weekStart));
          const next = created ? list : await regenerateList(tx, list);
          await ctx.outbox.emit(tx, "meal.grocery_list.generated", c.householdId, { list: next }, c.sub);
          return next;
        });
      });

      app.patch<{ Params: { listId: string; itemId: string } }>("/grocery/:listId/items/:itemId", async (req) => {
        const c = requireCan(req, "grocery.check");
        const body = z.object({ checked: z.boolean().optional(), actualPrice: Centavos.nullable().optional() }).parse(req.body);
        return db.transaction(async (tx) => {
          await listFor(tx, c.householdId, req.params.listId);
          const set: Partial<typeof groceryItems.$inferInsert> = {};
          if (body.checked !== undefined) {
            set.checked = body.checked;
            set.checkedBy = body.checked ? c.sub : null;
            set.checkedAt = body.checked ? new Date().toISOString() : null;
          }
          if (body.actualPrice !== undefined) set.actualPrice = body.actualPrice;
          const [item] = await tx
            .update(groceryItems)
            .set(set)
            .where(and(eq(groceryItems.id, req.params.itemId), eq(groceryItems.listId, req.params.listId)))
            .returning();
          if (!item) notFound("Item");
          await listChanged(tx, c.householdId, req.params.listId, c.sub);
          return toGroceryItem(item);
        });
      });

      app.post<{ Params: { listId: string } }>("/grocery/:listId/items", async (req, reply) => {
        const c = requireCan(req, "grocery.check");
        const body = AddGroceryItemRequest.parse(req.body);
        const item = await db.transaction(async (tx) => {
          await listFor(tx, c.householdId, req.params.listId);
          const [i] = await tx
            .insert(groceryItems)
            .values({ id: uid("gi"), listId: req.params.listId, name: body.name, qty: body.qty, unit: body.unit ?? null, estPrice: body.estPrice ?? null, checked: false, source: "manual" })
            .returning();
          await listChanged(tx, c.householdId, req.params.listId, c.sub);
          return toGroceryItem(i!);
        });
        reply.status(201);
        return item;
      });

      app.delete<{ Params: { listId: string; itemId: string } }>("/grocery/:listId/items/:itemId", async (req) => {
        const c = requireCan(req, "grocery.manage");
        await db.transaction(async (tx) => {
          await listFor(tx, c.householdId, req.params.listId);
          await tx.delete(groceryItems).where(and(eq(groceryItems.id, req.params.itemId), eq(groceryItems.listId, req.params.listId)));
          await listChanged(tx, c.householdId, req.params.listId, c.sub);
        });
        return { ok: true };
      });

      app.get<{ Params: { listId: string } }>("/grocery/:listId", async (req) => {
        const c = claims(req);
        await listFor(db, c.householdId, req.params.listId);
        return loadList(db, req.params.listId);
      });
    },

    async consumers(ctx: Ctx) {
      const { db, bus, outbox } = ctx;

      await consume(db, bus, outbox, "meal-identity", [...IDENTITY_USER_SUBJECTS, "identity.household.updated"], async (tx, event) => {
        if (event.subject === "identity.household.updated") {
          const { household } = event.data as EventCatalog["identity.household.updated"];
          const [prev] = await tx.select().from(householdSettings).where(eq(householdSettings.householdId, household.id));
          await tx
            .insert(householdSettings)
            .values({ householdId: household.id, weeklyGroceryBudget: household.weeklyGroceryBudget, ai: household.ai })
            .onConflictDoUpdate({ target: householdSettings.householdId, set: { weeklyGroceryBudget: household.weeklyGroceryBudget, ai: household.ai } });
          // A new budget applies to this week's list too.
          if (prev && prev.weeklyGroceryBudget !== household.weeklyGroceryBudget) {
            const current = await tx
              .update(groceryLists)
              .set({ budget: household.weeklyGroceryBudget })
              .where(and(eq(groceryLists.householdId, household.id), eq(groceryLists.weekStart, startOfWeek(todayManila()))))
              .returning();
            for (const l of current) await outbox.emit(tx, "meal.grocery_list.changed", household.id, { listId: l.id }, event.actorId);
          }
          return;
        }
        await applyUserEvent(tx, event);
        if (event.subject === "identity.user.removed") {
          const { userId } = event.data as EventCatalog["identity.user.removed"];
          const rows = await tx.update(meals).set({ cookId: null }).where(and(eq(meals.householdId, event.householdId), eq(meals.cookId, userId))).returning();
          for (const m of rows) await outbox.emit(tx, "meal.slot.upserted", event.householdId, { meal: toMeal(m) }, event.actorId);
        }
      });

      await consume(db, bus, outbox, "meal-supplies", ["supply.upserted", "supply.removed", "supply.checked"], async (tx: Tx<any>, event) => {
        if (event.subject === "supply.removed") {
          const { supplyId } = event.data as EventCatalog["supply.removed"];
          await tx.delete(supplyLevels).where(eq(supplyLevels.id, supplyId));
          return;
        }
        const { supply } = event.data as EventCatalog["supply.upserted"];
        const values = {
          householdId: supply.householdId,
          name: supply.name,
          lastStatus: supply.lastStatus ?? null,
          restockQty: supply.restockQty,
          restockUnit: supply.restockUnit ?? null,
          estPrice: supply.estPrice ?? null,
        };
        await tx.insert(supplyLevels).values({ id: supply.id, ...values }).onConflictDoUpdate({ target: supplyLevels.id, set: values });
        if (event.subject === "supply.checked") {
          const { status } = event.data as EventCatalog["supply.checked"];
          if (status === "ok") return;
          const { list, added } = await addSupplyToList(tx, supply.householdId, startOfWeek(todayManila()), compact({ name: supply.name, restockQty: supply.restockQty, restockUnit: supply.restockUnit, estPrice: supply.estPrice }));
          if (added) await outbox.emit(tx, "meal.grocery_list.changed", supply.householdId, { listId: list.id }, event.actorId);
        }
      });
    },
  };
}
