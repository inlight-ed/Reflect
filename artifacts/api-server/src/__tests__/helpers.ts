import { eq, inArray } from "drizzle-orm";
import { database } from "../lib/database";

/**
 * Test cleanup: removes a person's workspaces (and with them all their data), then the account.
 * The app itself never does this; deleting data is left to the server administrator.
 */
export async function deleteAccountForTests(userId: string) {
  const { db, usersTable, workspacesTable, workspaceMembersTable } = await database();
  const own = await db.select({ id: workspaceMembersTable.workspaceId }).from(workspaceMembersTable).where(eq(workspaceMembersTable.userId, userId));
  if (own.length) await db.delete(workspacesTable).where(inArray(workspacesTable.id, own.map((row) => row.id)));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
}
