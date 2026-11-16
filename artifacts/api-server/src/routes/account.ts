import { Router, type IRouter, type Response } from "express";
import {
  CreateCardEventBody,
  CreateFeedbackBody,
  ImportDataBody,
  LoginAccountBody,
  RegisterAccountBody,
  SaveConnectionBody,
} from "@workspace/api-zod";
import { AuthError, login, logout, register, requireUser, SESSION_COOKIE, setSessionCookie, logoutEverywhere } from "../lib/auth";
import { createCardEvent } from "../lib/cards";
import { hasDatabase } from "../lib/database";
import { CONNECTION_KINDS, ConnectionInputError, connectionViews, recentSyncRuns, removeConnection, saveConnection, startSync } from "../lib/integrations/service";
import type { IntegrationKind } from "../lib/integrations/store";
import { hasUserOrders, importAds, importOrders, importProducts, ImportValidationError } from "../lib/user-data";
import { createFeedback, dataStatus, listUserFeedback } from "../lib/workspace";
import { rateLimit } from "../middlewares/rate-limit";

const router: IRouter = Router();

const authLimit = rateLimit({ name: "auth", windowMs: 15 * 60_000, max: 20, shared: true });
const importLimit = rateLimit({ name: "import", windowMs: 60 * 60_000, max: 120, shared: true });
const syncLimit = rateLimit({ name: "sync", windowMs: 60 * 60_000, max: 30, shared: true });

function authError(res: Response, error: unknown) {
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
    res.status(400).json({ error: parsed.error.issues.some((issue) => issue.path[0] === "password") ? "WEAK_PASSWORD" : "INVALID_EMAIL" });
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
  const status = await dataStatus(req.user.id);
  const connections = await connectionViews(req.user.id);
  res.json({
    user: req.user,
    accountsEnabled: true,
    hasData: status.orders > 0,
    hasProducts: status.products > 0,
    hasConnections: connections.some((connection) => connection.status === "CONNECTED"),
  });
});

router.post("/data/import", requireUser, importLimit, async (req, res) => {
  const parsed = ImportDataBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_IMPORT" });
    return;
  }
  const { kind, fileName = null, orders = [], products = [], ads = [] } = parsed.data;
  try {
    const result = kind === "ORDERS"
      ? await importOrders(req.user!.id, orders, "FILE", fileName)
      : kind === "PRODUCTS"
        ? await importProducts(req.user!.id, products, "FILE", fileName)
        : await importAds(req.user!.id, ads, "FILE", fileName);
    res.json(result);
  } catch (error) {
    if (error instanceof ImportValidationError) {
      res.status(400).json({ error: "NO_VALID_ROWS" });
      return;
    }
    throw error;
  }
});

router.get("/data/status", requireUser, async (req, res) => {
  res.json(await dataStatus(req.user!.id));
});

router.get("/feedback", requireUser, async (req, res) => {
  res.json(await listUserFeedback(req.user!.id));
});

router.post("/feedback", requireUser, importLimit, async (req, res) => {
  const parsed = CreateFeedbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_FEEDBACK" });
    return;
  }
  res.status(201).json(await createFeedback(req.user!.id, parsed.data));
});

router.post("/content/events", requireUser, importLimit, async (req, res) => {
  const parsed = CreateCardEventBody.safeParse(req.body);
  if (!parsed.success || !(await hasUserOrders(req.user!.id))) {
    res.status(400).json({ error: "INVALID_EVENT" });
    return;
  }
  res.status(201).json(await createCardEvent(req.user!.id, parsed.data));
});

const kindOf = (value: unknown): IntegrationKind | undefined => (CONNECTION_KINDS.includes(value as IntegrationKind) ? (value as IntegrationKind) : undefined);

router.put("/integrations/:kind", requireUser, syncLimit, async (req, res) => {
  const kind = kindOf(req.params.kind);
  const parsed = SaveConnectionBody.safeParse(req.body ?? {});
  if (!kind || !parsed.success) {
    res.status(400).json({ error: "INVALID_CONNECTION" });
    return;
  }
  try {
    res.json(await saveConnection(req.user!.id, kind, parsed.data));
  } catch (error) {
    if (error instanceof ConnectionInputError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.delete("/integrations/:kind", requireUser, async (req, res) => {
  const kind = kindOf(req.params.kind);
  if (!kind) {
    res.status(400).json({ error: "INVALID_CONNECTION" });
    return;
  }
  await removeConnection(req.user!.id, kind);
  res.status(204).end();
});

router.get("/integrations/runs", requireUser, async (req, res) => {
  res.json(await recentSyncRuns(req.user!.id));
});

router.post("/integrations/:kind/sync", requireUser, syncLimit, async (req, res) => {
  const kind = kindOf(req.params.kind);
  if (!kind) {
    res.status(400).json({ error: "INVALID_CONNECTION" });
    return;
  }
  // Returns immediately with status SYNCING; the page polls the connection until it changes.
  res.json(await startSync(req.user!.id, kind));
});

export default router;
