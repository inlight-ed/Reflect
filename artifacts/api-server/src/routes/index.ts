import { Router, type IRouter } from "express";
import healthRouter from "./health";
import shiftMarketRouter from "./shift-market";
import accountRouter from "./account";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accountRouter);
router.use(shiftMarketRouter);

export default router;
