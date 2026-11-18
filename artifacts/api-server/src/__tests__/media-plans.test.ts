/**
 * Media plans: checks of the plan's own arithmetic, plan against fact, and the platform comparison.
 * The last block needs DATABASE_URL (skipped otherwise; CI runs it against PostgreSQL).
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import type { MediaPlacementRow } from "@workspace/db";
import { register } from "../lib/auth";
import { database } from "../lib/database";
import { benchmarks, createMediaPlan, getMediaPlan, listMediaPlans, MediaPlanNotFound, placementView, planChecks, saveMediaFact, variantSummaries } from "../lib/media-plans";

const row = (extra: Partial<MediaPlacementRow>): MediaPlacementRow => ({
  id: "p", planId: "plan", userId: "u", position: 0, variant: "Лайт", platform: "Wolt Ads", format: "Hero Banner",
  mechanic: null, buyType: "Fix / Месяц", period: "1 месяц", cost: 1_600_000, planImpressions: 1_200_000, planReach: 500_000,
  planClicks: 12_000, planCtr: 0.01, expectedEffect: null, factCost: null, factImpressions: null, factReach: null, factClicks: null, factUpdatedAt: null,
  ...extra,
});

describe("media plan checks", () => {
  it("finds a total that does not match its rows, clicks that do not add up, a missing forecast and reach above impressions", () => {
    const rows = [
      row({ id: "a", variant: "Медиум", cost: 16_500_000, planImpressions: 25_000_000, planClicks: 200_000, planCtr: 0.008 }),
      row({ id: "b", variant: "Медиум", cost: 700_000, planImpressions: 60_000, planClicks: 9_000, planCtr: 0.08, planReach: 40_000 }),
      row({ id: "c", variant: "Лайт", platform: "Kaspi", format: "Пакеты Новинки", cost: 2_000_000, planImpressions: null, planClicks: null, planCtr: null, planReach: null }),
      row({ id: "d", variant: "Лайт", platform: "Arbuz.kz", format: "Сэмплинг", buyType: "За единицу", cost: 1_000_000, planImpressions: null, planClicks: null, planCtr: null, planReach: null }),
      row({ id: "e", variant: "Лайт", planReach: 2_000_000 }),
    ];
    const checks = planChecks(rows, [{ variant: "Медиум", cost: 21_700_000, impressions: 1_590_000 }]);
    const types = checks.map((c) => `${c.type}:${c.field ?? c.placementId}`);
    assert.ok(types.includes("TOTAL_MISMATCH:cost"));
    assert.ok(types.includes("TOTAL_MISMATCH:impressions"));
    assert.equal(checks.find((c) => c.field === "cost")?.computed, 17_200_000);
    assert.ok(types.includes("CTR_MISMATCH:b"), "60 000 × 8 % = 4 800, not 9 000");
    assert.ok(types.includes("MISSING_FORECAST:c"));
    assert.equal(types.includes("MISSING_FORECAST:d"), false, "per-unit sampling has no impressions by nature");
    assert.ok(types.includes("REACH_ABOVE_IMPRESSIONS:e"));
    assert.equal(types.includes("CTR_MISMATCH:a"), false);
  });
});

describe("plan against fact", () => {
  it("shows delivery and what a contact really cost", () => {
    const view = placementView(row({ factImpressions: 900_000, factClicks: 7_200 }));
    assert.equal(view.planCpm, 1_333.3);
    assert.equal(view.delivery, 0.75);
    assert.equal(view.effectiveCpm, 1_777.8, "the same fixed price over fewer impressions");
    assert.equal(view.factCtr, 0.008);
    assert.equal(view.effectiveCpc, 222.2);
  });

  it("judges a variant's delivery only on placements that have a fact", () => {
    const [summary] = variantSummaries([
      row({ id: "a", factImpressions: 1_200_000 }),
      row({ id: "b", cost: 600_000, planImpressions: 240_000 }),
    ]);
    assert.equal(summary?.cost, 2_200_000);
    assert.equal(summary?.withFact, 1);
    assert.equal(summary?.delivery, 1);
    assert.equal(summary?.effectiveCpm, 1_333.3);
  });

  it("prices a thousand planned impressions only over lines that forecast them", () => {
    const [summary] = variantSummaries([
      row({ id: "a", cost: 600_000, planImpressions: 150_000 }),
      row({ id: "b", platform: "Kaspi", format: "Пакет", cost: 2_000_000, planImpressions: null }),
    ]);
    assert.equal(summary?.cost, 2_600_000);
    assert.equal(summary?.planCpm, 4_000);
  });

  it("compares platforms across plans and clients by median price per thousand", () => {
    const result = benchmarks([
      { ...row({ id: "a", planId: "p1", cost: 1_000_000, planImpressions: 1_000_000, factImpressions: 500_000 }), client: "L'Oréal" },
      { ...row({ id: "b", planId: "p2", cost: 2_000_000, planImpressions: 1_000_000 }), client: "LG" },
      { ...row({ id: "c", planId: "p3", platform: "Arbuz.kz", format: "Корзина", cost: 350_000, planImpressions: 60_000 }), client: "LG" },
    ]);
    const wolt = result.find((b) => b.platform === "Wolt Ads");
    assert.equal(wolt?.placements, 2);
    assert.equal(wolt?.clients, 2);
    assert.equal(wolt?.planCpm, 1_500);
    assert.equal(wolt?.effectiveCpm, 2_000);
    assert.equal(wolt?.delivery, 0.5);
  });
});

const skip = process.env["DATABASE_URL"] ? false : "set DATABASE_URL to run database tests";

describe("media plans in the database", { skip }, () => {
  const ids: string[] = [];
  after(async () => {
    const { db, usersTable } = await database();
    for (const id of ids) await db.delete(usersTable).where(eq(usersTable.id, id));
  });

  it("saves a plan with its checks, records a fact, and keeps plans to their owner", async () => {
    const stamp = Date.now();
    const { user } = await register(`media-a-${stamp}@example.kz`, "password-123");
    const { user: other } = await register(`media-b-${stamp}@example.kz`, "password-123");
    ids.push(user.id, other.id);
    const plan = await createMediaPlan(user.id, {
      client: "L'Oréal",
      title: "Медиаплан ноябрь",
      fileName: "mp.xlsx",
      placements: [
        { variant: "Лайт", platform: "Wolt Ads", format: "Hero Banner", cost: 1_600_000, planImpressions: 1_200_000, planClicks: 12_000, planCtr: 0.01 },
        { variant: "Лайт", platform: "Arbuz.kz", format: "Корзина", cost: 350_000, planImpressions: 60_000, planClicks: 4_800, planCtr: 0.08 },
      ],
      declaredTotals: [{ variant: "Лайт", cost: 3_850_000 }],
    });
    assert.equal(plan.placements.length, 2);
    assert.equal(plan.checks[0]?.type, "TOTAL_MISMATCH");

    const updated = await saveMediaFact(user.id, plan.id, plan.placements[0]!.id, { factImpressions: 1_000_000, factClicks: 9_000 });
    assert.equal(updated.placements[0]?.delivery, 0.833);
    assert.equal(updated.variants[0]?.withFact, 1);

    const list = await listMediaPlans(user.id);
    assert.equal(list.plans[0]?.client, "L'Oréal");
    assert.equal(list.benchmarks.length, 2);

    await assert.rejects(getMediaPlan(other.id, plan.id), MediaPlanNotFound);
    await assert.rejects(saveMediaFact(other.id, plan.id, plan.placements[0]!.id, { factImpressions: 1 }), MediaPlanNotFound);
    assert.equal((await listMediaPlans(other.id)).plans.length, 0);
  });
});
