import type { Recipe } from "@mamamo/contracts";
import { describe, expect, it } from "vitest";
import { ingredientsForWeek, normalizeUnit } from "./grocery";
import { suggestMeals } from "./suggest";

const recipe = (id: string, tags: string[], ingredients: Recipe["ingredients"]): Recipe => ({
  id,
  householdId: "hh",
  name: id,
  language: "tl",
  tags,
  ingredients,
  createdAt: "2026-11-01T00:00:00.000Z",
});

describe("grocery", () => {
  it("merges units that mean the same thing", () => {
    expect(normalizeUnit("pc")).toBe("pcs");
    expect(normalizeUnit("Kilo")).toBe("kg");
    expect(normalizeUnit(undefined)).toBeUndefined();
  });

  it("sums the week's ingredients and ignores meals outside the week", () => {
    const rs = [
      recipe("adobo", ["ulam"], [{ name: "Manok", qty: 1, unit: "kg", estPrice: 22000 }, { name: "Bawang", qty: 1, unit: "ulo" }]),
      recipe("tinola", ["ulam"], [{ name: "manok", qty: 0.5, unit: "kgs", estPrice: 11000 }]),
    ];
    const items = ingredientsForWeek(
      [
        { date: "2026-11-23", recipeId: "adobo" },
        { date: "2026-11-25", recipeId: "tinola" },
        { date: "2026-11-30", recipeId: "adobo" }, // next week
      ],
      rs,
      "2026-11-23",
    );
    expect(items).toEqual([
      { name: "Bawang", qty: 1, unit: "ulo", checked: false, source: "meal" },
      { name: "Manok", qty: 1.5, unit: "kg", estPrice: 33000, checked: false, source: "meal" },
    ]);
  });
});

describe("Anong Ulam? fallback", () => {
  it("prefers what wasn't cooked recently and explains why in the user's language", () => {
    const rs = [recipe("adobo", ["ulam"], [{ name: "Manok", qty: 1, estPrice: 22000 }]), recipe("monggo", ["ulam", "gulay"], [{ name: "Monggo", qty: 1, estPrice: 6000 }])];
    const out = suggestMeals({ today: "2026-11-25", locale: "en", slot: "lunch", recipes: rs, meals: [{ date: "2026-11-24", recipeId: "adobo" }], lowSupplies: [], budgetLeft: 750000, provider: "sample" });
    expect(out.provider).toBe("sample");
    expect(out.suggestions[0]?.title).toBe("monggo");
    expect(out.suggestions[0]?.reason).toContain("Not cooked in the last 7 days");
    expect(out.suggestions[0]?.reason).toContain("Gets some vegetables in");
  });
});
