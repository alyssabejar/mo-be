import { z } from "zod";
import { HouseholdScoped, Id, IsoDate, Timestamp } from "./common";

export const Weekday = z.enum(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);
export type Weekday = z.infer<typeof Weekday>;

export const HelperProfile = HouseholdScoped.extend({
  userId: Id,
  hireDate: IsoDate,
  /** Used to tell two house managers apart as Sr. (older) and Jr. (younger). */
  birthDate: IsoDate.optional(),
  /** Weekly rest day (24 consecutive hours). Who sets it is still an open decision. */
  restDay: Weekday,
});
export type HelperProfile = z.infer<typeof HelperProfile>;

export const LeaveType = z.enum([
  "rest_day_swap",
  "accumulated_rest",
  "service_incentive",
  "unpaid",
  "emergency",
]);
export type LeaveType = z.infer<typeof LeaveType>;

export const LeaveStatus = z.enum(["pending", "approved", "rejected", "cancelled"]);
export type LeaveStatus = z.infer<typeof LeaveStatus>;

export const LeaveRequest = HouseholdScoped.extend({
  helperId: Id,
  type: LeaveType,
  startDate: IsoDate,
  endDate: IsoDate,
  /** For a rest-day swap: the usual rest day being given up. */
  swapFrom: IsoDate.optional(),
  reason: z.string().max(500).optional(),
  status: LeaveStatus,
  decidedBy: Id.optional(),
  decidedAt: Timestamp.optional(),
  decisionNote: z.string().optional(),
  createdAt: Timestamp,
});
export type LeaveRequest = z.infer<typeof LeaveRequest>;

export const FileLeaveRequest = LeaveRequest.pick({
  type: true,
  startDate: true,
  endDate: true,
  swapFrom: true,
  reason: true,
})
  .refine((r) => r.endDate >= r.startDate, { message: "End date is before start date", path: ["endDate"] })
  .refine((r) => r.type !== "rest_day_swap" || !!r.swapFrom, {
    message: "Pick the rest day you are swapping",
    path: ["swapFrom"],
  });
export type FileLeaveRequest = z.infer<typeof FileLeaveRequest>;

export const DecideLeaveRequest = z.object({
  id: Id,
  decision: z.enum(["approved", "rejected"]),
  note: z.string().optional(),
});
export type DecideLeaveRequest = z.infer<typeof DecideLeaveRequest>;

export const LeaveBalance = z.object({
  helperId: Id,
  year: z.number().int(),
  /** Accumulated unused rest days, capped at 5. */
  accumulatedRest: z.number().int().min(0).max(5),
  /** Service incentive leave days left this year (5/yr once 1 year of service is reached). */
  silRemaining: z.number().int().min(0).max(5),
  silEligible: z.boolean(),
});
export type LeaveBalance = z.infer<typeof LeaveBalance>;
