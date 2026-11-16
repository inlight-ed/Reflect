/**
 * A stand-in for RedStat's MCP server, for browser tests: speaks just enough MCP over Streamable
 * HTTP (JSON responses) and answers the tools Reflect uses with trimmed copies of real answers.
 * The API reaches it only with MCP_ALLOW_PRIVATE=1. Run: node e2e/fake-redstat.mjs 8098
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8098);
const NOTE = 'Октябрь 2026 неполный: сумму этого месяца с соседними не сравнивайте.';
const CATEGORY = 'c3b785adcb6';

const product = (sku) => ({
  sku, name: 'EVO Laboratoires Мочевина 7% крем для рук 100 мл', brand: 'EVO Laboratoires', category_id: CATEGORY,
  category: 'Кремы, масла и сыворотки для тела', price: 1341, revenue: 2042725, orders: 1523, sellers: 29, reviews: 897, rating: 4.9,
  segment: 'Бюджетный', life_stage: 'Старичок', is_branded: 1, kaspi_url: `https://kaspi.kz/shop/p/-${sku}/`, revenue_change_pct: 42.69,
  redstat_link: 'https://app.redstat.kz/kazakhstan/ecom/products/ce74e6fd606e2020',
});
const segment = (index, name, min, max, share, revenue) => ({ segment: index, segment_name: name, sku_count: 872, total_revenue: revenue, avg_price: Math.round((min + max) / 2), min_price: min, max_price: max, avg_merchant_cnt: 2.9, no_brand_pct: 1.2, revenue_share_pct: share });
const months = [
  ['2026-04-01', 348862957, true], ['2026-05-01', 372435784, false], ['2026-06-01', 450096406, true], ['2026-07-01', 442686048, true],
  ['2026-08-01', 364970850, true], ['2026-09-01', 402051532, false], ['2026-10-01', 433323149, false],
];

const tools = {
  search_products: ({ query }) => ({ products: /^\d+$/.test(String(query)) ? [product(String(query))] : [], date: '2026-10-01', note: NOTE }),
  product_sellers: () => ({ sellers: [{ name: 'Магазин А', price: 1290, rating: 4.9, reviews: 120 }, { name: 'Магазин Б', price: 1341 }] }),
  niche_segments: () => ({
    category_id: CATEGORY, name: 'Кремы, масла и сыворотки для тела', date: '2026-10-01', note: NOTE,
    kaspi_link: 'https://kaspi.kz/shop/c/body%20creams/', redstat_link: `https://app.redstat.kz/kazakhstan/ecom/categories/${CATEGORY}`,
    segments: [segment(1, 'Низкий', 186, 1273, 6.6, 28413935), segment(2, 'Бюджетный', 1273, 2122, 9.3, 40473349), segment(3, 'Средний', 2124, 3206, 18.7, 81204058), segment(4, 'Дорогой', 3207, 5143, 23.8, 103045569), segment(5, 'Премиум', 5144, 79935, 41.6, 180186238)],
  }),
  niche_brands: () => ({ name: 'Кремы, масла и сыворотки для тела', date: '2026-10-01', brands: [{ brand: 'MIXIT', revenue: 33089966, orders: 11389, sku_count: 50 }, { brand: 'ERSAG', revenue: 25803000, orders: 5938, sku_count: 44 }, { brand: 'La Roche-Posay', revenue: 18890030, orders: 1813, sku_count: 14 }] }),
  niche_forecast: () => ({
    category_id: CATEGORY, seasonality: { peak_month: 3, season_class: 'moderate_seasonal' },
    forecast_quality: { status: 'not_published', safe_for_decisions: false }, predictions_enabled: false,
    forecast: months.map(([date, revenue, comparable]) => ({ date, value_type: 'fact', revenue, comparable_to_previous: comparable, note: comparable ? 'Календарный месяц' : 'С прошлыми месяцами сумму не сравнивать.' })),
  }),
};

function answer(message) {
  const { id, method, params } = message;
  if (id === undefined) return undefined;
  if (method === 'initialize') return { jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion ?? '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fake-redstat', version: '1.0.0' } } };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: Object.keys(tools).map((name) => ({ name, description: name, inputSchema: { type: 'object' } })) } };
  if (method === 'tools/call') {
    const tool = tools[params?.name];
    if (!tool) return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: 'unknown tool' }] } };
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(tool(params?.arguments ?? {})) }] } };
  }
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
}

createServer((req, res) => {
  if (req.method !== 'POST') { res.writeHead(req.method === 'DELETE' ? 200 : 405).end(); return; }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
    const replies = (Array.isArray(parsed) ? parsed : [parsed]).map(answer).filter(Boolean);
    if (!replies.length) { res.writeHead(202).end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(Array.isArray(parsed) ? replies : replies[0]));
  });
}).listen(port, '127.0.0.1', () => console.log(`fake RedStat MCP on ${port}`));
