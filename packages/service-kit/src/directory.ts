import type { User } from "@mamamo/contracts";
import { and, eq, isNull } from "drizzle-orm";
import type { EventEnvelope } from "./bus";
import type { Queryable, Tx } from "./db";
import type { EventCatalog } from "./subjects";
import { directory } from "./tables";

export const IDENTITY_USER_SUBJECTS = ["identity.user.created", "identity.user.updated", "identity.user.removed"];

/** Keep the local member directory in step with identity-service. */
export async function applyUserEvent(tx: Tx<any>, event: EventEnvelope<any>): Promise<boolean> {
  switch (event.subject) {
    case "identity.user.created":
    case "identity.user.updated": {
      const { user } = event.data as EventCatalog["identity.user.updated"];
      await tx
        .insert(directory)
        .values({ userId: user.id, householdId: user.householdId, role: user.role, user, removedAt: null })
        .onConflictDoUpdate({ target: directory.userId, set: { role: user.role, user, householdId: user.householdId, removedAt: null } });
      return true;
    }
    case "identity.user.removed": {
      const { userId } = event.data as EventCatalog["identity.user.removed"];
      await tx.update(directory).set({ removedAt: new Date() }).where(eq(directory.userId, userId));
      return true;
    }
    default:
      return false;
  }
}

export async function directoryUsers(db: Queryable<any>, householdId: string): Promise<User[]> {
  const rows = await db.select().from(directory).where(and(eq(directory.householdId, householdId), isNull(directory.removedAt)));
  return rows.map((r) => r.user);
}

export async function directoryUser(db: Queryable<any>, userId: string): Promise<User | undefined> {
  const [row] = await db.select().from(directory).where(and(eq(directory.userId, userId), isNull(directory.removedAt)));
  return row?.user;
}
