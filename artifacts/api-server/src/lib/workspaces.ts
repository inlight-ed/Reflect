import { and, asc, count, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
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
/** `restricted`: the person sees only the agency clients assigned to them (see ClientScope). */
export type CurrentWorkspace = { id: string; kind: WorkspaceKind; name: string; role: WorkspaceRole; restricted: boolean };
/**
 * Which clients a person may see in the open workspace: `null` means all of them, a list means only
 * those (an empty list means none). Owners and unrestricted members always have `null`.
 */
export type ClientScope = string[] | null;
export type WorkspaceAccess = CurrentWorkspace & { clientIds: ClientScope };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      workspace?: WorkspaceAccess;
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
  constructor(public code: "NOT_FOUND" | "FORBIDDEN" | "INVALID_NAME" | "TOO_MANY" | "INVALID_INVITE" | "LAST_OWNER" | "NOT_AGENCY" | "INVALID_SCOPE") {
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
    .select({ id: workspacesTable.id, kind: workspacesTable.kind, name: workspacesTable.name, role: workspaceMembersTable.role, allClients: workspaceMembersTable.allClients })
    .from(workspaceMembersTable)
    .innerJoin(workspacesTable, eq(workspacesTable.id, workspaceMembersTable.workspaceId))
    .where(eq(workspaceMembersTable.userId, userId))
    .orderBy(asc(workspaceMembersTable.createdAt), asc(workspacesTable.name));
  return rows.map(({ allClients, ...row }) => ({ ...row, restricted: !allClients })) as CurrentWorkspace[];
}

/** The clients a limited member was given. Empty for someone who sees everything. */
export async function memberClientIds(workspaceId: string, userId: string): Promise<string[]> {
  const { db, workspaceMemberClientsTable } = await database();
  const rows = await db.select({ clientId: workspaceMemberClientsTable.clientId }).from(workspaceMemberClientsTable)
    .where(and(eq(workspaceMemberClientsTable.workspaceId, workspaceId), eq(workspaceMemberClientsTable.userId, userId)));
  return rows.map((row) => row.clientId);
}

const withScope = async (userId: string, workspace: CurrentWorkspace): Promise<WorkspaceAccess> =>
  ({ ...workspace, clientIds: workspace.restricted ? await memberClientIds(workspace.id, userId) : null });

/**
 * The workspace this request works in: the one the session remembers if the person is still a
 * member, otherwise their first one. Someone who left every workspace gets a fresh shop, so a
 * signed-in person always has somewhere to work.
 */
export async function resolveWorkspace(userId: string, remembered: string | null, fallbackName: string): Promise<WorkspaceAccess> {
  const all = await listWorkspaces(userId);
  const found = all.find((item) => item.id === remembered) ?? all[0];
  if (found) return withScope(userId, found);
  const { db } = await database();
  const id = await db.transaction((tx) => insertWorkspace(tx, userId, "SHOP", fallbackName));
  return { id, kind: "SHOP", name: cleanName(fallbackName), role: "OWNER", restricted: false, clientIds: null };
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

/**
 * Members of the workspace with the clients each can see (`clientIds: null` = all). A limited member
 * gets only their own row: other people's emails are not theirs to see.
 */
export async function listMembers(workspaceId: string, only?: string) {
  const { db, usersTable, workspaceMembersTable, workspaceMemberClientsTable } = await database();
  const rows = await db
    .select({ userId: usersTable.id, email: usersTable.email, name: usersTable.name, role: workspaceMembersTable.role, allClients: workspaceMembersTable.allClients, joinedAt: workspaceMembersTable.createdAt })
    .from(workspaceMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, workspaceMembersTable.userId))
    .where(and(eq(workspaceMembersTable.workspaceId, workspaceId), only ? eq(workspaceMembersTable.userId, only) : undefined))
    .orderBy(asc(workspaceMembersTable.createdAt));
  const given = await db.select().from(workspaceMemberClientsTable).where(eq(workspaceMemberClientsTable.workspaceId, workspaceId));
  return rows.map(({ allClients, ...row }) => ({
    ...row,
    role: row.role as WorkspaceRole,
    clientIds: allClients ? null : given.filter((item) => item.userId === row.userId).map((item) => item.clientId),
    joinedAt: row.joinedAt.toISOString(),
  }));
}

async function ownerCount(db: Db, workspaceId: string) {
  const { workspaceMembersTable } = await database();
  const [{ owners }] = await db.select({ owners: count() }).from(workspaceMembersTable)
    .where(and(eq(workspaceMembersTable.workspaceId, workspaceId), eq(workspaceMembersTable.role, "OWNER")));
  return owners;
}

/** Changes a member's role. A workspace always keeps at least one owner. */
export async function setMemberRole(workspaceId: string, userId: string, role: WorkspaceRole) {
  const { db, workspaceMembersTable, workspaceMemberClientsTable } = await database();
  await db.transaction(async (tx) => {
    // Lock the workspace's member rows so two owners demoting each other cannot leave none.
    const members = await tx.select().from(workspaceMembersTable).where(eq(workspaceMembersTable.workspaceId, workspaceId)).for("update");
    const target = members.find((member) => member.userId === userId);
    if (!target) throw new WorkspaceError("NOT_FOUND");
    if (target.role === "OWNER" && role !== "OWNER" && (await ownerCount(tx, workspaceId)) <= 1) throw new WorkspaceError("LAST_OWNER");
    // An owner always sees every client: promoting someone lifts their limit.
    const lift = role === "OWNER" ? { allClients: true } : {};
    await tx.update(workspaceMembersTable).set({ role, ...lift }).where(and(eq(workspaceMembersTable.workspaceId, workspaceId), eq(workspaceMembersTable.userId, userId)));
    if (role === "OWNER") await tx.delete(workspaceMemberClientsTable).where(and(eq(workspaceMemberClientsTable.workspaceId, workspaceId), eq(workspaceMemberClientsTable.userId, userId)));
  });
}

/**
 * Limits a member to the given clients of an agency, or (`null`) gives them all clients again.
 * Owners cannot be limited. A new client is never added to a limited member automatically.
 */
export async function setMemberClients(workspaceId: string, userId: string, clientIds: string[] | null) {
  const { db, workspacesTable, workspaceMembersTable, workspaceMemberClientsTable } = await database();
  const wanted = clientIds === null ? null : [...new Set(clientIds)];
  await db.transaction(async (tx) => {
    const members = await tx.select().from(workspaceMembersTable).where(eq(workspaceMembersTable.workspaceId, workspaceId)).for("update");
    const target = members.find((member) => member.userId === userId);
    if (!target) throw new WorkspaceError("NOT_FOUND");
    if (wanted !== null) {
      if (target.role === "OWNER") throw new WorkspaceError("INVALID_SCOPE");
      const [workspace] = await tx.select({ kind: workspacesTable.kind }).from(workspacesTable).where(eq(workspacesTable.id, workspaceId));
      if (workspace?.kind !== "AGENCY") throw new WorkspaceError("NOT_AGENCY");
      await assertClientsExist(tx, workspaceId, wanted);
    }
    await tx.update(workspaceMembersTable).set({ allClients: wanted === null })
      .where(and(eq(workspaceMembersTable.workspaceId, workspaceId), eq(workspaceMembersTable.userId, userId)));
    await tx.delete(workspaceMemberClientsTable).where(and(eq(workspaceMemberClientsTable.workspaceId, workspaceId), eq(workspaceMemberClientsTable.userId, userId)));
    if (wanted?.length) await tx.insert(workspaceMemberClientsTable).values(wanted.map((clientId) => ({ workspaceId, userId, clientId })));
  });
}

/** Every id must be a client of this workspace; otherwise a link could hand out another agency's client. */
async function assertClientsExist(db: Db, workspaceId: string, clientIds: string[]) {
  if (!clientIds.length) return;
  const { clientsTable } = await database();
  const found = await db.select({ id: clientsTable.id }).from(clientsTable)
    .where(and(eq(clientsTable.workspaceId, workspaceId), inArray(clientsTable.id, clientIds)));
  if (found.length !== clientIds.length) throw new WorkspaceError("INVALID_SCOPE");
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

/**
 * `clientIds` limits what the invited person sees to those clients of an agency; leave it out for
 * full access. Owners cannot be limited.
 */
export async function createInvite(workspaceId: string, createdBy: string, role: WorkspaceRole, clientIds?: string[] | null) {
  const { db, workspaceInvitesTable, workspaceInviteClientsTable, workspacesTable } = await database();
  const wanted = clientIds == null ? null : [...new Set(clientIds)];
  if (wanted !== null) {
    if (role === "OWNER") throw new WorkspaceError("INVALID_SCOPE");
    const [workspace] = await db.select({ kind: workspacesTable.kind }).from(workspacesTable).where(eq(workspacesTable.id, workspaceId));
    if (workspace?.kind !== "AGENCY") throw new WorkspaceError("NOT_AGENCY");
    await assertClientsExist(db, workspaceId, wanted);
  }
  const [{ open }] = await db.select({ open: count() }).from(workspaceInvitesTable)
    .where(and(eq(workspaceInvitesTable.workspaceId, workspaceId), isNull(workspaceInvitesTable.usedAt), gt(workspaceInvitesTable.expiresAt, new Date())));
  if (open >= 50) throw new WorkspaceError("TOO_MANY");
  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  const tokenHash = sha256(token);
  await db.transaction(async (tx) => {
    await tx.insert(workspaceInvitesTable).values({ tokenHash, workspaceId, role, createdBy, expiresAt, allClients: wanted === null });
    if (wanted?.length) await tx.insert(workspaceInviteClientsTable).values(wanted.map((clientId) => ({ tokenHash, clientId })));
  });
  return { token, role, expiresAt: expiresAt.toISOString(), clientIds: wanted };
}

/** What an invitation link opens, shown before the person accepts it. */
export async function previewInvite(token: string) {
  const { db, workspaceInvitesTable, workspacesTable } = await database();
  const [row] = await db
    .select({ name: workspacesTable.name, kind: workspacesTable.kind, role: workspaceInvitesTable.role, allClients: workspaceInvitesTable.allClients })
    .from(workspaceInvitesTable)
    .innerJoin(workspacesTable, eq(workspacesTable.id, workspaceInvitesTable.workspaceId))
    .where(and(eq(workspaceInvitesTable.tokenHash, sha256(token)), isNull(workspaceInvitesTable.usedAt), gt(workspaceInvitesTable.expiresAt, new Date())));
  if (!row) throw new WorkspaceError("INVALID_INVITE");
  return { name: row.name, kind: row.kind as WorkspaceKind, role: row.role as WorkspaceRole, restricted: !row.allClients };
}

/**
 * Accepting a link adds the person to the workspace and opens it. The link is used up in the same
 * statement that checks it, so it works exactly once. Someone who is already a member keeps the
 * role and the clients they have. A limited invitation gives only the clients it names.
 */
export async function acceptInvite(token: string, userId: string, sessionHash?: string) {
  const { db, workspaceInvitesTable, workspaceInviteClientsTable, workspaceMembersTable, workspaceMemberClientsTable, clientsTable, sessionsTable } = await database();
  const workspaceId = await db.transaction(async (tx) => {
    const [invite] = await tx.update(workspaceInvitesTable)
      .set({ usedAt: new Date(), usedBy: userId })
      .where(and(eq(workspaceInvitesTable.tokenHash, sha256(token)), isNull(workspaceInvitesTable.usedAt), gt(workspaceInvitesTable.expiresAt, new Date())))
      .returning({ workspaceId: workspaceInvitesTable.workspaceId, role: workspaceInvitesTable.role, allClients: workspaceInvitesTable.allClients });
    if (!invite) throw new WorkspaceError("INVALID_INVITE");
    const added = await tx.insert(workspaceMembersTable)
      .values({ workspaceId: invite.workspaceId, userId, role: invite.role, allClients: invite.allClients })
      .onConflictDoNothing().returning({ userId: workspaceMembersTable.userId });
    if (added.length && !invite.allClients) {
      const named = await tx.select({ clientId: workspaceInviteClientsTable.clientId }).from(workspaceInviteClientsTable)
        .innerJoin(clientsTable, eq(clientsTable.id, workspaceInviteClientsTable.clientId))
        .where(and(eq(workspaceInviteClientsTable.tokenHash, sha256(token)), eq(clientsTable.workspaceId, invite.workspaceId)));
      if (named.length) await tx.insert(workspaceMemberClientsTable).values(named.map(({ clientId }) => ({ workspaceId: invite.workspaceId, userId, clientId })));
    }
    return invite.workspaceId;
  });
  if (sessionHash) await db.update(sessionsTable).set({ workspaceId }).where(eq(sessionsTable.id, sessionHash));
  return workspaceId;
}

export async function listClients(workspaceId: string, scope: ClientScope = null) {
  const { db, clientsTable, mediaPlansTable } = await database();
  if (scope && !scope.length) return [];
  const rows = await db
    .select({ id: clientsTable.id, name: clientsTable.name, createdAt: clientsTable.createdAt, plans: sql<number>`count(${mediaPlansTable.id})::int` })
    .from(clientsTable)
    .leftJoin(mediaPlansTable, eq(mediaPlansTable.clientId, clientsTable.id))
    .where(and(eq(clientsTable.workspaceId, workspaceId), scope ? inArray(clientsTable.id, scope) : undefined))
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

/**
 * Changes that are not tied to one client (adding or renaming clients): only people who see every
 * client. A limited member works inside the clients they were given.
 */
export function requireAllClients(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !req.workspace) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }
  if (req.workspace.role === "VIEWER") {
    res.status(403).json({ error: "READ_ONLY" });
    return;
  }
  if (req.workspace.clientIds !== null) {
    res.status(403).json({ error: "LIMITED_ACCESS" });
    return;
  }
  next();
}

/**
 * Workspace-wide data that belongs to no client (orders, products, integrations, the assistant).
 * Someone limited to some clients does not get it.
 */
export function denyLimited(req: Request, res: Response, next: NextFunction) {
  if (req.workspace?.clientIds != null) {
    res.status(403).json({ error: "LIMITED_ACCESS" });
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
