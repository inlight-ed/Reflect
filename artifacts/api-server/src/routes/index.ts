import { Router, type IRouter } from "express";
import healthRouter from "./health";
import shiftMarketRouter from "./shift-market";
import accountRouter from "./account";
import mediaRouter from "./media";
import workspacesRouter from "./workspaces";
import { denyLimited } from "../lib/workspaces";

const router: IRouter = Router();

router.use(healthRouter);
// Workspace-wide data (orders, products, integrations, the assistant) is not split by client, so a
// person limited to some clients of an agency gets none of it; they work in media plans and clients.
router.use(["/data", "/feedback", "/content", "/integrations", "/shift-market"], denyLimited);
router.use(accountRouter);
router.use(workspacesRouter);
router.use(mediaRouter);
router.use(shiftMarketRouter);

export default router;
