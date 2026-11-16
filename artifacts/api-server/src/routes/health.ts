import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { database, hasDatabase } from "../lib/database";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/** Readiness for container health checks: the process is up and the database answers. */
router.get("/readyz", async (_req, res) => {
  if (!hasDatabase()) {
    res.json({ status: "ok", database: "none" });
    return;
  }
  try {
    const { db } = await database();
    await db.execute(sql`select 1`);
    res.json({ status: "ok", database: "ok" });
  } catch {
    res.status(503).json({ status: "unavailable", database: "error" });
  }
});

export default router;
