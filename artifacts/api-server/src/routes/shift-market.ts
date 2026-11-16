import { Router, type IRouter } from "express";
import {
  AskAssistantBody,
  GetCardAnalysisQueryParams,
  GetCompetitorsQueryParams,
  GetCompetitorsResponse,
} from "@workspace/api-zod";
import {
  getAdvertising,
  getContent,
  getDashboard,
  getDemoCardAnalysis,
  getExternalMedia,
  getIntegrations,
  getProducts,
  parseCampaign,
  testKaspiConnection,
} from "../lib/shift-market";
import { CampaignValidationError } from "../lib/campaign-store";
import { userCardAnalysis } from "../lib/cards";
import { callMcpTool } from "../lib/integrations/mcp";
import { connectionViews } from "../lib/integrations/service";
import { getIntegration } from "../lib/integrations/store";
import { getCompetitorAnalysis, mcpRedstatConnector } from "../lib/redstat";
import { askAssistant } from "../lib/assistant";
import { createUserCampaign, parseCompare, parsePeriod, userAdvertising, userDashboard, userExternalMedia, userProducts } from "../lib/workspace";
import { rateLimit } from "../middlewares/rate-limit";

const router: IRouter = Router();

const writeLimit = rateLimit({ name: "write", windowMs: 60 * 60_000, max: 60 });
const askLimit = rateLimit({ name: "ask", windowMs: 60_000, max: 10, shared: true });
// Caps model spend: at most 150 questions a day from one address.
const askDailyLimit = rateLimit({ name: "ask-day", windowMs: 24 * 60 * 60_000, max: 150, shared: true });
const marketLimit = rateLimit({ name: "market", windowMs: 60_000, max: 20 });

router.get("/shift-market/dashboard", async (req, res) => {
  res.json(req.user ? await userDashboard(req.user.id, parsePeriod(req.query.period), parseCompare(req.query.compare)) : getDashboard());
});

router.get("/shift-market/advertising", async (req, res) => {
  res.json(req.user ? await userAdvertising(req.user.id, parsePeriod(req.query.period), parseCompare(req.query.compare)) : getAdvertising());
});

router.get("/shift-market/products", async (req, res) => {
  res.json(req.user ? await userProducts(req.user.id, parsePeriod(req.query.period), parseCompare(req.query.compare)) : getProducts());
});

router.get("/shift-market/external-media", async (req, res) => {
  res.json(req.user ? await userExternalMedia(req.user.id) : await getExternalMedia());
});

router.post("/shift-market/external-media/campaigns", writeLimit, async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }
  try {
    res.status(201).json(await createUserCampaign(req.user.id, parseCampaign(req.body)));
  } catch (error) {
    if (error instanceof CampaignValidationError || (error instanceof Error && (error.name === "ZodError" || error.message === "LIMIT"))) {
      res.status(400).json({ error: "INVALID_CAMPAIGN" });
      return;
    }
    throw error;
  }
});

router.get("/shift-market/competitors", marketLimit, async (req, res): Promise<void> => {
  const querySku = req.query.kaspiSku;
  if (typeof querySku !== "string") {
    res.status(400).json({ error: "INVALID_KASPI_SKU" });
    return;
  }
  const parsed = GetCompetitorsQueryParams.safeParse({ kaspiSku: querySku.trim() });
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_KASPI_SKU" });
    return;
  }
  if (req.user) {
    const redstat = await getIntegration(req.user.id, "REDSTAT_MCP");
    if (redstat?.url) {
      const connector = mcpRedstatConnector((tool, args) => callMcpTool(redstat.url!, redstat.secret, tool, args));
      res.json(GetCompetitorsResponse.parse(await getCompetitorAnalysis(parsed.data.kaspiSku, connector)));
      return;
    }
    const data = await getCompetitorAnalysis(parsed.data.kaspiSku);
    res.json(GetCompetitorsResponse.parse({ ...data, detail: "connector.redstat.connect_in_settings" }));
    return;
  }
  res.json(GetCompetitorsResponse.parse(await getCompetitorAnalysis(parsed.data.kaspiSku)));
});

router.get("/shift-market/content", (_req, res) => {
  res.json(getContent());
});

router.get("/content/analysis", marketLimit, async (req, res) => {
  const parsed = GetCardAnalysisQueryParams.safeParse(req.query);
  const sku = parsed.success ? parsed.data.sku : undefined;
  res.json(req.user ? await userCardAnalysis(req.user.id, sku) : getDemoCardAnalysis());
});

router.post("/shift-market/ask", askLimit, askDailyLimit, async (req, res): Promise<void> => {
  const parsed = AskAssistantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_QUESTION" });
    return;
  }
  res.json(await askAssistant(parsed.data.question.trim(), parsed.data.locale, req.user?.id));
});

router.get("/shift-market/integrations", async (req, res) => {
  const base = getIntegrations();
  res.json(req.user ? { ...base, connections: await connectionViews(req.user.id) } : base);
});

router.post("/shift-market/integrations/kaspi/test", writeLimit, (req, res) => {
  try {
    res.json(testKaspiConnection(req.body));
  } catch {
    res.status(400).json({ error: "INVALID_CONNECTOR_INPUT" });
  }
});

export default router;
