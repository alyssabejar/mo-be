import { z } from "zod";
import { Centavos, HouseholdScoped, Id, Locale, TimeOfDay, Timestamp } from "./common";
import { AiSettings } from "./notes";

export const Role = z.enum(["owner", "member", "helper"]);
export type Role = z.infer<typeof Role>;

export const Household = z.object({
  id: Id,
  name: z.string().min(1),
  weeklyGroceryBudget: Centavos,
  ai: AiSettings,
  createdAt: Timestamp,
});
export type Household = z.infer<typeof Household>;

export const ChannelPrefs = z.object({
  inApp: z.boolean(),
  webPush: z.boolean(),
  slack: z.boolean(),
});
export type ChannelPrefs = z.infer<typeof ChannelPrefs>;

export const QuietHours = z.object({
  enabled: z.boolean(),
  start: TimeOfDay,
  end: TimeOfDay,
});
export type QuietHours = z.infer<typeof QuietHours>;

export const User = HouseholdScoped.extend({
  role: Role,
  displayName: z.string().min(1),
  /** Owner and member log in with email + password. */
  email: z.string().email().optional(),
  /** Helper logs in with username + PIN; the account is created by the owner. */
  username: z.string().min(3).optional(),
  /** How mama addresses this person: "Anak", "Ate Lorna", "Kuya". Templates use {{tawag}}. */
  mamaCallsMe: z.string().min(1).max(40),
  locale: Locale,
  /** Straight notifications with no mama voice. */
  plainMode: z.boolean(),
  channels: ChannelPrefs,
  quietHours: QuietHours,
  createdAt: Timestamp,
});
export type User = z.infer<typeof User>;

/** Claims every service reads from the JWT. */
export const JwtClaims = z.object({
  sub: Id,
  householdId: Id,
  role: Role,
});
export type JwtClaims = z.infer<typeof JwtClaims>;

export const EmailLogin = z.object({
  kind: z.literal("email"),
  email: z.string().email(),
  password: z.string().min(8),
});
export const PinLogin = z.object({
  kind: z.literal("pin"),
  username: z.string().min(3),
  pin: z.string().regex(/^\d{4,6}$/, "PIN is 4 to 6 digits"),
});
export const LoginRequest = z.discriminatedUnion("kind", [EmailLogin, PinLogin]);
export type LoginRequest = z.infer<typeof LoginRequest>;

export const CreateHelperRequest = z.object({
  displayName: z.string().min(1),
  username: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[a-z0-9_.]+$/, "Lowercase letters, numbers, dots and underscores only"),
  pin: z.string().regex(/^\d{4,6}$/, "PIN is 4 to 6 digits"),
  mamaCallsMe: z.string().min(1).max(40),
  locale: Locale,
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type CreateHelperRequest = z.infer<typeof CreateHelperRequest>;

export const UpdateProfileRequest = User.pick({
  displayName: true,
  mamaCallsMe: true,
  locale: true,
  plainMode: true,
  channels: true,
  quietHours: true,
}).partial();
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;

export const UpdateHouseholdRequest = Household.pick({ name: true, weeklyGroceryBudget: true, ai: true }).partial();
export type UpdateHouseholdRequest = z.infer<typeof UpdateHouseholdRequest>;

export const CreateMemberRequest = z.object({
  displayName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  mamaCallsMe: z.string().min(1).max(40),
  locale: Locale,
});
export type CreateMemberRequest = z.infer<typeof CreateMemberRequest>;

/** What each role may do. Services enforce this; the UI hides what a role can't use. */
export const PERMISSIONS = {
  "household.settings": ["owner"],
  "members.manage": ["owner"],
  "ai.settings": ["owner"],
  "budget.manage": ["owner"],
  "leave.approve": ["owner"],
  "leave.file": ["helper"],
  "meals.plan": ["owner", "member"],
  "meals.view": ["owner", "member", "helper"],
  "ai.suggest": ["owner", "member"],
  "errands.manage": ["owner", "member"],
  "errands.complete": ["owner", "member", "helper"],
  "calendar.full": ["owner", "member"],
  "grocery.check": ["owner", "member", "helper"],
  "grocery.manage": ["owner", "member"],
  "supplies.check": ["owner", "member", "helper"],
  "supplies.manage": ["owner", "member"],
  "bills.manage": ["owner", "member"],
  "parcels.manage": ["owner", "member", "helper"],
  "notes.add": ["owner", "member", "helper"],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
