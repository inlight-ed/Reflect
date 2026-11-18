import { Router, type IRouter } from "express";
import { CreateMediaPlanBody, SaveMediaFactBody } from "@workspace/api-zod";
import { requireUser } from "../lib/auth";
import { createMediaPlan, getMediaPlan, listMediaPlans, MediaPlanNotFound, saveMediaFact } from "../lib/media-plans";
import { rateLimit } from "../middlewares/rate-limit";

/** Agency media plans: each seller account sees only its own plans; the comparison covers its plans only. */
const router: IRouter = Router();
const writeLimit = rateLimit({ name: "media", windowMs: 60 * 60_000, max: 300, shared: true });

router.get("/media-plans", requireUser, async (req, res) => {
  res.json(await listMediaPlans(req.user!.id));
});

router.post("/media-plans", requireUser, writeLimit, async (req, res) => {
  const parsed = CreateMediaPlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_PLAN" });
    return;
  }
  res.status(201).json(await createMediaPlan(req.user!.id, parsed.data));
});

router.get("/media-plans/:planId", requireUser, async (req, res) => {
  try {
    res.json(await getMediaPlan(req.user!.id, String(req.params.planId)));
  } catch (err) {
    if (err instanceof MediaPlanNotFound) { res.status(404).json({ error: "NOT_FOUND" }); return; }
    throw err;
  }
});

router.put("/media-plans/:planId/placements/:placementId/fact", requireUser, writeLimit, async (req, res) => {
  const parsed = SaveMediaFactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_VALUES" });
    return;
  }
  try {
    res.json(await saveMediaFact(req.user!.id, String(req.params.planId), String(req.params.placementId), parsed.data));
  } catch (err) {
    if (err instanceof MediaPlanNotFound) { res.status(404).json({ error: "NOT_FOUND" }); return; }
    throw err;
  }
});

export default router;
