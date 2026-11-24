import { z } from "zod";
import { HouseholdScoped, Id, IsoDate, RRuleString, TimeOfDay, Timestamp } from "./common";

export const ErrandCategory = z.enum(["cleaning", "laundry", "cooking", "pets", "shopping", "garden", "other"]);
export type ErrandCategory = z.infer<typeof ErrandCategory>;

export const Priority = z.enum(["low", "normal", "high"]);
export type Priority = z.infer<typeof Priority>;

export const Errand = HouseholdScoped.extend({
  title: z.string().min(1),
  notes: z.string().optional(),
  category: ErrandCategory,
  priority: Priority,
  assigneeId: Id.optional(),
  /** First (or only) date. */
  startDate: IsoDate,
  time: TimeOfDay.optional(),
  /** Stored once; occurrences are expanded on read. Absent for one-off errands. */
  rrule: RRuleString.optional(),
  createdBy: Id,
  createdAt: Timestamp,
  archived: z.boolean().default(false),
});
export type Errand = z.infer<typeof Errand>;

export const CreateErrandRequest = Errand.pick({
  title: true,
  notes: true,
  category: true,
  priority: true,
  assigneeId: true,
  startDate: true,
  time: true,
  rrule: true,
});
export type CreateErrandRequest = z.infer<typeof CreateErrandRequest>;

export const OccurrenceStatus = z.enum(["done", "skipped", "rescheduled"]);
export type OccurrenceStatus = z.infer<typeof OccurrenceStatus>;

/** Exception row for one occurrence of an errand. */
export const ErrandOccurrence = z.object({
  errandId: Id,
  /** The date the occurrence was originally due. */
  date: IsoDate,
  status: OccurrenceStatus,
  completedBy: Id.optional(),
  completedAt: Timestamp.optional(),
  rescheduledTo: IsoDate.optional(),
  note: z.string().optional(),
});
export type ErrandOccurrence = z.infer<typeof ErrandOccurrence>;

export const UpdateOccurrenceRequest = ErrandOccurrence.pick({
  errandId: true,
  date: true,
  status: true,
  rescheduledTo: true,
  note: true,
});
export type UpdateOccurrenceRequest = z.infer<typeof UpdateOccurrenceRequest>;
