import type { User } from "@mamamo/contracts";
import { describe, expect, it } from "vitest";
import { localizeVars, whenLabel } from "./localize";
import { renderTemplate } from "./templates";

const user = (over: Partial<User> = {}): Pick<User, "locale" | "plainMode" | "mamaCallsMe"> => ({ locale: "tl", plainMode: false, mamaCallsMe: "Anak", ...over });

describe("notification templates", () => {
  it("renders the mama voice with the reader's tawag", () => {
    const vars = localizeVars({ bill: "Meralco", dueDate: "2026-11-26", amount: 320000 }, "tl", new Date("2026-11-25T02:00:00Z"));
    expect(renderTemplate("bill_due", user(), vars, 1)).toEqual({ title: "Meralco due bukas", body: "Anak, Meralco due na bukas. Bayaran mo na." });
  });

  it("escalates the Sermon and falls back to the highest defined level", () => {
    const v = { errand: "Labahan", days: 3 };
    expect(renderTemplate("errand_overdue", user({ locale: "en" }), v, 3).body).toBe("How many times do I have to tell you? Labahan now, Anak.");
    expect(renderTemplate("errand_due", user({ locale: "en" }), v, 3).body).toBe("Anak, Labahan today ha. Don't forget.");
  });

  it("drops the voice in plain mode", () => {
    const vars = localizeVars({ item: "Cat litter" }, "en");
    expect(renderTemplate("supply_check", user({ locale: "en", plainMode: true }), vars, 2)).toEqual({ title: "Supply check: Cat litter", body: "Time to check Cat litter." });
  });

  it("localizes leave types, dates, slots and COD", () => {
    const v = localizeVars({ leaveType: "rest_day_swap", startDate: "2026-12-02", endDate: "2026-12-02", slot: "dinner", cod: 129900 }, "en");
    expect(v.type).toBe("a rest-day swap");
    expect(v.dates).toBe("Dec 2");
    expect(v.slot).toBe("dinner");
    expect(v.cod).toBe("Have ₱1,299 ready (COD).");
    expect(localizeVars({ slot: "dinner" }, "halo").slot).toBe("pamanggihi");
  });

  it("says when in each locale", () => {
    expect(whenLabel("2026-11-25", "2026-11-25", "halo")).toBe("ngunyan");
    expect(whenLabel("2026-11-23", "2026-11-25", "tl")).toBe("noong 2 araw");
    expect(whenLabel("2026-11-28", "2026-11-25", "en")).toBe("in 3 days");
  });
});
