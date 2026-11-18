import { Router, type IRouter, type Response } from "express";
import {
  CreateCardEventBody,
  CreateFeedbackBody,
  ImportDataBody,
  LoginAccountBody,
  RequestPasswordResetBody,
  ResetPasswordBody,
  RegisterAccountBody,
  SaveConnectionBody,
  UpdateProductCostsBody,
} from "@workspace/api-zod";
import { listWorkspaces, requireEditor, requireWorkspace } from "../lib/workspaces";
import { AuthError, createSession, login, logout, register, requireUser, SESSION_COOKIE, setSessionCookie, logoutEverywhere } from "../lib/auth";
import { requestPasswordReset, resetPassword } from "../lib/password-reset";
import { HashingBusyError } from "../lib/security";
import { createCardEvent } from "../lib/cards";
import { hasDatabase } from "../lib/database";
import { CONNECTION_KINDS, ConnectionInputError, connectionViews, recentSyncRuns, removeConnection, saveConnection, startSync } from "../lib/integrations/service";
import type { IntegrationKind } from "../lib/integrations/store";
import { hasUserOrders, importAds, importOrders, importProducts, ImportValidationError, updateProductCosts } from "../lib/user-data";
import { createFeedback, dataStatus, listUserFeedback } from "../lib/workspace";
import { rateLimit } from "../middlewares/rate-limit";

const router: IRouter = Router();

const authLimit = rateLimit({ name: "auth", windowMs: 15 * 60_000, max: 20, shared: true });
const importLimit = rateLimit({ name: "import", windowMs: 60 * 60_000, max: 120, shared: true });
const resetLimit = rateLimit({ name: "password-reset", windowMs: 60 * 60_000, max: 10, shared: true });
const syncLimit = rateLimit({ name: "sync", windowMs: 60 * 60_000, max: 30, shared: true });

function authError(res: Response, error: unknown) {
  if (error instanceof HashingBusyError) {
    res.setHeader("Retry-After", 5);
    res.status(503).json({ error: "TEMPORARILY_UNAVAILABLE" });
    return;
  }
  if (!(error instanceof AuthError)) throw error;
  const status = error.code === "EMAIL_TAKEN" ? 409 : error.code === "INVALID_CREDENTIALS" ? 401 : error.code === "ACCOUNTS_UNAVAILABLE" ? 503 : error.code === "TOO_MANY_ATTEMPTS" ? 429 : 400;
  if (error.code === "TOO_MANY_ATTEMPTS") {
    res.setHeader("Retry-After", error.retryAfterSeconds ?? 900);
    res.status(status).json({ error: "RATE_LIMITED" });
    return;
  }
  res.status(status).json({ error: error.code });
}

router.post("/auth/register", authLimit, async (req, res) => {
  const parsed = RegisterAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.some((issue: { path: PropertyKey[] }) => issue.path[0] === "password") ? "WEAK_PASSWORD" : "INVALID_EMAIL" });
    return;
  }
  try {
    const { user, session } = await register(parsed.data.email, parsed.data.password, parsed.data.name);
    setSessionCookie(res, session.token, session.expiresAt);
    res.status(201).json(user);
  } catch (error) {
    authError(res, error);
  }
});

router.post("/auth/login", authLimit, async (req, res) => {
  const parsed = LoginAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(401).json({ error: "INVALID_CREDENTIALS" });
    return;
  }
  try {
    const { user, session } = await login(parsed.data.email, parsed.data.password);
    setSessionCookie(res, session.token, session.expiresAt);
    res.json(user);
  } catch (error) {
    authError(res, error);
  }
});

// Same answer whether or not the address has an account, so the form cannot be used to find users.
router.post("/auth/password-reset/request", resetLimit, async (req, res) => {
  const parsed = RequestPasswordResetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_EMAIL" });
    return;
  }
  try {
    await requestPasswordReset(parsed.data.email);
    res.status(202).json({ ok: true });
  } catch (error) {
    authError(res, error);
  }
});

router.post("/auth/password-reset", resetLimit, async (req, res) => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.some((issue: { path: PropertyKey[] }) => issue.path[0] === "password") ? "WEAK_PASSWORD" : "INVALID_RESET_LINK" });
    return;
  }
  try {
    const user = await resetPassword(parsed.data.token, parsed.data.password);
    const session = await createSession(user.id);
    setSessionCookie(res, session.token, session.expiresAt);
    res.json(user);
  } catch (error) {
    authError(res, error);
  }
});

router.post("/auth/logout", async (req, res) => {
  await logout(req.cookies?.[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).end();
});

router.post("/auth/logout-all", requireUser, async (req, res) => {
  await logoutEverywhere(req.user!.id);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).end();
});

router.get("/auth/me", async (req, res) => {
  if (!req.user) {
    res.json({ accountsEnabled: hasDatabase(), hasData: false });
    return;
  }
  const { clientIds, ...workspace } = req.workspace!;
  // Someone limited to some clients gets no word about the workspace's own orders or connections.
  const limited = clientIds !== null;
  const [status, connections, workspaces] = await Promise.all([
    limited ? undefined : dataStatus(workspace.id),
    limited ? Promise.resolve([] as Awaited<ReturnType<typeof connectionViews>>) : connectionViews(workspace.id),
    listWorkspaces(req.user.id),
  ]);
  res.json({
    user: req.user,
    workspace,
    workspaces,
    accountsEnabled: true,
    hasData: (status?.orders ?? 0) > 0,
    hasProducts: (status?.products ?? 0) > 0,
    hasConnections: connections.some((connection) => connection.status === "CONNECTED"),
  });
});

router.post("/data/import", requireEditor, importLimit, async (req, res) => {
  const parsed = ImportDataBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_IMPORT" });
    return;
  }
  const { kind, fileName = null, orders = [], products = [], ads = [] } = parsed.data;
  try {
    const result = kind === "ORDERS"
      ? await importOrders(req.workspace!.id, orders, "FILE", fileName)
      : kind === "PRODUCTS"
        ? await importProducts(req.workspace!.id, products, "FILE", fileName)
        : await importAds(req.workspace!.id, ads, "FILE", fileName);
    res.json(result);
  } catch (error) {
    if (error instanceof ImportValidationError) {
      res.status(400).json({ error: "NO_VALID_ROWS" });
      return;
    }
    throw error;
  }
});

router.put("/data/product-costs", requireEditor, importLimit, async (req, res) => {
  const parsed = UpdateProductCostsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_VALUES" });
    return;
  }
  await updateProductCosts(req.workspace!.id, parsed.data);
  res.json({ ok: true });
});

router.get("/data/status", requireWorkspace, async (req, res) => {
  res.json(await dataStatus(req.workspace!.id));
});

router.get("/feedback", requireWorkspace, async (req, res) => {
  res.json(await listUserFeedback(req.workspace!.id));
});

router.post("/feedback", requireEditor, importLimit, async (req, res) => {
  const parsed = CreateFeedbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_FEEDBACK" });
    return;
  }
  res.status(201).json(await createFeedback(req.workspace!.id, parsed.data));
});

router.post("/content/events", requireEditor, importLimit, async (req, res) => {
  const parsed = CreateCardEventBody.safeParse(req.body);
  if (!parsed.success || !(await hasUserOrders(req.workspace!.id))) {
    res.status(400).json({ error: "INVALID_EVENT" });
    return;
  }
  res.status(201).json(await createCardEvent(req.workspace!.id, parsed.data));
});

const kindOf = (value: unknown): IntegrationKind | undefined => (CONNECTION_KINDS.includes(value as IntegrationKind) ? (value as IntegrationKind) : undefined);

router.put("/integrations/:kind", requireEditor, syncLimit, async (req, res) => {
  const kind = kindOf(req.params.kind);
  const parsed = SaveConnectionBody.safeParse(req.body ?? {});
  if (!kind || !parsed.success) {
    res.status(400).json({ error: "INVALID_CONNECTION" });
    return;
  }
  try {
    res.json(await saveConnection(req.workspace!.id, kind, parsed.data));
  } catch (error) {
    if (error instanceof ConnectionInputError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.delete("/integrations/:kind", requireEditor, async (req, res) => {
  const kind = kindOf(req.params.kind);
  if (!kind) {
    res.status(400).json({ error: "INVALID_CONNECTION" });
    return;
  }
  await removeConnection(req.workspace!.id, kind);
  res.status(204).end();
});

router.get("/integrations/runs", requireWorkspace, async (req, res) => {
  res.json(await recentSyncRuns(req.workspace!.id));
});

router.post("/integrations/:kind/sync", requireEditor, syncLimit, async (req, res) => {
  const kind = kindOf(req.params.kind);
  if (!kind) {
    res.status(400).json({ error: "INVALID_CONNECTION" });
    return;
  }
  // Returns immediately with status SYNCING; the page polls the connection until it changes.
  res.json(await startSync(req.workspace!.id, kind));
});

export default router;
