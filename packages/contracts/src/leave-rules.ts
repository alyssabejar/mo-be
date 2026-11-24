/**
 * Kasambahay leave rules under RA 10361 (Batas Kasambahay), as written in the
 * requirements doc. Verify against current DOLE guidance before relying on them.
 *
 * - 24 consecutive hours of rest every week.
 * - Unused rest days may accumulate, up to 5 days.
 * - 5 days of paid service incentive leave (SIL) a year, after 1 year of service.
 * - Unused SIL is not carried over to the next year.
 */
import type { IsoDate } from "./common";
import type { LeaveBalance, LeaveRequest, LeaveType } from "./staff";

export const MAX_ACCUMULATED_REST = 5;
export const SIL_DAYS_PER_YEAR = 5;

export const PAID_LEAVE_TYPES: readonly LeaveType[] = ["rest_day_swap", "accumulated_rest", "service_incentive"];

function toUtc(date: IsoDate): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

/** Inclusive number of calendar days in a range. */
export function daysInRange(start: IsoDate, end: IsoDate): number {
  return Math.round((toUtc(end) - toUtc(start)) / 86_400_000) + 1;
}

export function addYears(date: IsoDate, years: number): IsoDate {
  const [y, m, d] = date.split("-") as [string, string, string];
  return `${Number(y) + years}-${m}-${d}`;
}

export function isSilEligible(hireDate: IsoDate, today: IsoDate): boolean {
  return addYears(hireDate, 1) <= today;
}

/** SIL days already used (approved) in a given year. Pending requests are held too. */
export function silUsed(requests: LeaveRequest[], helperId: string, year: number): number {
  return requests
    .filter(
      (r) =>
        r.helperId === helperId &&
        r.type === "service_incentive" &&
        (r.status === "approved" || r.status === "pending") &&
        r.startDate.startsWith(String(year)),
    )
    .reduce((n, r) => n + daysInRange(r.startDate, r.endDate), 0);
}

export function computeBalance(args: {
  helperId: string;
  hireDate: IsoDate;
  today: IsoDate;
  accumulatedRestEarned: number;
  requests: LeaveRequest[];
}): LeaveBalance {
  const year = Number(args.today.slice(0, 4));
  const eligible = isSilEligible(args.hireDate, args.today);
  const usedAccumulated = args.requests
    .filter(
      (r) =>
        r.helperId === args.helperId &&
        r.type === "accumulated_rest" &&
        (r.status === "approved" || r.status === "pending"),
    )
    .reduce((n, r) => n + daysInRange(r.startDate, r.endDate), 0);
  return {
    helperId: args.helperId,
    year,
    accumulatedRest: Math.max(0, Math.min(MAX_ACCUMULATED_REST, args.accumulatedRestEarned) - usedAccumulated),
    silRemaining: eligible ? Math.max(0, SIL_DAYS_PER_YEAR - silUsed(args.requests, args.helperId, year)) : 0,
    silEligible: eligible,
  };
}

export type LeaveValidationError =
  | { code: "end_before_start" }
  | { code: "in_past" }
  | { code: "sil_not_eligible" }
  | { code: "sil_insufficient"; remaining: number; requested: number }
  | { code: "accumulated_insufficient"; remaining: number; requested: number }
  | { code: "swap_one_day" }
  | { code: "overlaps"; with: string };

/** Checks a new request against the helper's balance and existing requests. Returns null when valid. */
export function validateLeave(args: {
  type: LeaveType;
  startDate: IsoDate;
  endDate: IsoDate;
  today: IsoDate;
  balance: LeaveBalance;
  existing: LeaveRequest[];
}): LeaveValidationError | null {
  const { type, startDate, endDate, today, balance } = args;
  if (endDate < startDate) return { code: "end_before_start" };
  if (startDate < today && type !== "emergency") return { code: "in_past" };
  const days = daysInRange(startDate, endDate);
  if (type === "rest_day_swap" && days !== 1) return { code: "swap_one_day" };
  if (type === "service_incentive") {
    if (!balance.silEligible) return { code: "sil_not_eligible" };
    if (days > balance.silRemaining) return { code: "sil_insufficient", remaining: balance.silRemaining, requested: days };
  }
  if (type === "accumulated_rest" && days > balance.accumulatedRest) {
    return { code: "accumulated_insufficient", remaining: balance.accumulatedRest, requested: days };
  }
  const clash = args.existing.find(
    (r) =>
      (r.status === "pending" || r.status === "approved") && r.startDate <= endDate && r.endDate >= startDate,
  );
  if (clash) return { code: "overlaps", with: clash.id };
  return null;
}
