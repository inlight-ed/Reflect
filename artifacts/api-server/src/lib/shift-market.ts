import {
  CreateExternalCampaignBody,
  TestKaspiConnectionBody,
} from "@workspace/api-zod";
import type { SourceMessageKey } from "@workspace/api-zod";
import { demoDay, demoRefreshedAt, demoTimestamp, demoToday } from "./demo-clock";
import { accountTotals, demoProducts as products, findDemoProduct } from "./demo-products";
import { defendSignals, fixSignals, placementSignals, scaleSignals, scoreConfidence } from "./confidence";
import { validateCampaign } from "./campaign-store";

type PlacementStatus = "SCALE" | "KEEP" | "OPTIMIZE" | "REDUCE" | "STOP";

export type RecommendationInput = {
  spend: number;
  revenue: number;
  roas: number;
  ctr: number;
  cpc: number;
  cvr: number;
  cpo: number;
  benchmarkRoas: number;
  competitorPressure: "LOW" | "MEDIUM" | "HIGH";
  stock: number;
};

export type Recommendation = {
  type: PlacementStatus;
  reason: string;
  recommendation: string;
  confidence: number;
  estimatedImpact?: number;
};

const safeDivide = (numerator: number, denominator: number) =>
  denominator > 0 ? numerator / denominator : 0;

export function recommendationEngine(input: RecommendationInput): Recommendation {
  if (input.stock <= 10) {
    return {
      type: "STOP",
      reason: "Stock cover is too low to safely buy more demand.",
      recommendation: "Pause incremental spend until replenishment is confirmed.",
      confidence: 91,
      estimatedImpact: 0,
    };
  }

  if (input.roas >= input.benchmarkRoas * 1.18 && input.cvr >= 0.045) {
    return {
      type: "SCALE",
      reason: "ROAS and conversion are both above the placement benchmark.",
      recommendation: "Increase coverage for the highest-converting SKUs first.",
      confidence: 84,
      estimatedImpact: Math.round(input.revenue * 0.08),
    };
  }

  if (input.competitorPressure === "HIGH" || input.cpc > 230) {
    return {
      type: "REDUCE",
      reason: "Auction cost or competitive pressure is eroding efficiency.",
      recommendation: "Reduce bids on vulnerable SKUs and protect price competitiveness.",
      confidence: 78,
      estimatedImpact: Math.round(input.spend * 0.12),
    };
  }

  if (input.roas < input.benchmarkRoas * 0.86 || input.cvr < 0.028) {
    return {
      type: "OPTIMIZE",
      reason: "Efficiency is below the synthetic account benchmark.",
      recommendation: "Refine targeting and move spend toward proven demand pockets.",
      confidence: 73,
      estimatedImpact: Math.round(input.revenue * 0.05),
    };
  }

  return {
    type: "KEEP",
    reason: "Performance is within the expected benchmark range.",
    recommendation: "Keep the current mix and monitor the next sync.",
    confidence: 69,
  };
}

const source = "DEMO DATA" as const;

const sourceMessageKeys = {
  kaspiNotConnected: "connector.kaspi.not_connected",
  kaspiComingSoon: "connector.kaspi.coming_soon",
  demoActive: "connector.demo.active",
  redstatMethodsUnconfirmed: "connector.redstat.methods_unconfirmed",
  kaspiDemoEndpointUnconfigured: "connector.kaspi.demo_endpoint_unconfigured",
  kaspiTokenRequired: "connector.kaspi.token_required",
} as const satisfies Record<string, SourceMessageKey>;

/**
 * Kaspi Ads placements, derived from the catalogue so ad orders and revenue stay below the store's
 * own totals: ads bring AD_ORDER_SHARE of orders at the store's average order value. Each placement
 * keeps its own efficiency profile (ROAS, CTR, CVR), which is what the recommendations read.
 */
const AD_ORDER_SHARE = 0.6;
const placementProfiles = [
  { name: "Search", orderShare: 0.46, roas: 4.32, ctr: 0.058, cvr: 0.021, benchmarkRoas: 3.65, pressure: "LOW" as const, stock: 128 },
  { name: "Catalog", orderShare: 0.3, roas: 3.7, ctr: 0.038, cvr: 0.0264, benchmarkRoas: 3.45, pressure: "LOW" as const, stock: 94 },
  { name: "Recommendations", orderShare: 0.16, roas: 2.97, ctr: 0.027, cvr: 0.0244, benchmarkRoas: 3.15, pressure: "MEDIUM" as const, stock: 73 },
  { name: "Competitor cards", orderShare: 0.08, roas: 2.56, ctr: 0.018, cvr: 0.0183, benchmarkRoas: 2.95, pressure: "HIGH" as const, stock: 48 },
];
const averageOrderValue = accountTotals.revenue / accountTotals.orders;
const placementSeeds = placementProfiles.map(({ orderShare, roas, ctr, cvr, ...profile }) => {
  const orders = Math.round(accountTotals.orders * AD_ORDER_SHARE * orderShare);
  const revenue = Math.round(orders * averageOrderValue);
  const clicks = Math.round(orders / cvr);
  return { ...profile, orders, revenue, spend: Math.round(revenue / roas), clicks, impressions: Math.round(clicks / ctr) };
});

const correctedPlacementSeeds = placementSeeds;

const placements = correctedPlacementSeeds.map((placement) => {
  const ctr = safeDivide(placement.clicks, placement.impressions);
  const cpc = safeDivide(placement.spend, placement.clicks);
  const cvr = safeDivide(placement.orders, placement.clicks);
  const cpo = safeDivide(placement.spend, placement.orders);
  const roas = safeDivide(placement.revenue, placement.spend);
  const recommendation = recommendationEngine({
    spend: placement.spend,
    revenue: placement.revenue,
    roas,
    ctr,
    cpc,
    cvr,
    cpo,
    benchmarkRoas: placement.benchmarkRoas,
    competitorPressure: placement.pressure,
    stock: placement.stock,
  });
  return {
    name: placement.name,
    spend: placement.spend,
    revenue: placement.revenue,
    ctr,
    cpc,
    cvr,
    roas,
    status: recommendation.type,
    recommendation: recommendation.recommendation,
  };
});

const authoredTimeline = [
  { id: "e1", date: "2026-08-10T09:00:00+05:00", label: "Meta Campaign START", kind: "MEDIA" as const, detail: "Beauty audience / ₸150K budget" },
  { id: "e2", date: "2026-08-12T09:00:00+05:00", label: "Price -5%", kind: "PRICE" as const, detail: "Avène XeraCalm A.D липидовосполняющий крем 200 мл" },
  { id: "e3", date: "2026-08-15T09:00:00+05:00", label: "Kaspi Ads budget +30%", kind: "ADS" as const, detail: "Search placement" },
  { id: "e4", date: "2026-08-17T09:00:00+05:00", label: "Competitor X price -10%", kind: "COMPETITOR" as const, detail: "La Roche-Posay Anthelios UVmune 400 флюид SPF 50+ 50 мл" },
  { id: "e5", date: "2026-08-17T15:00:00+05:00", label: "New Creative", kind: "CONTENT" as const, detail: "Maybelline Lash Sensational Sky High тушь, чёрная" },
  { id: "e6", date: "2026-08-18T08:00:00+05:00", label: "Promo window", kind: "PROMO" as const, detail: "Weekend skincare offer" },
];

const timeline = () => authoredTimeline.map((event) => ({ ...event, date: demoTimestamp(event.date) })).sort((a, b) => b.date.localeCompare(a.date));

const compactMoney = (value: number) =>
  value >= 1_000_000 ? `₸${(value / 1_000_000).toFixed(2)}M` : value >= 1_000 ? `₸${(value / 1_000).toFixed(1)}K` : `₸${Math.round(value)}`;

const adTotals = (() => {
  const spend = placementSeeds.reduce((sum, item) => sum + item.spend, 0);
  const revenue = placementSeeds.reduce((sum, item) => sum + item.revenue, 0);
  const clicks = placementSeeds.reduce((sum, item) => sum + item.clicks, 0);
  const impressions = placementSeeds.reduce((sum, item) => sum + item.impressions, 0);
  const orders = placementSeeds.reduce((sum, item) => sum + item.orders, 0);
  return { spend, revenue, clicks, impressions, orders, roas: revenue / spend, cpc: spend / clicks, ctr: clicks / impressions, cvr: orders / clicks, cpo: spend / orders };
})();

function dashboardActions() {
  const hero = findDemoProduct("Avène XeraCalm A.D липидовосполняющий крем 200 мл");
  const sunscreen = findDemoProduct("La Roche-Posay Anthelios UVmune 400 флюид SPF 50+ 50 мл");
  const mascara = findDemoProduct("Maybelline Lash Sensational Sky High тушь, чёрная");
  const searchSeed = placementSeeds[0];
  const search = placements[0];
  return [
    { type: "SCALE" as const, object: hero.name, signal: `ROAS ${hero.roas}x`, explanation: "High conversion with available stock and rising organic demand.", recommendation: "Increase ad coverage on Search.", impact: "+₸95K / month", ...scoreConfidence(scaleSignals(hero)) },
    { type: "OPTIMIZE" as const, object: "Search placement", signal: `ROAS ${search.roas.toFixed(2)}x`, explanation: "Most efficient placement, but bids are paying a premium.", recommendation: "Tighten bids for the top 6 SKUs.", impact: "+8–12% revenue", ...scoreConfidence(placementSignals({ roas: search.roas, cpc: search.cpc, ctr: search.ctr, benchmarkRoas: searchSeed.benchmarkRoas, pressure: searchSeed.pressure }, adTotals)) },
    { type: "DEFEND" as const, object: sunscreen.name, signal: "Competitor price -10%", explanation: "Price pressure is rising while the product still converts above account average.", recommendation: "Protect price competitiveness before scaling CPC.", impact: "Protect ₸90K / month", ...scoreConfidence(defendSignals(sunscreen)) },
    { type: "FIX" as const, object: mascara.name, signal: `CVR ${(mascara.conversion * 100).toFixed(1)}%`, explanation: "Demand is arriving, but content is not closing enough of it.", recommendation: "Refresh the first image and value proposition.", impact: "+4–7% CVR", ...scoreConfidence(fixSignals(mascara)) },
  ].sort((a, b) => b.confidence - a.confidence);
}

export function getDashboard() {
  const actions = dashboardActions();
  const summaryConfidence = Math.round(actions.reduce((sum, action) => sum + action.confidence, 0) / actions.length);
  return {
    mode: "DEMO" as const,
    source,
    refreshedAt: demoRefreshedAt(),
    summary: {
      eyebrow: "AI EXECUTIVE SUMMARY",
      title: "Growth is real. Efficiency is the constraint.",
      body: "Sales grew 12% over the last 30 days, led by CeraVe and La Roche-Posay. External media is contributing demand, while Kaspi Ads efficiency softened as CPC rose 17%. The clearest move is to reallocate budget from competitor cards into Search.",
      confidence: summaryConfidence,
      impact: "+₸390K estimated incremental sales",
      severity: "MEDIUM",
    },
    metrics: [
      { label: "GMV / 30D", value: compactMoney(accountTotals.revenue), amount: accountTotals.revenue, unit: "CURRENCY" as const, change: "+12.4%", positive: true },
      { label: "ORDERS", value: accountTotals.orders.toLocaleString("en-US"), amount: accountTotals.orders, unit: "COUNT" as const, change: "+8.7%", positive: true },
      { label: "AD ROAS", value: `${adTotals.roas.toFixed(2)}x`, amount: Number(adTotals.roas.toFixed(2)), unit: "MULTIPLIER" as const, change: "-11.2%", positive: false },
      { label: "STOCK COVER", value: `${accountTotals.stockCoverDays} days`, amount: accountTotals.stockCoverDays, unit: "DAYS" as const, change: "-2 days", positive: false },
    ],
    actions,
    timeline: timeline(),
  };
}

export function getAdvertising() {
  const channels = [
    {
      id: "GOOGLE" as const,
      name: "Google Ads",
      source,
      impressions: 221000,
      clicks: 10110,
      ctr: 4.57,
      cpc: 92.4,
      estimatedOrders: 341,
      signal: {
        eyebrow: "AI SIGNAL · DEMO ESTIMATE",
        title: "Google captures the strongest purchase intent.",
        body: "High-intent search queries are sustaining efficient estimated orders. Expand the best-performing non-brand terms before widening reach.",
        confidence: 86,
        impact: "+22 estimated orders / month",
        severity: "HIGH",
      },
      activities: [
        { id: "google-1", date: "2026-08-17T10:15:00+05:00", channel: "Google Ads", eventType: "Bid refinement", explanation: "Top non-brand search bids were concentrated on six high-converting SKUs.", estimatedImpact: "+6–9% estimated orders" },
        { id: "google-2", date: "2026-08-15T14:30:00+05:00", channel: "Google Ads", eventType: "Query expansion", explanation: "Added high-intent skincare queries to the synthetic demo campaign.", estimatedImpact: "+9 estimated orders" },
      ],
    },
    {
      id: "META" as const,
      name: "Meta Ads",
      source,
      impressions: 316200,
      clicks: 11380,
      ctr: 3.6,
      cpc: 74.1,
      estimatedOrders: 235,
      signal: {
        eyebrow: "AI SIGNAL · DEMO ESTIMATE",
        title: "Meta creative is driving discovery, not yet conversion.",
        body: "Video reach grew faster than estimated orders. Keep the winning beauty audience, but refresh the product proof in the first frame.",
        confidence: 78,
        impact: "+13 estimated orders / month",
        severity: "MEDIUM",
      },
      activities: [
        { id: "meta-1", date: "2026-08-16T12:00:00+05:00", channel: "Meta Ads", eventType: "Creative refresh", explanation: "A product texture video replaced the static catalog cover for the skincare audience.", estimatedImpact: "+4–7% estimated orders" },
        { id: "meta-2", date: "2026-08-12T09:20:00+05:00", channel: "Meta Ads", eventType: "Audience launch", explanation: "The demo Beauty Pulse audience was activated with a fixed KZT budget.", estimatedImpact: "+12 estimated orders" },
      ],
    },
    {
      id: "TIKTOK" as const,
      name: "TikTok Ads",
      source,
      impressions: 382600,
      clicks: 8410,
      ctr: 2.2,
      cpc: 63.8,
      estimatedOrders: 130,
      signal: {
        eyebrow: "AI SIGNAL · DEMO ESTIMATE",
        title: "TikTok has low-cost attention but a weaker order signal.",
        body: "The demo creative attracts clicks efficiently, while estimated orders remain below the account benchmark. Test a clearer product offer before scaling budget.",
        confidence: 72,
        impact: "+8 estimated orders / month",
        severity: "MEDIUM",
      },
      activities: [
        { id: "tiktok-1", date: "2026-08-18T08:45:00+05:00", channel: "TikTok Ads", eventType: "Offer test", explanation: "A product bundle callout was added to the last two seconds of the demo video.", estimatedImpact: "+3–5% estimated orders" },
        { id: "tiktok-2", date: "2026-08-14T16:10:00+05:00", channel: "TikTok Ads", eventType: "Frequency cap", explanation: "The synthetic campaign reduced repeat exposure to protect creative efficiency.", estimatedImpact: "Stabilize estimated orders" },
      ],
    },
    {
      id: "KASPI" as const,
      name: "Kaspi Ads",
      source,
      impressions: adTotals.impressions,
      clicks: adTotals.clicks,
      ctr: Number((adTotals.ctr * 100).toFixed(2)),
      cpc: Number(adTotals.cpc.toFixed(2)),
      estimatedOrders: adTotals.orders,
      signal: {
        eyebrow: "AI SIGNAL · DEMO ESTIMATE",
        title: "Kaspi internal ads remain the largest estimated order driver.",
        body: "Search placement is efficient, but CPC is rising in the synthetic snapshot. Reallocate from competitor cards before increasing the total budget.",
        confidence: 83,
        impact: "+17 estimated orders / month",
        severity: "HIGH",
      },
      activities: [
        { id: "kaspi-1", date: "2026-08-15T11:30:00+05:00", channel: "Kaspi Ads", eventType: "Budget increase", explanation: "Search placement budget increased 30% in the demo scenario.", estimatedImpact: "+15 estimated orders" },
        { id: "kaspi-2", date: "2026-08-13T13:45:00+05:00", channel: "Kaspi Ads", eventType: "Placement mix", explanation: "Spend moved away from competitor cards toward Search placement.", estimatedImpact: "+5–8% estimated orders" },
      ],
    },
  ];
  for (const channel of channels) {
    channel.activities = channel.activities.map((activity) => ({ ...activity, date: demoTimestamp(activity.date) }));
  }
  return {
    mode: "DEMO" as const,
    source,
    refreshedAt: demoRefreshedAt(),
    primaryMetrics: [
      { label: "SPEND", value: compactMoney(adTotals.spend), amount: adTotals.spend, unit: "CURRENCY" as const, change: "+9.2%", positive: false },
      { label: "AD REVENUE", value: compactMoney(adTotals.revenue), amount: adTotals.revenue, unit: "CURRENCY" as const, change: "+1.6%", positive: true },
      { label: "ROAS", value: `${adTotals.roas.toFixed(2)}x`, amount: Number(adTotals.roas.toFixed(2)), unit: "MULTIPLIER" as const, change: "-11.2%", positive: false },
    ],
    secondaryMetrics: [
      { label: "ORDERS", value: adTotals.orders.toLocaleString("en-US"), change: "+4.8%", positive: true },
      { label: "CTR", value: `${(adTotals.ctr * 100).toFixed(2)}%`, change: "+0.6%", positive: true },
      { label: "CPC", value: `₸${adTotals.cpc.toFixed(2)}`, change: "+17.1%", positive: false },
      { label: "CVR", value: `${(adTotals.cvr * 100).toFixed(2)}%`, change: "-0.2%", positive: false },
      { label: "CPO", value: `₸${adTotals.cpo.toFixed(1)}`, change: "+4.2%", positive: false },
    ],
    signal: {
      eyebrow: "AI SIGNAL · HIGH CONFIDENCE",
      title: "Search is buying the highest-quality demand.",
      body: "Search is the most efficient placement at 4.32x ROAS and 5.8% CTR. CPC is 18% above the account benchmark, so the recommendation is to optimize bids for the most-converting SKUs rather than increase the total budget.",
      confidence: 86,
      impact: "+₸210K estimated monthly opportunity",
      severity: "HIGH",
    },
    placements,
    channels,
    activities: channels.flatMap((channel) => channel.activities).sort((a, b) => b.date.localeCompare(a.date)),
  };
}

export function getProducts() {
  return {
    mode: "DEMO" as const,
    source,
    refreshedAt: demoRefreshedAt(),
    products,
    matrix: [
      { label: "SCALE", count: products.filter((product) => product.opportunity === "SCALE").length, description: "Strong efficiency with room to buy more qualified traffic." },
      { label: "FIX", count: products.filter((product) => product.opportunity === "FIX").length, description: "High traffic, but the listing is not converting enough." },
      { label: "DEFEND", count: products.filter((product) => product.opportunity === "DEFEND").length, description: "Good product with increasing competitive pressure." },
      { label: "STOP", count: products.filter((product) => product.opportunity === "STOP").length, description: "Low efficiency or insufficient stock cover." },
    ],
  };
}

const seedCampaigns = [
  { id: "campaign-1", name: "Beauty Pulse", channel: "Meta", startDate: "2026-08-10", endDate: "2026-08-24", budget: 150000, objective: "Acquire skincare demand" },
  { id: "campaign-2", name: "Creator SPF Review", channel: "Influencer", startDate: "2026-08-05", endDate: "2026-08-12", budget: 60000, objective: "Drive product discovery" },
  { id: "campaign-3", name: "Search Demand Capture", channel: "Google", startDate: "2026-07-28", endDate: "2026-08-07", budget: 90000, objective: "Capture high intent" },
];

function campaignStatus(startDate: string, endDate: string) {
  const today = demoToday();
  if (startDate > today) return "PLANNED";
  if (endDate < today) return "COMPLETE";
  return "ACTIVE";
}

export async function getExternalMedia() {
  const seeds = seedCampaigns.map((campaign) => ({ ...campaign, startDate: demoDay(campaign.startDate), endDate: demoDay(campaign.endDate) }));
  const campaigns = seeds.map((campaign) => ({ ...campaign, status: campaignStatus(campaign.startDate, campaign.endDate) }));
  const impact = {
    campaignId: "campaign-1",
    periods: [
      { label: "BEFORE", gmv: 1320000, orders: 308, units: 354, aov: 4286, growth: 0 },
      { label: "DURING", gmv: 1710000, orders: 384, units: 451, aov: 4453, growth: 29.5 },
      { label: "AFTER", gmv: 1580000, orders: 362, units: 414, aov: 4365, growth: 19.7 },
    ],
    baseline: 1320000,
    incremental: 390000,
    ...scoreConfidence([
      { key: "enough_history", met: true },
      { key: "campaign_finished", met: false },
      { key: "no_overlap", met: true },
      { key: "trend_consistent", met: true },
    ]),
  };
  return {
    mode: "DEMO" as const,
    impacts: [impact],
    source,
    refreshedAt: demoRefreshedAt(),
    campaigns,
    selectedImpact: {
      campaignId: "campaign-1",
      campaignName: "Beauty Pulse",
      periods: [
        { label: "BEFORE", gmv: 1320000, orders: 308, units: 354, aov: 4286, growth: 0 },
        { label: "DURING", gmv: 1710000, orders: 384, units: 451, aov: 4453, growth: 29.5 },
        { label: "AFTER", gmv: 1580000, orders: 362, units: 414, aov: 4365, growth: 19.7 },
      ],
      baseline: 1320000,
      incremental: 390000,
      confidence: 74,
    },
    insight: {
      eyebrow: "ESTIMATED IMPACT · DEMO BASELINE",
      title: "Meta activation is associated with a wider demand lift.",
      body: "GMV increased from a synthetic baseline of ₸1.32M to ₸1.71M during the campaign window. Treat this as estimated incremental sales, not exact causal attribution.",
      confidence: 74,
      impact: "+₸390K estimated incremental sales",
      severity: "MEDIUM",
    },
  };
}

export function parseCampaign(input: unknown) {
  return validateCampaign(CreateExternalCampaignBody.parse(input));
}

export function getContent() {
  return {
    source,
    refreshedAt: demoRefreshedAt(),
    selectedSku: "SH-2401",
    score: 78,
    breakdown: [
      { label: "Main image", score: 92, note: "Clear hero image with product visible at thumbnail size." },
      { label: "Title", score: 84, note: "Core benefit is present, but the differentiator arrives late." },
      { label: "Description", score: 71, note: "Strong claims; benefits could be easier to scan." },
      { label: "Attributes", score: 88, note: "Key attributes are complete and consistent." },
      { label: "USP", score: 68, note: "The reason to choose this SKU is not explicit enough." },
      { label: "Visual hierarchy", score: 74, note: "The first image and title do not tell the same story." },
      { label: "Reviews", score: 81, note: "Positive review volume supports conversion." },
      { label: "Completeness", score: 86, note: "Few missing fields; opportunity is mostly prioritization." },
    ],
    strengths: ["High-quality primary image", "Complete attributes", "Positive review density"],
    weaknesses: ["USP is not explicit in first-screen content", "Benefits are buried below product facts"],
    recommendations: ["Lead with the 30-day barrier repair benefit in the title", "Test an image with the use case and texture cue", "Move the proof point into the first three description lines"],
    priority: "MEDIUM",
  };
}

export function getIntegrations() {
  return {
    kaspi: { name: "Kaspi Seller API", status: "NOT_CONNECTED", source: "DEMO DATA", detail: sourceMessageKeys.kaspiComingSoon },
    redstat: { name: "Redstat MCP", status: "NOT_CONNECTED", source: "MOCK", detail: sourceMessageKeys.redstatMethodsUnconfirmed },
    media: [
      { name: "Meta", status: "DEMO", source: "DEMO DATA", detail: sourceMessageKeys.demoActive },
      { name: "Google", status: "DEMO", source: "DEMO DATA", detail: sourceMessageKeys.demoActive },
      { name: "TikTok", status: "DEMO", source: "DEMO DATA", detail: sourceMessageKeys.demoActive },
    ],
  };
}

/**
 * The live Kaspi connector is not built yet. The endpoint stays so the contract is ready,
 * but it never pretends a token failed: it reports that the connector is not available.
 * The token is validated for shape only and is never stored or logged.
 */
export function testKaspiConnection(input: unknown) {
  TestKaspiConnectionBody.parse(input);
  return { name: "Kaspi Seller API", status: "NOT_CONNECTED" as const, source: "DEMO DATA" as const, detail: sourceMessageKeys.kaspiComingSoon };
}

export type KaspiConnector = {
  getOrders: () => Promise<unknown>;
  getOrderEntries: () => Promise<unknown>;
  getProducts: () => Promise<unknown>;
  getSales: () => Promise<unknown>;
  getInventory: () => Promise<unknown>;
};


/** Demo card analysis: shows what the page looks like with RedStat connected. */
export function getDemoCardAnalysis() {
  return {
    mode: "DEMO" as const,
    source,
    products: products.slice(0, 6).map((product) => ({ sku: product.sku, name: product.name, kaspiCode: null })),
    sku: products[0].sku,
    name: products[0].name,
    kaspiCode: null,
    revenue: products[0].revenue,
    trendPct: products[0].trend,
    checklist: [
      { key: "card.rating", status: "PASS" as const, params: { rating: 4.9 } },
      { key: "card.reviews", status: "PASS" as const, params: { count: 102 } },
      { key: "card.negative", status: "WARN" as const, params: { pct: 12.7 } },
      { key: "card.price", status: "WARN" as const, params: { gap: 6.1, min: 6283 } },
      { key: "card.sellers", status: "PASS" as const, params: { count: 2 } },
      { key: "card.returns", status: "PASS" as const, params: { pct: 2.1 } },
      { key: "card.trend", status: "PASS" as const, params: { trend: products[0].trend } },
    ],
    reviews: { averageRating: 4.9, count: 102, positive: 87, negative: 13 },
    themes: { praise: ["theme.effect", "theme.quality", "theme.smell"], complaints: ["theme.delivery", "theme.packaging", "theme.authenticity"], mode: "RULES" as const },
    events: [
      { id: "demo-event-1", sku: products[0].sku, kind: "PHOTO" as const, note: null, happenedAt: demoTimestamp("2026-08-04T10:00:00+05:00"), beforePerDay: 2100, afterPerDay: 2400, changePct: 14.3, daysAfter: 14 },
    ],
  };
}

/** The demo shop's attention list: products whose stock runs out before a batch would arrive, and ads that do not pay back. */
export function getAttention() {
  const items = [
    ...products.filter((product) => product.stockCoverDays < 14).map((product) => ({
      key: `STOCK_BEFORE_DELIVERY:${product.sku}`, type: "STOCK_BEFORE_DELIVERY" as const, severity: "HIGH" as const, sku: product.sku, name: product.name,
      params: { days: product.stockCoverDays, lead: 14, qty: Math.round((product.units / 30) * (21 - product.stockCoverDays)), date: "" },
      impactAmount: Math.round((product.revenue / 30) * (14 - product.stockCoverDays)),
    })),
    ...products.filter((product) => product.roas < 3).map((product) => ({
      key: `ADS_LOSING:${product.sku}`, type: "ADS_LOSING" as const, severity: "MEDIUM" as const, sku: product.sku, name: product.name,
      params: { roas: product.roas, breakeven: 3, spend: product.spend },
      impactAmount: Math.round(product.spend * (1 - product.roas / 3)),
    })),
  ].sort((a, b) => (a.severity === b.severity ? b.impactAmount - a.impactAmount : a.severity === "HIGH" ? -1 : 1));
  return { mode: "DEMO" as const, refreshedAt: demoRefreshedAt(), items, high: items.filter((item) => item.severity === "HIGH").length, medium: items.filter((item) => item.severity === "MEDIUM").length };
}
