import { z } from "zod";
import { Centavos, HouseholdScoped, Id, IsoDate, RRuleString, Timestamp } from "./common";

export const SupplyCategory = z.enum(["pet", "food", "household"]);
export type SupplyCategory = z.infer<typeof SupplyCategory>;

export const SupplyStatus = z.enum(["ok", "low", "out"]);
export type SupplyStatus = z.infer<typeof SupplyStatus>;

export const SupplyItem = HouseholdScoped.extend({
  name: z.string().min(1),
  category: SupplyCategory,
  /** Check schedule, e.g. every Monday and Thursday. */
  checkRule: RRuleString,
  checkStartDate: IsoDate,
  assigneeId: Id.optional(),
  lastStatus: SupplyStatus.optional(),
  lastCheckedAt: Timestamp.optional(),
  lastCheckedBy: Id.optional(),
  /** Default quantity added to the grocery list when Low or Out. */
  restockQty: z.number().positive(),
  restockUnit: z.string().optional(),
  estPrice: Centavos.optional(),
});
export type SupplyItem = z.infer<typeof SupplyItem>;

export const CreateSupplyRequest = SupplyItem.pick({
  name: true,
  category: true,
  checkRule: true,
  checkStartDate: true,
  assigneeId: true,
  restockQty: true,
  restockUnit: true,
  estPrice: true,
});
export type CreateSupplyRequest = z.infer<typeof CreateSupplyRequest>;

export const SupplyCheck = z.object({
  supplyId: Id,
  status: SupplyStatus,
  checkedBy: Id,
  checkedAt: Timestamp,
});
export type SupplyCheck = z.infer<typeof SupplyCheck>;

export const BillKind = z.enum(["electricity", "water", "internet", "other"]);
export type BillKind = z.infer<typeof BillKind>;

export const Bill = HouseholdScoped.extend({
  name: z.string().min(1),
  kind: BillKind,
  provider: z.string().optional(),
  accountNumber: z.string().optional(),
  /** Day of month the bill falls due. */
  dueDay: z.number().int().min(1).max(31),
  /** Remind this many days before due. */
  remindDaysBefore: z.number().int().min(0).max(30),
  assigneeId: Id,
  typicalAmount: Centavos.optional(),
});
export type Bill = z.infer<typeof Bill>;

export const CreateBillRequest = Bill.pick({
  name: true,
  kind: true,
  provider: true,
  accountNumber: true,
  dueDay: true,
  remindDaysBefore: true,
  assigneeId: true,
  typicalAmount: true,
});
export type CreateBillRequest = z.infer<typeof CreateBillRequest>;

export const BillCycle = z.object({
  id: Id,
  billId: Id,
  dueDate: IsoDate,
  amount: Centavos.optional(),
  paidAt: Timestamp.optional(),
  paidBy: Id.optional(),
  /** Receipt photo; a data URL in the mock, an object-storage key in production. */
  receipt: z.string().optional(),
  snoozedUntil: Timestamp.optional(),
});
export type BillCycle = z.infer<typeof BillCycle>;

export const MarkBillPaidRequest = z.object({
  cycleId: Id,
  amount: Centavos,
  receipt: z.string().optional(),
});
export type MarkBillPaidRequest = z.infer<typeof MarkBillPaidRequest>;

export const Courier = z.enum(["SPX", "J&T", "LBC", "LEX PH", "Ninja Van", "Flash", "Other"]);
export type Courier = z.infer<typeof Courier>;

export const ParcelStatus = z.enum(["info_received", "in_transit", "out_for_delivery", "delivered", "exception"]);
export type ParcelStatus = z.infer<typeof ParcelStatus>;

export const ParcelEvent = z.object({
  at: Timestamp,
  status: ParcelStatus,
  message: z.string(),
});

export const Parcel = HouseholdScoped.extend({
  trackingNumber: z.string().min(4),
  courier: Courier,
  description: z.string().min(1),
  /** Cash on delivery amount to prepare. */
  codAmount: Centavos.optional(),
  status: ParcelStatus,
  events: z.array(ParcelEvent),
  addedBy: Id,
  receivedAt: Timestamp.optional(),
  receivedBy: Id.optional(),
  createdAt: Timestamp,
});
export type Parcel = z.infer<typeof Parcel>;

export const AddParcelRequest = Parcel.pick({
  trackingNumber: true,
  courier: true,
  description: true,
  codAmount: true,
});
export type AddParcelRequest = z.infer<typeof AddParcelRequest>;
