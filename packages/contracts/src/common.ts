import { z } from "zod";

/** Calendar date with no time, e.g. "2026-11-24". All-day items are stored this way. */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
export type IsoDate = z.infer<typeof IsoDate>;

/** Wall-clock time of day in Asia/Manila, e.g. "07:30". */
export const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm");
export type TimeOfDay = z.infer<typeof TimeOfDay>;

/** UTC instant (Postgres timestamptz), serialised as ISO 8601. */
export const Timestamp = z.string().datetime({ offset: true });
export type Timestamp = z.infer<typeof Timestamp>;

export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;

/** Every row carries householdId so multi-household stays possible. */
export const HouseholdScoped = z.object({
  id: Id,
  householdId: Id,
});

/**
 * A person's language preference for the UI and Mama's reminders.
 * taglish = English–Tagalog mix; halo = a playful mix of English,
 * Batangueño and Bikol.
 */
export const Locale = z.enum(["en", "tl", "taglish", "halo"]);
export type Locale = z.infer<typeof Locale>;

/** Language a recipe was written in. Recipes stay in their own language. */
export const RecipeLanguage = z.enum(["en", "tl"]);
export type RecipeLanguage = z.infer<typeof RecipeLanguage>;

export const HOUSEHOLD_TIME_ZONE = "Asia/Manila";

/** RFC 5545 RRULE body without the "RRULE:" prefix, e.g. "FREQ=WEEKLY;BYDAY=MO,TH". */
export const RRuleString = z
  .string()
  .regex(/^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[^;]+)*$/, "Expected an RRULE like FREQ=WEEKLY;BYDAY=MO");
export type RRuleString = z.infer<typeof RRuleString>;

/** Money in Philippine pesos, stored as centavos to avoid float drift. */
export const Centavos = z.number().int().nonnegative();
export type Centavos = z.infer<typeof Centavos>;
