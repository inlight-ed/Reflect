import { Router, type IRouter, type Response } from "express";
import { CreateWorkspaceBody, CreateClientBody, RenameClientBody, RenameWorkspaceBody, CreateWorkspaceInviteBody, SetWorkspaceMemberRoleBody } from "@workspace/api-zod";
import { requireUser } from "../lib/auth";
import {
  acceptInvite,
  createClient,
  createInvite,
  createWorkspace,
  listClients,
  listMembers,
  listWorkspaces,
  previewInvite,
  removeMember,
  renameClient,
  renameWorkspace,
  requireEditor,
  requireOwner,
  requireWorkspace,
  setMemberRole,
  switchWorkspace,
  WorkspaceError,
} from "../lib/workspaces";
import { rateLimit } from "../middlewares/rate-limit";

/**
 * Workspaces, members, invitation links and clients. Owners manage people; members and owners
 * edit data; viewers only read. Nothing here deletes data: removing a member only takes away
 * access, and deleting workspaces or clients is left to the server administrator.
 */
const router: IRouter = Router();
const writeLimit = rateLimit({ name: "workspaces", windowMs: 60 * 60_000, max: 120, shared: true });
const inviteLimit = rateLimit({ name: "invites", windowMs: 15 * 60_000, max: 30, shared: true });

function workspaceError(res: Response, error: unknown) {
  if (!(error instanceof WorkspaceError)) throw error;
  const status = { NOT_FOUND: 404, FORBIDDEN: 403, INVALID_NAME: 400, TOO_MANY: 400, INVALID_INVITE: 404, LAST_OWNER: 409, NOT_AGENCY: 409 }[error.code];
  res.status(status).json({ error: error.code });
}

const current = async (userId: string, workspaceId: string) => (await listWorkspaces(userId)).find((item) => item.id === workspaceId)!;

router.get("/workspaces", requireUser, async (req, res) => {
  res.json(await listWorkspaces(req.user!.id));
});

router.post("/workspaces", requireUser, writeLimit, async (req, res) => {
  const parsed = CreateWorkspaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_NAME" });
    return;
  }
  try {
    const id = await createWorkspace(req.user!.id, parsed.data.kind, parsed.data.name, req.sessionHash);
    res.status(201).json(await current(req.user!.id, id));
  } catch (error) {
    workspaceError(res, error);
  }
});

router.post("/workspaces/:workspaceId/open", requireUser, async (req, res) => {
  try {
    const id = String(req.params.workspaceId);
    await switchWorkspace(req.user!.id, req.sessionHash!, id);
    res.json(await current(req.user!.id, id));
  } catch (error) {
    workspaceError(res, error);
  }
});

router.patch("/workspace", requireOwner, writeLimit, async (req, res) => {
  const parsed = RenameWorkspaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_NAME" });
    return;
  }
  try {
    await renameWorkspace(req.workspace!.id, parsed.data.name);
    res.json(await current(req.user!.id, req.workspace!.id));
  } catch (error) {
    workspaceError(res, error);
  }
});

router.get("/workspace/members", requireWorkspace, async (req, res) => {
  res.json(await listMembers(req.workspace!.id));
});

router.put("/workspace/members/:userId", requireOwner, writeLimit, async (req, res) => {
  const parsed = SetWorkspaceMemberRoleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_ROLE" });
    return;
  }
  try {
    await setMemberRole(req.workspace!.id, String(req.params.userId), parsed.data.role);
    res.status(204).end();
  } catch (error) {
    workspaceError(res, error);
  }
});

/** An owner removes anyone; anyone can leave. */
router.delete("/workspace/members/:userId", requireWorkspace, writeLimit, async (req, res) => {
  const target = String(req.params.userId);
  if (target !== req.user!.id && req.workspace!.role !== "OWNER") {
    res.status(403).json({ error: "OWNER_ONLY" });
    return;
  }
  try {
    await removeMember(req.workspace!.id, target);
    res.status(204).end();
  } catch (error) {
    workspaceError(res, error);
  }
});

router.post("/workspace/invites", requireOwner, inviteLimit, async (req, res) => {
  const parsed = CreateWorkspaceInviteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_ROLE" });
    return;
  }
  try {
    res.status(201).json(await createInvite(req.workspace!.id, req.user!.id, parsed.data.role));
  } catch (error) {
    workspaceError(res, error);
  }
});

router.get("/invites/:token", inviteLimit, async (req, res) => {
  try {
    res.json(await previewInvite(String(req.params.token)));
  } catch (error) {
    workspaceError(res, error);
  }
});

router.post("/invites/:token/accept", requireUser, inviteLimit, async (req, res) => {
  try {
    const id = await acceptInvite(String(req.params.token), req.user!.id, req.sessionHash);
    res.json(await current(req.user!.id, id));
  } catch (error) {
    workspaceError(res, error);
  }
});

router.get("/clients", requireWorkspace, async (req, res) => {
  res.json(await listClients(req.workspace!.id));
});

router.post("/clients", requireEditor, writeLimit, async (req, res) => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_NAME" });
    return;
  }
  try {
    const { id } = await createClient(req.workspace!.id, parsed.data.name);
    res.status(201).json((await listClients(req.workspace!.id)).find((client) => client.id === id));
  } catch (error) {
    workspaceError(res, error);
  }
});

router.patch("/clients/:clientId", requireEditor, writeLimit, async (req, res) => {
  const parsed = RenameClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_NAME" });
    return;
  }
  try {
    const { id } = await renameClient(req.workspace!.id, String(req.params.clientId), parsed.data.name);
    res.json((await listClients(req.workspace!.id)).find((client) => client.id === id));
  } catch (error) {
    workspaceError(res, error);
  }
});

export default router;
