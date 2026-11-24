import { z } from "zod";
import { HouseholdScoped, Id, Timestamp } from "./common";

/** Short household notes anyone can leave, e.g. "LPG is running low". */
export const HouseholdNote = HouseholdScoped.extend({
  authorId: Id,
  body: z.string().min(1).max(500),
  createdAt: Timestamp,
  pinned: z.boolean().default(false),
});
export type HouseholdNote = z.infer<typeof HouseholdNote>;

export const AddNoteRequest = z.object({ body: z.string().trim().min(1).max(500) });
export type AddNoteRequest = z.infer<typeof AddNoteRequest>;

export const AiProvider = z.enum(["none", "anthropic", "openai", "google"]);
export type AiProvider = z.infer<typeof AiProvider>;

export const AiSettings = z.object({
  provider: AiProvider,
  /** Model id for the chosen provider. */
  model: z.string().optional(),
  enabled: z.boolean(),
});
export type AiSettings = z.infer<typeof AiSettings>;
