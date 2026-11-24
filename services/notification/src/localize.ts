import type { LeaveType, Locale, MealSlotKind } from "@mamamo/contracts";
import { diffDays, fill, peso, todayManila, type ReminderVars } from "@mamamo/service-kit";

/** Words that depend on the reader's locale, filled into templates per user. */

export const SLOT_LABEL: Record<Locale, Record<MealSlotKind, string>> = {
  tl: { breakfast: "almusal", lunch: "tanghalian", merienda: "merienda", dinner: "hapunan" },
  en: { breakfast: "breakfast", lunch: "lunch", merienda: "merienda", dinner: "dinner" },
  taglish: { breakfast: "breakfast", lunch: "lunch", merienda: "merienda", dinner: "dinner" },
  // Bikol meal names
  halo: { breakfast: "pamahaw", lunch: "paniudto", merienda: "merienda", dinner: "pamanggihi" },
};

export const LEAVE_TYPE_LABEL: Record<Locale, Record<LeaveType, string>> = {
  tl: {
    rest_day_swap: "palit day-off",
    accumulated_rest: "naipong pahinga",
    service_incentive: "service incentive leave",
    unpaid: "leave na walang bayad",
    emergency: "emergency leave",
  },
  en: {
    rest_day_swap: "a rest-day swap",
    accumulated_rest: "accumulated rest",
    service_incentive: "service incentive leave",
    unpaid: "unpaid leave",
    emergency: "emergency leave",
  },
  taglish: {
    rest_day_swap: "rest-day swap",
    accumulated_rest: "accumulated rest",
    service_incentive: "service incentive leave",
    unpaid: "unpaid leave",
    emergency: "emergency leave",
  },
  halo: {
    rest_day_swap: "palit na day-off",
    accumulated_rest: "naipon na pahingalo",
    service_incentive: "service incentive leave",
    unpaid: "unpaid leave",
    emergency: "emergency leave",
  },
};

const COD_NOTE: Record<Locale, string> = {
  en: "Have {{amount}} ready (COD).",
  tl: "Ihanda ang {{amount}} (COD).",
  taglish: "Ready mo yung {{amount}} for COD.",
  halo: "Ihanda an {{amount}} (COD), ala eh.",
};

export function whenLabel(due: string, today: string, locale: Locale): string {
  const d = diffDays(due, today);
  if (locale === "taglish") {
    if (d === 0) return "today";
    if (d === 1) return "bukas";
    if (d > 1) return `in ${d} days`;
    return `${-d} days ago`;
  }
  if (locale === "halo") {
    // Bikol: ngunyan = today, sa aga = tomorrow, aldaw = day
    if (d === 0) return "ngunyan";
    if (d === 1) return "sa aga";
    if (d > 1) return `sa ${d} aldaw`;
    return `${-d} aldaw na`;
  }
  if (locale === "tl") {
    if (d === 0) return "ngayon";
    if (d === 1) return "bukas";
    if (d > 1) return `sa ${d} araw`;
    return `noong ${-d} araw`;
  }
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d > 1) return `in ${d} days`;
  return `${-d} days ago`;
}

export function shortRange(start: string, end: string, locale: Locale): string {
  const f = (d: string) =>
    new Intl.DateTimeFormat(locale === "tl" ? "fil-PH" : "en-PH", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  return start === end ? f(start) : `${f(start)}–${f(end)}`;
}

/** Turn raw reminder facts into the strings a template fills in, for one reader. */
export function localizeVars(v: ReminderVars, locale: Locale, now = new Date()): Record<string, string | number | undefined> {
  const today = todayManila(now);
  return {
    bill: v.bill,
    when: v.dueDate ? whenLabel(v.dueDate, today, locale) : undefined,
    amount: v.amount != null ? peso(v.amount) : undefined,
    item: v.item,
    errand: v.errand,
    days: v.days,
    meal: v.meal,
    slot: v.slot ? SLOT_LABEL[locale][v.slot] : undefined,
    helper: v.helper,
    type: v.leaveType ? LEAVE_TYPE_LABEL[locale][v.leaveType] : undefined,
    dates: v.startDate && v.endDate ? shortRange(v.startDate, v.endDate, locale) : undefined,
    note: v.note ?? "",
    courier: v.courier,
    cod: v.cod ? fill(COD_NOTE[locale], { amount: peso(v.cod) }) : "",
    by: v.by,
  };
}
