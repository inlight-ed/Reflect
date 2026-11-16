/**
 * Deterministic, internally consistent demo catalogue.
 *
 * Each product family has one commercial profile (ROAS, conversion, stock cover,
 * price position, demand trend). Revenue, spend, clicks and stock are derived from
 * that profile, so every number on the screen can be explained by the others.
 */

export type Opportunity = "SCALE" | "FIX" | "DEFEND" | "STOP";

type Family = {
  category: string;
  variants: Array<[name: string, price: number]>;
  monthlyOrders: number;
  roas: number;
  conversion: number;
  stockCoverDays: number;
  competitorPriceRatio: number;
  trend: number;
};

const families: Family[] = [
  {
    category: "Skincare",
    variants: [["L'Oréal Revitalift Serum", 34800], ["L'Oréal Revitalift Filler Serum 50 ml", 46900], ["L'Oréal Revitalift Night Cream 50 ml", 27900]],
    monthlyOrders: 420, roas: 5.8, conversion: 0.052, stockCoverDays: 46, competitorPriceRatio: 1.03, trend: 18,
  },
  {
    category: "Makeup",
    variants: [["Maybelline Sky High Mascara", 12900], ["Maybelline Sky High Mascara Cosmic Black", 13900], ["Maybelline Sky High Mascara Waterproof", 13500]],
    monthlyOrders: 520, roas: 3.0, conversion: 0.021, stockCoverDays: 38, competitorPriceRatio: 1.0, trend: 14,
  },
  {
    category: "Skincare",
    variants: [["La Roche-Posay SPF 50", 18900], ["La Roche-Posay Anthelios Spray SPF 50 200 ml", 24900], ["La Roche-Posay Anthelios Kids SPF 50 75 ml", 16900]],
    monthlyOrders: 380, roas: 4.6, conversion: 0.044, stockCoverDays: 40, competitorPriceRatio: 0.9, trend: 12,
  },
  {
    category: "Beauty tech",
    variants: [["Dyson Airwrap Complete", 289000], ["Dyson Supersonic HD07", 239000], ["Dyson Corrale", 219000]],
    monthlyOrders: 45, roas: 6.2, conversion: 0.046, stockCoverDays: 30, competitorPriceRatio: 1.01, trend: 9,
  },
  {
    category: "Skincare",
    variants: [["CeraVe Moisturizing Cream", 10900], ["CeraVe Hydrating Cleanser 236 ml", 8900], ["CeraVe PM Facial Lotion 52 ml", 9900]],
    monthlyOrders: 610, roas: 4.3, conversion: 0.039, stockCoverDays: 5, competitorPriceRatio: 1.0, trend: 10,
  },
  {
    category: "Makeup",
    variants: [["MAC Ruby Woo", 17500], ["MAC Matte Lipstick Velvet Teddy", 17500], ["MAC Studio Fix Fluid SPF 15", 24900]],
    monthlyOrders: 260, roas: 3.3, conversion: 0.022, stockCoverDays: 50, competitorPriceRatio: 0.99, trend: 6,
  },
  {
    category: "Haircare",
    variants: [["Olaplex No.3 Hair Perfector", 22900], ["Olaplex No.4 Bond Maintenance Shampoo", 21900], ["Olaplex No.7 Bonding Oil", 19900]],
    monthlyOrders: 300, roas: 5.9, conversion: 0.048, stockCoverDays: 35, competitorPriceRatio: 1.02, trend: 15,
  },
  {
    category: "Wellness",
    variants: [["Philips Sonicare 4100", 34900], ["Philips Sonicare 6100", 52900], ["Philips Sonicare W2 Optimal heads ×4", 14900]],
    monthlyOrders: 150, roas: 3.9, conversion: 0.034, stockCoverDays: 33, competitorPriceRatio: 0.91, trend: 8,
  },
  {
    category: "Skincare",
    variants: [["The Ordinary Niacinamide", 8200], ["The Ordinary Hyaluronic Acid 2% + B5", 7900], ["The Ordinary AHA 30% + BHA 2%", 8900]],
    monthlyOrders: 700, roas: 4.9, conversion: 0.041, stockCoverDays: 5, competitorPriceRatio: 1.0, trend: 16,
  },
  {
    category: "Haircare",
    variants: [["Kérastase Genesis Shampoo", 26500], ["Kérastase Elixir Ultime Oil", 32900], ["Kérastase Nutritive Masque", 29500]],
    monthlyOrders: 210, roas: 5.6, conversion: 0.043, stockCoverDays: 28, competitorPriceRatio: 1.0, trend: 11,
  },
];

// Variant 1 is the hero SKU; the others sell less and drift slightly from its profile.
const variantShape = [
  { orders: 1, roas: 1, conversion: 1, cover: 1, trend: 0 },
  { orders: 0.55, roas: 0.96, conversion: 0.95, cover: 1.2, trend: -3 },
  { orders: 0.32, roas: 1.05, conversion: 1.04, cover: 0.85, trend: 2 },
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
  family.variants.map(([name, price], variantIndex) => {
    const shape = variantShape[variantIndex];
    const orders = Math.round(family.monthlyOrders * shape.orders);
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
