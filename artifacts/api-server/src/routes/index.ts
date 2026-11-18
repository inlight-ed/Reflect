import { Router, type IRouter } from "express";
import healthRouter from "./health";
import shiftMarketRouter from "./shift-market";
import accountRouter from "./account";
import mediaRouter from "./media";
import workspacesRouter from "./workspaces";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accountRouter);
router.use(workspacesRouter);
router.use(mediaRouter);
router.use(shiftMarketRouter);

export default router;
