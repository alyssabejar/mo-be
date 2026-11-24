/**
 * NATS subjects exchanged between services. Services never share a database or
 * call each other for data; the calendar read model is rebuilt from these.
 */
export const SUBJECTS = {
  identityUser: "identity.user.*",
  mealSlot: "meal.slot.*",
  groceryGenerated: "meal.grocery_list.generated",
  errand: "errand.*",
  errandCompleted: "errand.occurrence.completed",
  leaveRequested: "staff.leave.requested",
  leaveApproved: "staff.leave.approved",
  reminderDue: "reminder.due",
  parcelStatusChanged: "parcel.status.changed",
} as const;

/** Topics pushed to browsers over SSE so other devices update live. */
export const LIVE_TOPICS = [
  "meals",
  "grocery",
  "errands",
  "staff",
  "supplies",
  "bills",
  "parcels",
  "inbox",
  "members",
  "household",
] as const;
export type LiveTopic = (typeof LIVE_TOPICS)[number];
