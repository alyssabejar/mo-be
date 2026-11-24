import type { Locale, MealSlotKind, MealSuggestion, MealSuggestionResponse, PlannedMeal, Recipe } from "@mamamo/contracts";
import { addDays, fill, peso } from "@mamamo/service-kit";

/**
 * "Anong Ulam?" fallback ranking, used while no LLM provider is configured (the
 * provider is an open decision in the requirements). The LLM path will feed the
 * same inputs to a provider adapter and validate its output with MealSuggestionResponse.
 */

const REASONS: Record<Locale, { notRecent: string; budget: string; soup: string; veg: string; favourite: string }> = {
  en: { notRecent: "Not cooked in the last 7 days", budget: "Fits the budget ({{left}} left this week)", soup: "Has soup, good for rainy days", veg: "Gets some vegetables in", favourite: "A household favourite" },
  tl: { notRecent: "Hindi pa natin naluluto ngayong linggo", budget: "Pasok sa budget ({{left}} pa ang natitira)", soup: "May sabaw, swak sa tag-ulan", veg: "Gulay naman tayo", favourite: "Paborito ng bahay" },
  taglish: { notRecent: "Hindi pa natin naluto this week", budget: "Pasok sa budget ({{left}} left this week)", soup: "May sabaw, perfect sa tag-ulan", veg: "Para may gulay naman", favourite: "Household favorite 'to" },
  halo: { notRecent: "Dai pa naluto this week, ala eh", budget: "Pasok sa budget ({{left}} pa an natada)", soup: "May sabaw, swak sa uran", veg: "Para may gulay man", favourite: "Paborito kan harong" },
};

const SLOT_TAGS: Record<MealSlotKind, string[]> = {
  breakfast: ["almusal"],
  lunch: ["ulam"],
  merienda: ["merienda"],
  dinner: ["ulam", "sabaw"],
};

export function suggestMeals(args: {
  today: string;
  locale: Locale;
  slot?: MealSlotKind;
  recipes: Recipe[];
  meals: Pick<PlannedMeal, "date" | "recipeId">[];
  lowSupplies: string[];
  budgetLeft: number;
  provider: string;
}): MealSuggestionResponse {
  const { today, slot, budgetLeft: left } = args;
  const recent = new Set(args.meals.filter((m) => m.date >= addDays(today, -6) && m.date <= today && m.recipeId).map((m) => m.recipeId!));
  const low = args.lowSupplies.map((s) => s.toLowerCase());
  const R = REASONS[args.locale];
  const slots: MealSlotKind[] = slot ? [slot] : ["lunch", "dinner", "merienda", "breakfast"];

  const suggestions: MealSuggestion[] = [];
  for (const s of slots) {
    const candidates = args.recipes
      .filter((r) => r.tags.some((t) => SLOT_TAGS[s].includes(t)))
      .map((r) => {
        const cost = r.ingredients.reduce((n, i) => n + (i.estPrice ?? 0), 0);
        const usesLow = r.ingredients.filter((i) => low.some((l) => l.includes(i.name.toLowerCase()))).map((i) => i.name);
        const score = (recent.has(r.id) ? -10 : 5) + (cost < left / 6 ? 3 : 0) - cost / 20000 - usesLow.length * 2;
        return { r, cost, usesLow, score };
      })
      .sort((a, b) => b.score - a.score);
    for (const c of candidates.slice(0, slot ? 4 : 1)) {
      if (suggestions.some((x) => x.recipeId === c.r.id)) continue;
      const reasons: string[] = [];
      if (!recent.has(c.r.id)) reasons.push(R.notRecent);
      if (c.cost < left / 6) reasons.push(fill(R.budget, { left: peso(left) }));
      if (c.r.tags.includes("sabaw")) reasons.push(R.soup);
      if (c.r.tags.includes("gulay")) reasons.push(R.veg);
      suggestions.push({ title: c.r.name, slot: s, reason: reasons.join(" · ") || R.favourite, estCost: c.cost, usesLowSupplies: c.usesLow, recipeId: c.r.id });
    }
  }
  return { provider: args.provider, suggestions };
}
