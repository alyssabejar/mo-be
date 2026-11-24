import { HOUSEHOLD_TIME_ZONE, type IsoDate, type Weekday } from "@mamamo/contracts";
import rrulePkg from "rrule";

// rrule ships CommonJS; take the named exports off the default under Node ESM.
const { RRule, rrulestr } = rrulePkg as unknown as typeof import("rrule");
type RRuleT = InstanceType<typeof RRule>;

/**
 * Dates are plain calendar days ("YYYY-MM-DD") in Asia/Manila. Arithmetic runs on
 * UTC midnights so it never drifts with the server's zone. Same helpers as mo-ui.
 */

const isoFmt = new Intl.DateTimeFormat("en-CA", { timeZone: HOUSEHOLD_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: HOUSEHOLD_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false });

export function todayManila(now: Date = new Date()): IsoDate {
  return isoFmt.format(now);
}

export function nowTimeManila(now: Date = new Date()): string {
  return timeFmt.format(now);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function toUtcDate(date: IsoDate): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

export function fromUtcDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, n: number): IsoDate {
  const d = toUtcDate(date);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtcDate(d);
}

export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtcDate(a).getTime() - toUtcDate(b).getTime()) / 86_400_000);
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: IsoDate): IsoDate {
  const dow = toUtcDate(date).getUTCDay();
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export function weekDates(weekStart: IsoDate): IsoDate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

const WEEKDAYS: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
export function weekdayOf(date: IsoDate): Weekday {
  return WEEKDAYS[toUtcDate(date).getUTCDay()]!;
}

function parseRule(rule: string, startDate: IsoDate): RRuleT {
  return rrulestr(`RRULE:${rule}`, { dtstart: toUtcDate(startDate) }) as RRuleT;
}

/** Expand an RRULE anchored at `startDate` into the days between `from` and `to` (inclusive). No rule = once on `startDate`. */
export function expandRule(rule: string | undefined | null, startDate: IsoDate, from: IsoDate, to: IsoDate): IsoDate[] {
  if (!rule) return startDate >= from && startDate <= to ? [startDate] : [];
  return parseRule(rule, startDate).between(toUtcDate(from), toUtcDate(to), true).map(fromUtcDate);
}

export function nextOccurrence(rule: string | undefined | null, startDate: IsoDate, from: IsoDate): IsoDate | undefined {
  if (!rule) return startDate >= from ? startDate : undefined;
  const next = parseRule(rule, startDate).after(toUtcDate(from), true);
  return next ? fromUtcDate(next) : undefined;
}

export function previousOccurrence(rule: string | undefined | null, startDate: IsoDate, onOrBefore: IsoDate): IsoDate | undefined {
  if (!rule) return startDate <= onOrBefore ? startDate : undefined;
  const prev = parseRule(rule, startDate).before(toUtcDate(onOrBefore), true);
  return prev ? fromUtcDate(prev) : undefined;
}

/** Due date of a monthly bill in a month, clamped to the month's last day. */
export function billDueDate(year: number, monthIndex: number, dueDay: number): IsoDate {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return fromUtcDate(new Date(Date.UTC(year, monthIndex, Math.min(dueDay, last))));
}

/** Whether a Manila wall-clock time is inside quiet hours (which may wrap midnight). */
export function inQuietHours(now: string, start: string, end: string): boolean {
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}
