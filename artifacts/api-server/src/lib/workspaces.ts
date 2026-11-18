import { and, asc, count, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { database } from "./database";
import { newToken, sha256 } from "./security";

/**
 * Workspaces own all data. A shop workspace is one seller's store; an agency workspace holds the
 * agency's clients and their media plans. People sign in once and open any workspace they are a
 * member of; the session remembers which one is open.
 */
export type WorkspaceKind = "SHOP" | "AGENCY";
export type WorkspaceRole = "OWNER" | "MEMBER" | "VIEWER";
export type CurrentWorkspace = { id: string; kind: WorkspaceKind; name: string; role: WorkspaceRole };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      workspace?: CurrentWorkspace;
      /** sha256 of the session token, to remember the open workspace. */
      sessionHash?: string;
    }
  }
}

export const WORKSPACE_KINDS: WorkspaceKind[] = ["SHOP", "AGENCY"];
export const WORKSPACE_ROLES: WorkspaceRole[] = ["OWNER", "MEMBER", "VIEWER"];
/** A person can create up to this many workspaces; invitations do not count. */
export const MAX_OWN_WORKSPACES = 20;
export const MAX_CLIENTS = 200;
const INVITE_DAYS = 7;

export class WorkspaceError extends Error {
  constructor(public code: "NOT_FOUND" | "FORBIDDEN" | "INVALID_NAME" | "TOO_MANY" | "INVALID_INVITE" | "LAST_OWNER" | "NOT_AGENCY") {
    super(code);
  }
}

type Tx = Parameters<Parameters<Awaited<ReturnType<typeof database>>["db"]["transaction"]>[0]>[0];
type Db = Awaited<ReturnType<typeof database>>["db"] | Tx;

const cleanName = (name: string) => {
  const value = name.replace(/\s+/g, " ").trim();
  if (!value || value.length > 80) throw new WorkspaceError("INVALID_NAME");
  return value;
};

/** Creates a workspace with the person as its owner. Used at sign-up and from the switcher. */
export async function insertWorkspace(db: Db, userId: string, kind: WorkspaceKind, name: string) {
  const { workspacesTable, workspaceMembersTable } = await database();
  const id = randomUUID();
  await db.insert(workspacesTable).values({ id, kind, name: cleanName(name) });
  await db.insert(workspaceMembersTable).values({ workspaceId: id, userId, role: "OWNER" });
  return id;
}

export async function createWorkspace(userId: string, kind: WorkspaceKind, name: string, sessionHash?: string) {
  const { db, workspaceMembersTable, sessionsTable } = await database();
  const [{ owned }] = await db.select({ owned: count() }).from(workspaceMembersTable)
    .where(and(eq(workspaceMembersTable.userId, userId), eq(workspaceMembersTable.role, "OWNER")));
  if (owned >= MAX_OWN_WORKSPACES) throw new WorkspaceError("TOO_MANY");
  const id = await db.transaction((tx) => insertWorkspace(tx, userId, kind, name));
  if (sessionHash) await db.update(sessionsTable).set({ workspaceId: id }).where(eq(sessionsTable.id, sessionHash));
  return id;
}

export async function listWorkspaces(userId: string): Promise<CurrentWorkspace[]> {
  const { db, workspacesTable, workspaceMembersTable } = await database();
  const rows = await db
    .select({ id: workspacesTable.id, kind: workspacesTable.kind, name: workspacesTable.name, role: workspaceMembersTable.role })
    .from(workspaceMembersTable)
    .innerJoin(workspacesTable, eq(workspacesTable.id, workspaceMembersTable.workspaceId))
    .where(eq(workspaceMembersTable.userId, userId))
    .orderBy(asc(workspaceMembersTable.createdAt), asc(workspacesTable.name));
  return rows as CurrentWorkspace[];
}

/**
 * The workspace this request works in: the one the session remembers if the person is still a
 * member, otherwise their first one. Someone who left every workspace gets a fresh shop, so a
 * signed-in person always has somewhere to work.
 */
export async function resolveWorkspace(userId: string, remembered: string | null, fallbackName: string): Promise<CurrentWorkspace> {
  const all = await listWorkspaces(userId);
  const found = all.find((item) => item.id === remembered) ?? all[0];
  if (found) return found;
  const { db } = await database();
  const id = await db.transaction((tx) => insertWorkspace(tx, userId, "SHOP", fallbackName));
  return { id, kind: "SHOP", name: cleanName(fallbackName), role: "OWNER" };
}

export async function switchWorkspace(userId: string, sessionHash: string, workspaceId: string) {
  const { db, sessionsTable } = await database();
  const all = await listWorkspaces(userId);
  if (!all.some((item) => item.id === workspaceId)) throw new WorkspaceError("NOT_FOUND");
  await db.update(sessionsTable).set({ workspaceId }).where(and(eq(sessionsTable.id, sessionHash), eq(sessionsTable.userId, userId)));
}

export async function renameWorkspace(workspaceId: string, name: string) {
  const { db, workspacesTable } = await database();
  await db.update(workspacesTable).set({ name: cleanName(name) }).where(eq(workspacesTable.id, workspaceId));
}

export async function listMembers(workspaceId: string) {
  const { db, usersTable, workspaceMembersTable } = await database();
  const rows = await db
    .select({ userId: usersTable.id, email: usersTable.email, name: usersTable.name, role: workspaceMembersTable.role, joinedAt: workspaceMembersTable.createdAt })
    .from(workspaceMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, workspaceMembersTable.userId))
    .where(eq(workspaceMembersTable.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembersTable.createdAt));
  return rows.map((row) => ({ ...row, role: row.role as WorkspaceRole, joinedAt: row.joinedAt.toISOString() }));
}

async function ownerCount(db: Db, workspaceId: string) {
  const { workspaceMembersTable } = await database();
  const [{ owners }] = await db.select({ owners: count() }).from(workspaceMembersTable)
    .where(and(eq(workspaceMembersTable.workspaceId, workspaceId), eq(workspaceMembersTable.role, "OWNER")));
  return owners;
}

/** Changes a member's role. A workspace always keeps at least one owner. */
export async function setMemberRole(workspaceId: string, userId: string, role: WorkspaceRole) {
  const { db, workspaceMembersTable } = await database();
  await db.transaction(async (tx) => {
    // Lock the workspace's member rows so two owners demoting each other cannot leave none.
    const members = await tx.select().from(workspaceMembersTable).where(eq(workspaceMembersTable.workspaceId, workspaceId)).for("update");
    const target = members.find((member) => member.userId === userId);
    if (!target) throw new WorkspaceError("NOT_FOUND");
    if (target.role === "OWNER" && role !== "OWNER" && (await ownerCount(tx, workspaceId)) <= 1) throw new WorkspaceError("LAST_OWNER");
    await tx.update(workspaceMembersTable).set({ role }).where(and(eq(workspaceMembersTable.workspaceId, workspaceId), eq(workspaceMembersTable.userId, userId)));
  });
}

/**
 * Takes a person out of a workspace (an owner removing someone, or someone leaving). This removes
 * access only: the workspace's data stays. Deleting data is left to the server administrator.
 */
export async function removeMember(workspaceId: string, userId: string) {
  const { db, workspaceMembersTable, sessionsTable } = await database();
  await db.transaction(async (tx) => {
    const members = await tx.select().from(workspaceMembersTable).where(eq(workspaceMembersTable.workspaceId, workspaceId)).for("update");
    const target = members.find((member) => member.userId === userId);
    if (!target) throw new WorkspaceError("NOT_FOUND");
    if (target.role === "OWNER" && (await ownerCount(tx, workspaceId)) <= 1) throw new WorkspaceError("LAST_OWNER");
    await tx.delete(workspaceMembersTable).where(and(eq(workspaceMembersTable.workspaceId, workspaceId), eq(workspaceMembersTable.userId, userId)));
    await tx.update(sessionsTable).set({ workspaceId: null }).where(and(eq(sessionsTable.userId, userId), eq(sessionsTable.workspaceId, workspaceId)));
  });
}

export async function createInvite(workspaceId: string, createdBy: string, role: WorkspaceRole) {
  const { db, workspaceInvitesTable } = await database();
  const [{ open }] = await db.select({ open: count() }).from(workspaceInvitesTable)
    .where(and(eq(workspaceInvitesTable.workspaceId, workspaceId), isNull(workspaceInvitesTable.usedAt), gt(workspaceInvitesTable.expiresAt, new Date())));
  if (open >= 50) throw new WorkspaceError("TOO_MANY");
  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  await db.insert(workspaceInvitesTable).values({ tokenHash: sha256(token), workspaceId, role, createdBy, expiresAt });
  return { token, role, expiresAt: expiresAt.toISOString() };
}

/** What an invitation link opens, shown before the person accepts it. */
export async function previewInvite(token: string) {
  const { db, workspaceInvitesTable, workspacesTable } = await database();
  const [row] = await db
    .select({ name: workspacesTable.name, kind: workspacesTable.kind, role: workspaceInvitesTable.role })
    .from(workspaceInvitesTable)
    .innerJoin(workspacesTable, eq(workspacesTable.id, workspaceInvitesTable.workspaceId))
    .where(and(eq(workspaceInvitesTable.tokenHash, sha256(token)), isNull(workspaceInvitesTable.usedAt), gt(workspaceInvitesTable.expiresAt, new Date())));
  if (!row) throw new WorkspaceError("INVALID_INVITE");
  return { name: row.name, kind: row.kind as WorkspaceKind, role: row.role as WorkspaceRole };
}

/**
 * Accepting a link adds the person to the workspace and opens it. The link is used up in the same
 * statement that checks it, so it works exactly once. Someone who is already a member keeps the
 * role they have.
 */
export async function acceptInvite(token: string, userId: string, sessionHash?: string) {
  const { db, workspaceInvitesTable, workspaceMembersTable, sessionsTable } = await database();
  const workspaceId = await db.transaction(async (tx) => {
    const [invite] = await tx.update(workspaceInvitesTable)
      .set({ usedAt: new Date(), usedBy: userId })
      .where(and(eq(workspaceInvitesTable.tokenHash, sha256(token)), isNull(workspaceInvitesTable.usedAt), gt(workspaceInvitesTable.expiresAt, new Date())))
      .returning({ workspaceId: workspaceInvitesTable.workspaceId, role: workspaceInvitesTable.role });
    if (!invite) throw new WorkspaceError("INVALID_INVITE");
    await tx.insert(workspaceMembersTable).values({ workspaceId: invite.workspaceId, userId, role: invite.role }).onConflictDoNothing();
    return invite.workspaceId;
  });
  if (sessionHash) await db.update(sessionsTable).set({ workspaceId }).where(eq(sessionsTable.id, sessionHash));
  return workspaceId;
}

export async function listClients(workspaceId: string) {
  const { db, clientsTable, mediaPlansTable } = await database();
  const rows = await db
    .select({ id: clientsTable.id, name: clientsTable.name, createdAt: clientsTable.createdAt, plans: sql<number>`count(${mediaPlansTable.id})::int` })
    .from(clientsTable)
    .leftJoin(mediaPlansTable, eq(mediaPlansTable.clientId, clientsTable.id))
    .where(eq(clientsTable.workspaceId, workspaceId))
    .groupBy(clientsTable.id)
    .orderBy(asc(sql`lower(${clientsTable.name})`));
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

/** Returns the client with this name (any letter case), creating it if the workspace has none. */
export async function ensureClient(db: Db, workspaceId: string, name: string) {
  const { clientsTable } = await database();
  const clean = cleanName(name);
  const existing = async () => (await db.select({ id: clientsTable.id, name: clientsTable.name }).from(clientsTable)
    .where(and(eq(clientsTable.workspaceId, workspaceId), sql`lower(${clientsTable.name}) = lower(${clean})`)))[0];
  const found = await existing();
  if (found) return found;
  const [{ total }] = await db.select({ total: count() }).from(clientsTable).where(eq(clientsTable.workspaceId, workspaceId));
  if (total >= MAX_CLIENTS) throw new WorkspaceError("TOO_MANY");
  // Two requests adding the same client at once: the unique index keeps one and the other reads it.
  await db.insert(clientsTable).values({ id: randomUUID(), workspaceId, name: clean }).onConflictDoNothing();
  return (await existing())!;
}

export async function createClient(workspaceId: string, name: string) {
  const { db } = await database();
  return ensureClient(db, workspaceId, name);
}

export async function renameClient(workspaceId: string, clientId: string, name: string) {
  const { db, clientsTable } = await database();
  const clean = cleanName(name);
  const [clash] = await db.select({ id: clientsTable.id }).from(clientsTable)
    .where(and(eq(clientsTable.workspaceId, workspaceId), ne(clientsTable.id, clientId), sql`lower(${clientsTable.name}) = lower(${clean})`));
  if (clash) throw new WorkspaceError("INVALID_NAME");
  const updated = await db.update(clientsTable).set({ name: clean })
    .where(and(eq(clientsTable.id, clientId), eq(clientsTable.workspaceId, workspaceId))).returning({ id: clientsTable.id, name: clientsTable.name });
  if (!updated.length) throw new WorkspaceError("NOT_FOUND");
  return updated[0];
}

/** Signed in and inside a workspace. */
export function requireWorkspace(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !req.workspace) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }
  next();
}

/** Viewers read; they cannot import, edit, connect or sync. */
export function requireEditor(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !req.workspace) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }
  if (req.workspace.role === "VIEWER") {
    res.status(403).json({ error: "READ_ONLY" });
    return;
  }
  next();
}

export function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !req.workspace) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }
  if (req.workspace.role !== "OWNER") {
    res.status(403).json({ error: "OWNER_ONLY" });
    return;
  }
  next();
}
