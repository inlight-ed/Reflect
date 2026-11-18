import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type {
  MediaBenchmark,
  MediaCheck,
  MediaFactInput,
  MediaPlacement,
  MediaPlan,
  MediaPlanInput,
  MediaPlanListItem,
  MediaVariantSummary,
} from "@workspace/api-zod";
import type { MediaPlacementRow } from "@workspace/db";
import { database } from "./database";
import { ensureClient } from "./workspaces";

/**
 * Agency media plans: the plan as written, checks of its own arithmetic, and plan against fact.
 * All figures are the agency's: planned numbers come from its file, fact from platform reports.
 */

/** A declared total off by more than this share from the sum of its rows is a mistake in the file. */
export const TOTAL_TOLERANCE = 0.01;
/** Clicks that differ from impressions × CTR by more than this share do not add up. */
export const CTR_TOLERANCE = 0.1;

const round = (value: number, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits;
const ratio = (a: number | null | undefined, b: number | null | undefined) => (a != null && b != null && b > 0 ? a / b : null);
const sum = (values: Array<number | null | undefined>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const label = (row: { platform: string; format: string }) => `${row.platform} · ${row.format}`;

type PlanRowLike = Pick<MediaPlacementRow, "id" | "variant" | "platform" | "format" | "buyType" | "cost" | "planImpressions" | "planReach" | "planClicks" | "planCtr">;

/** Mistakes in the plan's own arithmetic, found the moment it is read. */
export function planChecks(rows: PlanRowLike[], declared: MediaPlanInput["declaredTotals"] = []): MediaCheck[] {
  const checks: MediaCheck[] = [];
  for (const total of declared ?? []) {
    const own = rows.filter((row) => row.variant === total.variant);
    if (!own.length) continue;
    const computed = { cost: sum(own.map((r) => r.cost)), impressions: sum(own.map((r) => r.planImpressions)), clicks: sum(own.map((r) => r.planClicks)) };
    for (const field of ["cost", "impressions", "clicks"] as const) {
      const value = total[field];
      if (value == null || value === 0) continue;
      if (Math.abs(computed[field] - value) / value > TOTAL_TOLERANCE) {
        checks.push({ type: "TOTAL_MISMATCH", variant: total.variant, field, declared: round(value), computed: round(computed[field]) });
      }
    }
  }
  for (const row of rows) {
    // A paid line with no forecast cannot be measured against a fact.
    if ((row.cost ?? 0) > 0 && row.planImpressions == null && !/единиц|unit|шт/i.test(row.buyType ?? "")) {
      checks.push({ type: "MISSING_FORECAST", variant: row.variant, placementId: row.id, label: label(row) });
    }
    if (row.planImpressions && row.planCtr != null && row.planClicks != null) {
      const expected = row.planImpressions * row.planCtr;
      if (expected > 0 && Math.abs(row.planClicks - expected) / expected > CTR_TOLERANCE) {
        checks.push({ type: "CTR_MISMATCH", variant: row.variant, placementId: row.id, label: label(row), declared: round(row.planClicks), computed: round(expected) });
      }
    }
    if (row.planReach != null && row.planImpressions != null && row.planReach > row.planImpressions) {
      checks.push({ type: "REACH_ABOVE_IMPRESSIONS", variant: row.variant, placementId: row.id, label: label(row), declared: round(row.planReach), computed: round(row.planImpressions) });
    }
  }
  return checks;
}

/** One placement with plan and fact side by side: what a contact was meant to cost and what it did. */
export function placementView(row: MediaPlacementRow): MediaPlacement {
  const spent = row.factCost ?? row.cost;
  const planCpm = ratio(row.cost, row.planImpressions);
  const planCpc = ratio(row.cost, row.planClicks);
  const delivery = ratio(row.factImpressions, row.planImpressions);
  const factCtr = ratio(row.factClicks, row.factImpressions);
  const effectiveCpm = ratio(spent, row.factImpressions);
  const effectiveCpc = ratio(spent, row.factClicks);
  return {
    id: row.id,
    position: row.position,
    variant: row.variant,
    platform: row.platform,
    format: row.format,
    mechanic: row.mechanic,
    buyType: row.buyType,
    period: row.period,
    cost: row.cost,
    planImpressions: row.planImpressions,
    planReach: row.planReach,
    planClicks: row.planClicks,
    planCtr: row.planCtr,
    expectedEffect: row.expectedEffect,
    planCpm: planCpm === null ? null : round(planCpm * 1000, 1),
    planCpc: planCpc === null ? null : round(planCpc, 1),
    factCost: row.factCost,
    factImpressions: row.factImpressions,
    factReach: row.factReach,
    factClicks: row.factClicks,
    factCtr: factCtr === null ? null : round(factCtr, 4),
    delivery: delivery === null ? null : round(delivery, 3),
    effectiveCpm: effectiveCpm === null ? null : round(effectiveCpm * 1000, 1),
    effectiveCpc: effectiveCpc === null ? null : round(effectiveCpc, 1),
  };
}

export function variantSummaries(rows: MediaPlacementRow[]): MediaVariantSummary[] {
  const variants = [...new Set(rows.map((row) => row.variant))];
  return variants.map((variant) => {
    const own = rows.filter((row) => row.variant === variant);
    const withFact = own.filter((row) => row.factImpressions != null);
    const cost = sum(own.map((r) => r.cost));
    const planImpressions = sum(own.map((r) => r.planImpressions));
    // Delivery and the real price are judged on the placements that have a fact, plan against fact.
    const factImpressions = sum(withFact.map((r) => r.factImpressions));
    const plannedForFact = sum(withFact.map((r) => r.planImpressions));
    const spentForFact = sum(withFact.map((r) => r.factCost ?? r.cost));
    // Price per thousand only over lines that forecast impressions: a package without a forecast
    // would otherwise inflate it.
    const forecasted = own.filter((r) => r.planImpressions != null && r.planImpressions > 0);
    const planCpm = ratio(sum(forecasted.map((r) => r.cost)), sum(forecasted.map((r) => r.planImpressions)));
    const delivery = ratio(factImpressions, plannedForFact);
    const effectiveCpm = ratio(spentForFact, factImpressions);
    return {
      variant,
      placements: own.length,
      cost: round(cost),
      planImpressions: round(planImpressions),
      planClicks: round(sum(own.map((r) => r.planClicks))),
      planCpm: planCpm === null ? null : round(planCpm * 1000, 1),
      factImpressions: round(factImpressions),
      factClicks: round(sum(withFact.map((r) => r.factClicks))),
      withFact: withFact.length,
      delivery: delivery === null ? null : round(delivery, 3),
      effectiveCpm: effectiveCpm === null ? null : round(effectiveCpm * 1000, 1),
    };
  });
}

/**
 * How each platform and format compares across all of the agency's plans: the planned and the
 * delivered price of a thousand impressions, and how much of the plan platforms actually deliver.
 * Medians, so one odd placement does not set the benchmark.
 */
export function benchmarks(rows: Array<MediaPlacementRow & { client: string }>): MediaBenchmark[] {
  const groups = new Map<string, Array<MediaPlacementRow & { client: string }>>();
  const key = (row: MediaPlacementRow) => `${row.platform.trim().toLowerCase()}|${row.format.trim().toLowerCase()}`;
  for (const row of rows) {
    if (!groups.has(key(row))) groups.set(key(row), []);
    groups.get(key(row))!.push(row);
  }
  return [...groups.values()].map((group) => {
    const planCpms = group.map((r) => ratio(r.cost, r.planImpressions)).filter((v): v is number => v !== null);
    const effective = group.map((r) => ratio(r.factCost ?? r.cost, r.factImpressions)).filter((v): v is number => v !== null);
    const delivery = group.map((r) => ratio(r.factImpressions, r.planImpressions)).filter((v): v is number => v !== null);
    const planCpm = median(planCpms);
    const effectiveCpm = median(effective);
    const deliveryMedian = median(delivery);
    return {
      platform: group[0]!.platform,
      format: group[0]!.format,
      buyType: group.find((r) => r.buyType)?.buyType ?? null,
      placements: group.length,
      plans: new Set(group.map((r) => r.planId)).size,
      clients: new Set(group.map((r) => r.client)).size,
      planCpm: planCpm === null ? null : round(planCpm * 1000, 1),
      effectiveCpm: effectiveCpm === null ? null : round(effectiveCpm * 1000, 1),
      delivery: deliveryMedian === null ? null : round(deliveryMedian, 3),
    };
  }).sort((a, b) => b.placements - a.placements || a.platform.localeCompare(b.platform));
}

export class MediaPlanNotFound extends Error {}

const parseChecks = (raw: string): MediaCheck[] => {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as MediaCheck[]) : [];
  } catch {
    return [];
  }
};

export async function createMediaPlan(workspaceId: string, input: MediaPlanInput): Promise<MediaPlan> {
  const { db, mediaPlansTable, mediaPlacementsTable } = await database();
  const planId = randomUUID();
  const rows = input.placements.map((placement, position) => ({
    id: randomUUID(),
    planId,
    workspaceId,
    position,
    variant: placement.variant.trim(),
    platform: placement.platform.trim(),
    format: placement.format.trim(),
    mechanic: placement.mechanic ?? null,
    buyType: placement.buyType ?? null,
    period: placement.period ?? null,
    cost: placement.cost ?? null,
    planImpressions: placement.planImpressions ?? null,
    planReach: placement.planReach ?? null,
    planClicks: placement.planClicks ?? null,
    planCtr: placement.planCtr ?? null,
    expectedEffect: placement.expectedEffect ?? null,
  }));
  const checks = planChecks(rows, input.declaredTotals);
  await db.transaction(async (tx) => {
    const client = await ensureClient(tx, workspaceId, input.client);
    await tx.insert(mediaPlansTable).values({ id: planId, workspaceId, clientId: client.id, title: input.title.trim(), fileName: input.fileName ?? null, checks: JSON.stringify(checks) });
    for (let i = 0; i < rows.length; i += 200) await tx.insert(mediaPlacementsTable).values(rows.slice(i, i + 200));
  });
  return getMediaPlan(workspaceId, planId);
}

export async function getMediaPlan(workspaceId: string, planId: string): Promise<MediaPlan> {
  const { db, mediaPlansTable, mediaPlacementsTable, clientsTable } = await database();
  const [found] = await db.select({ plan: mediaPlansTable, client: clientsTable.name }).from(mediaPlansTable)
    .innerJoin(clientsTable, eq(clientsTable.id, mediaPlansTable.clientId))
    .where(and(eq(mediaPlansTable.id, planId), eq(mediaPlansTable.workspaceId, workspaceId)));
  if (!found) throw new MediaPlanNotFound();
  const { plan, client } = found;
  const rows = await db.select().from(mediaPlacementsTable).where(eq(mediaPlacementsTable.planId, planId)).orderBy(asc(mediaPlacementsTable.position));
  return {
    id: plan.id,
    client,
    clientId: plan.clientId,
    title: plan.title,
    fileName: plan.fileName,
    createdAt: plan.createdAt.toISOString(),
    placements: rows.map(placementView),
    variants: variantSummaries(rows),
    checks: parseChecks(plan.checks),
  };
}

/**
 * Plans of the workspace, newest first, optionally of one client. Benchmarks always cover every
 * plan of the workspace: the point is to compare one client's prices with the agency's.
 */
export async function listMediaPlans(workspaceId: string, clientId?: string): Promise<{ plans: MediaPlanListItem[]; benchmarks: MediaBenchmark[] }> {
  const { db, mediaPlansTable, mediaPlacementsTable, clientsTable } = await database();
  const all = await db.select({ plan: mediaPlansTable, client: clientsTable.name }).from(mediaPlansTable)
    .innerJoin(clientsTable, eq(clientsTable.id, mediaPlansTable.clientId))
    .where(eq(mediaPlansTable.workspaceId, workspaceId)).orderBy(desc(mediaPlansTable.createdAt)).limit(500);
  if (!all.length) return { plans: [], benchmarks: [] };
  const rows = await db.select().from(mediaPlacementsTable).where(inArray(mediaPlacementsTable.planId, all.map(({ plan }) => plan.id)));
  const clientOf = new Map(all.map(({ plan }) => [plan.id, plan.clientId]));
  const shown = (clientId ? all.filter(({ plan }) => plan.clientId === clientId) : all).slice(0, 200);
  return {
    plans: shown.map(({ plan, client }) => {
      const own = rows.filter((row) => row.planId === plan.id);
      return {
        id: plan.id,
        client,
        clientId: plan.clientId,
        title: plan.title,
        createdAt: plan.createdAt.toISOString(),
        variants: variantSummaries(own),
        placements: own.length,
        checks: parseChecks(plan.checks).length,
        withFact: own.filter((row) => row.factImpressions != null).length,
      };
    }),
    benchmarks: benchmarks(rows.map((row) => ({ ...row, client: clientOf.get(row.planId) ?? "" }))),
  };
}

export async function saveMediaFact(workspaceId: string, planId: string, placementId: string, fact: MediaFactInput): Promise<MediaPlan> {
  const { db, mediaPlacementsTable } = await database();
  const fields = {
    ...(fact.factCost !== undefined ? { factCost: fact.factCost } : {}),
    ...(fact.factImpressions !== undefined ? { factImpressions: fact.factImpressions } : {}),
    ...(fact.factReach !== undefined ? { factReach: fact.factReach } : {}),
    ...(fact.factClicks !== undefined ? { factClicks: fact.factClicks } : {}),
  };
  const updated = await db.update(mediaPlacementsTable)
    .set({ ...fields, factUpdatedAt: new Date() })
    .where(and(eq(mediaPlacementsTable.id, placementId), eq(mediaPlacementsTable.planId, planId), eq(mediaPlacementsTable.workspaceId, workspaceId)))
    .returning({ id: mediaPlacementsTable.id });
  if (!updated.length) throw new MediaPlanNotFound();
  return getMediaPlan(workspaceId, planId);
}
