import type {
  Bill,
  BillCycle,
  Errand,
  ErrandOccurrence,
  GroceryList,
  HelperProfile,
  Household,
  IsoDate,
  LeaveRequest,
  MealSlotKind,
  NotificationAction,
  NotificationKind,
  Parcel,
  PlannedMeal,
  SupplyItem,
  SupplyStatus,
  User,
} from "@mamamo/contracts";
import type { LiveTopic } from "@mamamo/contracts";

/**
 * Every event subject and its payload. The contracts' SUBJECTS list is the
 * public summary from the requirements doc; this is the full catalog the
 * services publish and consume. Owner service is the first token.
 */
export interface EventCatalog {
  "identity.household.updated": { household: Household };
  "identity.user.created": { user: User; helper?: { hireDate: IsoDate; birthDate?: IsoDate } };
  "identity.user.updated": { user: User };
  "identity.user.removed": { userId: string };
  "identity.note.changed": { noteId: string };

  "meal.recipe.changed": { recipeId: string; removed?: boolean };
  "meal.slot.upserted": { meal: PlannedMeal };
  "meal.slot.removed": { mealId: string; date: IsoDate; slot: MealSlotKind };
  "meal.grocery_list.generated": { list: GroceryList };
  "meal.grocery_list.changed": { listId: string };

  "errand.upserted": { errand: Errand };
  "errand.archived": { errandId: string };
  /** Any status (done, skipped, rescheduled) set on one occurrence. */
  "errand.occurrence.completed": { occurrence: ErrandOccurrence };
  "errand.occurrence.cleared": { errandId: string; date: IsoDate };

  "staff.profile.upserted": { profile: HelperProfile };
  "staff.leave.requested": { leave: LeaveRequest };
  "staff.leave.approved": { leave: LeaveRequest };
  "staff.leave.rejected": { leave: LeaveRequest };
  "staff.leave.cancelled": { leave: LeaveRequest };

  "supply.upserted": { supply: SupplyItem };
  "supply.removed": { supplyId: string };
  "supply.checked": { supply: SupplyItem; status: SupplyStatus };
  "bill.upserted": { bill: Bill };
  "bill.removed": { billId: string };
  "bill.cycle.upserted": { cycle: BillCycle };
  "bill.cycle.removed": { cycleId: string };
  "bill.cycle.paid": { cycle: BillCycle };
  "bill.cycle.snoozed": { cycle: BillCycle };
  "parcel.upserted": { parcel: Parcel };
  "parcel.removed": { parcelId: string };
  "parcel.status.changed": { parcel: Parcel; previous: Parcel["status"] };

  /** A reminder fired. notification-service renders it per user and delivers it per channel. */
  "reminder.due": ReminderDue;

  "notification.inbox.changed": { userId: string };
}

export type Subject = keyof EventCatalog;

export type TemplateKey =
  | "bill_due"
  | "supply_check"
  | "errand_due"
  | "errand_overdue"
  | "leave_requested"
  | "leave_approved"
  | "leave_rejected"
  | "parcel_update"
  | "parcel_delivered"
  | "meal_cook";

/**
 * Raw facts, not words: notification-service turns them into the user's
 * locale and mama voice (dates, peso amounts, leave-type and meal-slot labels).
 */
export type ReminderVars = {
  bill?: string;
  dueDate?: IsoDate;
  amount?: number;
  item?: string;
  errand?: string;
  days?: number;
  meal?: string;
  slot?: MealSlotKind;
  helper?: string;
  leaveType?: LeaveRequest["type"];
  startDate?: IsoDate;
  endDate?: IsoDate;
  note?: string;
  courier?: string;
  cod?: number;
  by?: string;
};

export interface ReminderDue {
  userId: string;
  kind: NotificationKind;
  template: TemplateKey;
  level: 1 | 2 | 3;
  subject: string;
  /** Unique per reminder and occurrence; notification appends level, user and channel. */
  key: string;
  actions: NotificationAction[];
  vars: ReminderVars;
}

/** Which browser query families an event invalidates (pushed over SSE by calendar-service). */
export function liveTopicsFor(subject: string): LiveTopic[] {
  const [family, kind] = subject.split(".");
  switch (family) {
    case "identity":
      return kind === "household" || kind === "note" ? ["household"] : ["members"];
    case "meal":
      return kind === "grocery_list" ? ["grocery"] : ["meals", "grocery"];
    case "errand":
      return ["errands"];
    case "staff":
      return ["staff"];
    case "supply":
      return ["supplies", "grocery"];
    case "bill":
      return ["bills"];
    case "parcel":
      return ["parcels"];
    case "notification":
      return ["inbox"];
    default:
      return [];
  }
}
