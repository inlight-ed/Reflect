import { Router, type IRouter } from "express";
import { CreateMediaPlanBody, SaveMediaFactBody } from "@workspace/api-zod";
import { requireEditor, requireWorkspace } from "../lib/workspaces";
import { createMediaPlan, getMediaPlan, listMediaPlans, MediaPlanNotFound, saveMediaFact } from "../lib/media-plans";
import { rateLimit } from "../middlewares/rate-limit";

/** Media plans of the open workspace, grouped by client; the comparison covers this workspace's plans only. */
const router: IRouter = Router();
const writeLimit = rateLimit({ name: "media", windowMs: 60 * 60_000, max: 300, shared: true });

router.get("/media-plans", requireWorkspace, async (req, res) => {
  const clientId = typeof req.query.clientId === "string" && req.query.clientId.length <= 80 ? req.query.clientId : undefined;
  res.json(await listMediaPlans(req.workspace!.id, clientId));
});

router.post("/media-plans", requireEditor, writeLimit, async (req, res) => {
  const parsed = CreateMediaPlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_PLAN" });
    return;
  }
  res.status(201).json(await createMediaPlan(req.workspace!.id, parsed.data));
});

router.get("/media-plans/:planId", requireWorkspace, async (req, res) => {
  try {
    res.json(await getMediaPlan(req.workspace!.id, String(req.params.planId)));
  } catch (err) {
    if (err instanceof MediaPlanNotFound) { res.status(404).json({ error: "NOT_FOUND" }); return; }
    throw err;
  }
});

router.put("/media-plans/:planId/placements/:placementId/fact", requireEditor, writeLimit, async (req, res) => {
  const parsed = SaveMediaFactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_VALUES" });
    return;
  }
  try {
    res.json(await saveMediaFact(req.workspace!.id, String(req.params.planId), String(req.params.placementId), parsed.data));
  } catch (err) {
    if (err instanceof MediaPlanNotFound) { res.status(404).json({ error: "NOT_FOUND" }); return; }
    throw err;
  }
});

export default router;
