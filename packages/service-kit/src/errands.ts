import type { Errand, ErrandOccurrence, IsoDate, Role } from "@mamamo/contracts";
import { addDays, expandRule } from "./dates";

/** One expanded occurrence of an errand on a given day (mo-ui's ErrandInstance). */
export interface ErrandInstance {
  errand: Errand;
  /** Day it shows on (the new day, if it was rescheduled). */
  date: IsoDate;
  /** Day it was originally due. */
  dueDate: IsoDate;
  occurrence?: ErrandOccurrence;
  overdue: boolean;
}

/**
 * Expand errands into the days between `from` and `to`, applying exception rows.
 * Helpers only see errands assigned to them.
 */
export function errandInstances(args: {
  errands: Errand[];
  occurrences: ErrandOccurrence[];
  from: IsoDate;
  to: IsoDate;
  today: IsoDate;
  viewer?: { id: string; role: Role };
}): ErrandInstance[] {
  const { from, to, today, viewer } = args;
  const byKey = new Map(args.occurrences.map((o) => [`${o.errandId}|${o.date}`, o]));
  const out: ErrandInstance[] = [];
  for (const errand of args.errands) {
    if (errand.archived) continue;
    if (viewer?.role === "helper" && errand.assigneeId !== viewer.id) continue;
    // Look back a month so rescheduled occurrences landing in range are found.
    for (const dueDate of expandRule(errand.rrule, errand.startDate, addDays(from, -31), to)) {
      const occurrence = byKey.get(`${errand.id}|${dueDate}`);
      const date = occurrence?.status === "rescheduled" && occurrence.rescheduledTo ? occurrence.rescheduledTo : dueDate;
      if (date < from || date > to) continue;
      const done = occurrence && occurrence.status !== "rescheduled";
      out.push({ errand, date, dueDate, ...(occurrence ? { occurrence } : {}), overdue: !done && date < today });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.errand.time ?? "99").localeCompare(b.errand.time ?? "99"));
}
