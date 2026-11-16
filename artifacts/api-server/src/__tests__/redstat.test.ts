/**
 * The RedStat adapter, fed with trimmed copies of real RedStat MCP answers (November 2026).
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { getCompetitorAnalysis, mapRedstatDynamics, mapRedstatProduct, mcpRedstatConnector, redstatCache, redstatTools } from "../lib/redstat";

const NOTE = "Октябрь 2026 неполный: сумму этого месяца с соседними не сравнивайте.";
const SKU = "102277651";
const CATEGORY = "c3b785adcb6";

const search = {
  products: [
    { sku: "102277651", name: "EVO Laboratoires Мочевина 7% крем для рук 100 мл", brand: "EVO Laboratoires", category_id: CATEGORY, category: "Кремы, масла и сыворотки для тела", path: "Красота и здоровье → Уход за телом → Кремы, масла и сыворотки для тела", price: 1341, revenue: 2042725, orders: 1523, sellers: 29, reviews: 897, rating: 4.9, segment: "Бюджетный", life_stage: "Старичок", is_branded: 1, kaspi_url: "https://kaspi.kz/shop/p/-102277651/", revenue_change_pct: 42.69, redstat_link: "https://app.redstat.kz/kazakhstan/ecom/products/ce74e6fd606e2020" },
    { sku: "102559340", name: "La Sultane de Saba крем для рук 50 мл", category_id: CATEGORY, price: 11894, revenue: 1962520, orders: 165, sellers: 5, revenue_change_pct: null },
  ],
  date: "2026-10-01",
  note: NOTE,
};
const segments = {
  category_id: CATEGORY, name: "Кремы, масла и сыворотки для тела", date: "2026-10-01",
  kaspi_link: "https://kaspi.kz/shop/c/body%20creams/", redstat_link: "https://app.redstat.kz/kazakhstan/ecom/categories/c3b785adcb6",
  segments: [
    { segment: 2, segment_name: "Бюджетный", sku_count: 872, total_revenue: 40473349, avg_price: 1695, min_price: 1273, max_price: 2122, avg_merchant_cnt: 3.0, no_brand_pct: 1.5, revenue_share_pct: 9.3 },
    { segment: 1, segment_name: "Низкий", sku_count: 872, total_revenue: 28413935, avg_price: 834, min_price: 186, max_price: 1273, avg_merchant_cnt: 2.9, no_brand_pct: 1.5, revenue_share_pct: 6.6 },
  ],
  note: NOTE,
};
const brands = { name: "Кремы, масла и сыворотки для тела", date: "2026-10-01", brands: [{ brand: "MIXIT", revenue: 33089966, orders: 11389, sku_count: 50, seller_count: null }] };
const forecast = {
  category_id: CATEGORY,
  seasonality: { seasonality_index: 0.15, peak_month: 3, season_class: "moderate_seasonal", trend_slope: 0.0175 },
  forecast_quality: { status: "not_published", safe_for_decisions: false },
  predictions_enabled: false,
  forecast: [
    { date: "2026-10-01", value_type: "fact", revenue: 433323149, orders: 131721, comparable_to_previous: false, note: "Неполный месяц: с соседними месяцами сумму не сравнивать." },
    { date: "2026-08-01", value_type: "fact", revenue: 364970850, orders: 86837, comparable_to_previous: true, note: "Календарный месяц" },
    { date: "2026-09-01", value_type: "fact", revenue: 402051532, orders: 116728, comparable_to_previous: false, note: "Данных больше, чем в прошлых месяцах." },
    { date: "2026-12-01", value_type: "predict", revenue: 999 },
  ],
};
const sellers = { sellers: [{ name: "Магазин А", price: 1290, rating: 4.9 }], resolved: { product_name: "EVO крем для рук" } };

function fakeRedstat() {
  const calls: string[] = [];
  const answers: Record<string, unknown> = { search_products: search, niche_segments: segments, niche_brands: brands, niche_forecast: forecast, product_sellers: sellers };
  const call = async (tool: string) => {
    calls.push(tool);
    if (!(tool in answers)) throw new Error("unknown tool");
    return answers[tool];
  };
  return { calls, call };
}

describe("RedStat adapter", () => {
  beforeEach(() => redstatCache.clear());

  it("takes the card only on an exact SKU match and keeps RedStat's own growth figure", () => {
    const product = mapRedstatProduct(search, SKU);
    assert.equal(product?.name, "EVO Laboratoires Мочевина 7% крем для рук 100 мл");
    assert.equal(product?.categoryId, CATEGORY);
    assert.equal(product?.sellerCount, 29);
    assert.equal(product?.branded, true);
    assert.equal(product?.revenueChangePct, 42.69);
    assert.equal(mapRedstatProduct(search, "102559340")?.revenueChangePct, null, "null stays null: the months cannot be compared");
    assert.equal(mapRedstatProduct(search, "1022776"), undefined, "a partial match is not the seller's card");
  });

  it("keeps facts only, in order, with RedStat's comparability flag and notes", () => {
    const dynamics = mapRedstatDynamics(forecast);
    assert.deepEqual(dynamics?.points.map((p) => p.month), ["2026-08-01", "2026-09-01", "2026-10-01"]);
    assert.deepEqual(dynamics?.points.map((p) => p.comparable), [true, false, false]);
    assert.equal(dynamics?.points[0]?.note, undefined, "comparable months carry no warning");
    assert.match(dynamics?.points[2]?.note ?? "", /Неполный/);
    assert.equal(dynamics?.peakMonth, 3);
    assert.equal(dynamics?.forecastPublished, false);
  });

  it("builds the card's market: product, niche segments, brands and months", async () => {
    const { call } = fakeRedstat();
    const overview = await getCompetitorAnalysis(SKU, mcpRedstatConnector(call, "test"));
    assert.equal(overview.status, "READY");
    assert.equal(overview.market?.month, "2026-10-01");
    assert.equal(overview.market?.note, NOTE);
    assert.equal(overview.market?.product?.segment, "Бюджетный");
    assert.deepEqual(overview.market?.category?.segments.map((s) => s.index), [1, 2]);
    assert.equal(overview.market?.category?.brands[0]?.name, "MIXIT");
    assert.equal(overview.market?.dynamics?.points.length, 3);
  });

  it("serves monthly data from memory on a second look, but reads sellers live every time", async () => {
    const { calls, call } = fakeRedstat();
    const connector = mcpRedstatConnector(call, "test");
    await getCompetitorAnalysis(SKU, connector);
    const first = calls.length;
    await getCompetitorAnalysis(SKU, connector);
    assert.deepEqual(calls.slice(first), ["product_sellers"]);
  });

  it("leaves out what RedStat has no data for instead of filling it in", async () => {
    const call = async (tool: string) => (tool === "search_products" ? { products: [], date: "2026-10-01" } : tool === "product_sellers" ? { sellers: [] } : {});
    const overview = await getCompetitorAnalysis("999", mcpRedstatConnector(call, "empty"));
    assert.equal(overview.status, "NO_DATA");
    assert.equal(overview.market, undefined);
  });

  it("follows renamed tools from REDSTAT_TOOLS and ignores a broken override", () => {
    assert.equal(redstatTools('{"niche_dynamics":"niche_timeline"}').niche_dynamics, "niche_timeline");
    assert.equal(redstatTools('{"niche_dynamics":"bad name!"}').niche_dynamics, "niche_forecast");
    assert.equal(redstatTools("not json").product_search, "search_products");
  });
});
