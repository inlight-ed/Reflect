// A stand-in for the Kaspi Merchant API in browser tests: accepts the token "test-kaspi-token",
// answers order lists for archived orders (3 a day) and their entries. Start with
//   node e2e/fake-kaspi.mjs 8099   and run the API with KASPI_API_BASE=http://127.0.0.1:8099/shop/api/v2
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8099);
const DAY = 86_400_000;
const products = [
  { code: 'FX-1', name: 'Крем для рук 75 мл', price: 3900 },
  { code: 'FX-2', name: 'Бальзам для губ', price: 2500 },
  { code: 'FX-3', name: 'Сыворотка для лица 30 мл', price: 8700 },
];
const startOfDay = (ms) => Math.floor(ms / DAY) * DAY;

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/vnd.api+json' }); res.end(JSON.stringify(body)); };
  if (req.headers['x-auth-token'] !== 'test-kaspi-token') return send(401, { errors: [{ title: 'Unauthorized' }] });

  const entries = url.pathname.match(/\/orders\/([^/]+)\/entries$/);
  if (entries) {
    const index = Number(entries[1].split('-')[2] ?? 0);
    const product = products[index % products.length];
    const quantity = 1 + (index % 2);
    return send(200, { data: [{ id: `${entries[1]}-e`, type: 'orderentries', attributes: { quantity, totalPrice: product.price * quantity, offer: { code: product.code, name: product.name } } }] });
  }
  if (url.pathname.endsWith('/orders')) {
    if (url.searchParams.get('filter[orders][state]') !== 'ARCHIVE' || url.searchParams.get('page[number]') !== '0') return send(200, { data: [] });
    const from = Number(url.searchParams.get('filter[orders][creationDate][$ge]'));
    const to = Number(url.searchParams.get('filter[orders][creationDate][$le]') ?? Date.now());
    const data = [];
    for (let day = startOfDay(from); day <= to; day += DAY) {
      for (let index = 0; index < 3; index += 1) {
        const created = day + (9 + index * 3) * 3_600_000;
        if (created < from || created > to || created > Date.now()) continue;
        data.push({ id: `${day / DAY}-o-${index}`, type: 'orders', attributes: { code: `K${day / DAY}${index}`, creationDate: created, state: 'ARCHIVE', status: 'COMPLETED' } });
      }
    }
    return send(200, { data, meta: { pageCount: 1 } });
  }
  return send(404, { errors: [{ title: 'Not found' }] });
}).listen(port, '127.0.0.1', () => console.log(`fake Kaspi on ${port}`));
