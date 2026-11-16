import type { ConfidenceSignalKey } from "@workspace/api-zod";
import { accountTotals, opportunityRules, type DemoProduct } from "./demo-products";

export type ConfidenceCheck = { key: ConfidenceSignalKey; met: boolean };

export type ConfidenceBasis = {
  supporting: number;
  total: number;
  signals: ConfidenceCheck[];
};

/**
 * Confidence is the share of independent signals that agree with the recommendation,
 * mapped onto 50–90%. It never reaches 100%: the inputs are a snapshot, not an experiment.
 */
export function scoreConfidence(signals: ConfidenceCheck[]): { confidence: number; confidenceBasis: ConfidenceBasis } {
  const supporting = signals.filter((signal) => signal.met).length;
  const total = signals.length;
  const confidence = total ? Math.round(50 + (40 * supporting) / total) : 50;
  return { confidence, confidenceBasis: { supporting, total, signals } };
}

const benchmarkRoas = () => accountTotals.roas;
const averageConversion = () => accountTotals.conversion;

export function scaleSignals(product: DemoProduct): ConfidenceCheck[] {
  return [
    { key: "roas_above_benchmark", met: product.roas >= benchmarkRoas() },
    { key: "conversion_above_average", met: product.conversion >= averageConversion() },
    { key: "stock_sufficient", met: product.stockCoverDays >= 21 },
    { key: "demand_growing", met: product.trend >= 10 },
    { key: "price_competitive", met: product.competitorPrice >= product.price * 0.98 },
  ];
}

export function defendSignals(product: DemoProduct): ConfidenceCheck[] {
  return [
    { key: "competitor_undercuts", met: product.competitorPrice < product.price * opportunityRules.defendPriceGap },
    { key: "conversion_above_average", met: product.conversion >= averageConversion() },
    { key: "roas_above_benchmark", met: product.roas >= benchmarkRoas() },
    { key: "demand_growing", met: product.trend >= 10 },
  ];
}

export function fixSignals(product: DemoProduct): ConfidenceCheck[] {
  return [
    { key: "conversion_below_average", met: product.conversion < averageConversion() },
    { key: "traffic_above_average", met: product.clicks >= accountTotals.averageClicks },
    { key: "stock_sufficient", met: product.stockCoverDays >= 21 },
    { key: "price_competitive", met: product.competitorPrice >= product.price * 0.98 },
    { key: "roas_below_benchmark", met: product.roas < benchmarkRoas() },
  ];
}

export function placementSignals(placement: { roas: number; cpc: number; ctr: number; benchmarkRoas: number; pressure: "LOW" | "MEDIUM" | "HIGH" }, account: { cpc: number; ctr: number }): ConfidenceCheck[] {
  return [
    { key: "roas_above_benchmark", met: placement.roas >= placement.benchmarkRoas },
    { key: "cpc_above_average", met: placement.cpc > account.cpc },
    { key: "ctr_above_average", met: placement.ctr >= account.ctr },
    { key: "low_competitive_pressure", met: placement.pressure === "LOW" },
  ];
}
