/**
 * Deterministic, internally consistent demo catalogue of a Cosmart-like cosmetics store on Kaspi.
 *
 * Assortment follows the brands Cosmart sells (cosmart.kz). Product names, prices and Kaspi-wide
 * monthly orders are RedStat figures for September 2026; the store is assumed to take SHOP_SHARE of
 * each card's Kaspi orders, as a leading seller would. RedStat has no per-store sales, so the store
 * volume is an estimate. ROAS, conversion, stock cover and trend are modelled per product family,
 * and revenue, spend, clicks and stock are derived from them, so every number can be explained by
 * the others.
 */

export type Opportunity = "SCALE" | "FIX" | "DEFEND" | "STOP";

/** Share of each card's Kaspi orders the demo store takes. */
export const SHOP_SHARE = 0.12;

/** Month the RedStat prices and demand were taken from. */
export const DEMO_SOURCE_MONTH = "2026-09";

type Family = {
  category: string;
  /** Product name, average Kaspi price (₸), Kaspi-wide orders per month (RedStat). */
  variants: Array<[name: string, price: number, kaspiOrders: number]>;
  roas: number;
  conversion: number;
  stockCoverDays: number;
  competitorPriceRatio: number;
  trend: number;
};

const families: Family[] = [
  {
    category: "Skincare",
    variants: [["L'Oréal Paris Revitalift Filler Glass Skin крем-флюид 50 мл", 6666, 95], ["L'Oréal Paris Revitalift Лазер х3 ночная крем-маска 50 мл", 8173, 59], ["L'Oréal Paris Revitalift Витамин С флюид 50 мл", 6973, 39]],
    roas: 5.8, conversion: 0.052, stockCoverDays: 46, competitorPriceRatio: 1.03, trend: 18,
  },
  {
    category: "Makeup",
    variants: [["Maybelline Lash Sensational Sky High тушь, чёрная", 3989, 527], ["Maybelline Sky High тушь для объёма, коричневая", 4166, 219], ["Maybelline Sky High Cosmic Black тушь", 4216, 146]],
    roas: 3.0, conversion: 0.021, stockCoverDays: 38, competitorPriceRatio: 1.0, trend: 14,
  },
  {
    category: "Skincare",
    variants: [["La Roche-Posay Anthelios UVmune 400 флюид SPF 50+ 50 мл", 10241, 401], ["La Roche-Posay Effaclar Duo+ M крем-гель 40 мл", 8705, 336], ["La Roche-Posay Cicaplast B5+ бальзам 40 мл", 7328, 419]],
    roas: 4.6, conversion: 0.044, stockCoverDays: 40, competitorPriceRatio: 0.9, trend: 12,
  },
  {
    category: "Dermocosmetics",
    variants: [["Avène XeraCalm A.D липидовосполняющий крем 200 мл", 11974, 453], ["Avène Cleanance Hydra успокаивающий крем 40 мл", 9552, 337], ["Avène Cleanance очищающий гель 400 мл", 10354, 241]],
    roas: 6.2, conversion: 0.046, stockCoverDays: 30, competitorPriceRatio: 1.01, trend: 9,
  },
  {
    category: "Skincare",
    variants: [["CeraVe очищающий гель для нормальной и жирной кожи 473 мл", 6414, 1318], ["CeraVe увлажняющий крем для сухой кожи 340 г", 4819, 1060], ["CeraVe увлажняющий очищающий крем-гель 236 мл", 4148, 789]],
    roas: 4.3, conversion: 0.039, stockCoverDays: 5, competitorPriceRatio: 1.0, trend: 10,
  },
  {
    category: "Makeup",
    variants: [["Max Factor Facefinity Lasting Performance тональный крем 100 Fair", 8272, 33], ["Max Factor Facefinity Lasting Performance тональный крем 105 Soft Beige", 8123, 17], ["Max Factor Facefinity Compact пудра 02 Ivory", 9524, 13]],
    roas: 3.3, conversion: 0.022, stockCoverDays: 50, competitorPriceRatio: 0.99, trend: 6,
  },
  {
    category: "Haircare",
    variants: [["L'Oréal Paris Elseve Коллаген спрей 200 мл", 4880, 460], ["L'Oréal Paris Elseve Экстраординарное масло 100 мл", 3658, 501], ["L'Oréal Paris Elseve Длина мечты крем 200 мл", 3548, 369]],
    roas: 5.9, conversion: 0.048, stockCoverDays: 35, competitorPriceRatio: 1.02, trend: 15,
  },
  {
    category: "Body care",
    variants: [["NIVEA Creme крем 150 мл", 1528, 266], ["NIVEA Soft крем 200 мл", 1668, 232], ["NIVEA Крем и Роза гель для душа 500 мл", 2289, 166]],
    roas: 3.9, conversion: 0.034, stockCoverDays: 33, competitorPriceRatio: 0.91, trend: 8,
  },
  {
    category: "Skincare",
    variants: [["Garnier мицеллярная вода 3 в 1, 400 мл", 2380, 636], ["Garnier мицеллярная вода Бережная формула 125 мл", 1488, 748], ["Garnier мицеллярная вода Гиалуроновая Алоэ 400 мл", 2410, 162]],
    roas: 4.9, conversion: 0.041, stockCoverDays: 5, competitorPriceRatio: 1.0, trend: 16,
  },
  {
    category: "Haircare",
    variants: [["Gliss Kur Экстремальное восстановление спрей-кондиционер 200 мл", 2690, 204], ["Gliss Kur Густые и крепкие спрей-кондиционер 200 мл", 2609, 115], ["Gliss Kur Экстремальное восстановление шампунь 400 мл", 3017, 65]],
    roas: 5.6, conversion: 0.043, stockCoverDays: 28, competitorPriceRatio: 1.0, trend: 11,
  },
];

// Variants drift slightly from their family profile.
const variantShape = [
  { roas: 1, conversion: 1, cover: 1, trend: 0 },
  { roas: 0.96, conversion: 0.95, cover: 1.2, trend: -3 },
  { roas: 1.05, conversion: 1.04, cover: 0.85, trend: 2 },
];

export const opportunityRules = {
  minStockCoverDays: 7,
  defendPriceGap: 0.95,
  fixConversion: 0.025,
  scaleRoas: 5,
  scaleConversion: 0.04,
};

export function classifyOpportunity(input: { stockCoverDays: number; competitorPrice: number; price: number; conversion: number; roas: number }): Opportunity {
  if (input.stockCoverDays < opportunityRules.minStockCoverDays) return "STOP";
  if (input.competitorPrice < input.price * opportunityRules.defendPriceGap) return "DEFEND";
  if (input.conversion < opportunityRules.fixConversion) return "FIX";
  if (input.roas >= opportunityRules.scaleRoas && input.conversion >= opportunityRules.scaleConversion) return "SCALE";
  return input.conversion < 0.03 ? "FIX" : "SCALE";
}

const round = (value: number, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const demoProducts = families.flatMap((family, familyIndex) =>
  family.variants.map(([name, price, kaspiOrders], variantIndex) => {
    const shape = variantShape[variantIndex];
    const orders = Math.max(1, Math.round(kaspiOrders * SHOP_SHARE));
    const conversion = round(family.conversion * shape.conversion, 4);
    const roas = round(family.roas * shape.roas, 2);
    const revenue = orders * price;
    const spend = Math.round(revenue / roas);
    const clicks = Math.round(orders / conversion);
    const stockCoverDays = Math.max(1, Math.round(family.stockCoverDays * shape.cover));
    const stock = Math.round((orders / 30) * stockCoverDays);
    const competitorPrice = Math.round(price * family.competitorPriceRatio);
    const trend = family.trend + shape.trend;
    return {
      sku: `SH-${2401 + familyIndex * 3 + variantIndex}`,
      name,
      category: family.category,
      revenue,
      orders,
      units: Math.round(orders * 1.1),
      aov: price,
      conversion,
      clicks,
      spend,
      roas,
      stock,
      stockCoverDays,
      price,
      competitorPrice,
      trend,
      opportunity: classifyOpportunity({ stockCoverDays, competitorPrice, price, conversion, roas }),
    };
  }),
);

export type DemoProduct = (typeof demoProducts)[number];

export function findDemoProduct(name: string): DemoProduct {
  const product = demoProducts.find((item) => item.name === name);
  if (!product) throw new Error(`Unknown demo product: ${name}`);
  return product;
}

export const accountTotals = (() => {
  const revenue = demoProducts.reduce((sum, product) => sum + product.revenue, 0);
  const spend = demoProducts.reduce((sum, product) => sum + product.spend, 0);
  const orders = demoProducts.reduce((sum, product) => sum + product.orders, 0);
  const clicks = demoProducts.reduce((sum, product) => sum + product.clicks, 0);
  const stockWeighted = demoProducts.reduce((sum, product) => sum + product.stockCoverDays * product.revenue, 0);
  return {
    revenue,
    spend,
    orders,
    clicks,
    roas: revenue / spend,
    conversion: orders / clicks,
    averageClicks: clicks / demoProducts.length,
    stockCoverDays: Math.round(stockWeighted / revenue),
  };
})();
