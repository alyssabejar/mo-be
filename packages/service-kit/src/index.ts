export * from "./app";
export * from "./auth";
export * from "./bus";
export * from "./dates";
export * from "./db";
export * from "./directory";
export * from "./errands";
export * from "./errors";
export * from "./format";
export * from "./outbox";
export * from "./runtime";
export * from "./subjects";
export * as kitTables from "./tables";
export { directory, outbox as outboxTable, processedEvents } from "./tables";

/** Short random id with a readable prefix, e.g. uid("e") → "e_3f9a1c0b2d4e". */
export function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Drop undefined values so optional contract fields stay absent rather than null. */
export function compact<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as T;
}
