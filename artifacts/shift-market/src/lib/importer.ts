/**
 * Reads seller files in the browser and turns them into rows for /api/data/import.
 * Parsing runs in a Web Worker (import.worker.ts); detection and mapping stay here.
 *
 * Every sheet is matched against three datasets by its column names:
 *  - ORDERS   — a Kaspi orders export or the template's "Продажи" sheet;
 *  - PRODUCTS — cost price, stock, lead time, commission (template "Товары", 1С / МойСклад exports);
 *  - ADS      — ad spend by day (template "Реклама").
 * Auto-detection only proposes a mapping; the person confirms or corrects it before import.
 */
import type { AdRowInput, OrderRowInput, ProductRowInput } from '@workspace/api-client-react';
import { assertImportable, parseFile, type RawSheet } from './import-parse';
import type { WorkerReply } from './import.worker';

export type Dataset = 'ORDERS' | 'PRODUCTS' | 'ADS';

export type FieldSpec = { key: string; required: boolean; aliases: string[]; numeric?: boolean };

export const FIELDS: Record<Dataset, FieldSpec[]> = {
  ORDERS: [
    { key: 'orderCode', required: false, aliases: ['№ заказа', 'номер заказа', 'код заказа', 'заказ', 'order', 'order code', 'order number', 'тапсырыс нөмірі'] },
    { key: 'orderedAt', required: true, aliases: ['дата поступления заказа', 'дата заказа', 'дата создания', 'дата', 'дата оформления', 'date', 'created', 'creation date', 'күні'] },
    { key: 'sku', required: true, aliases: ['артикул', 'артикул продавца', 'sku', 'код товара', 'код товара в магазине', 'артикул товара', 'product code', 'vendor code'] },
    { key: 'productName', required: false, aliases: ['название товара в kaspi магазине', 'название товара', 'наименование', 'товар', 'название', 'product', 'product name', 'тауар атауы'] },
    { key: 'quantity', required: true, numeric: true, aliases: ['количество', 'кол-во', 'количество товара', 'qty', 'quantity', 'саны'] },
    { key: 'amount', required: true, numeric: true, aliases: ['сумма', 'стоимость', 'сумма заказа', 'итого', 'цена', 'total', 'amount', 'price', 'сомасы', 'бағасы'] },
    { key: 'status', required: false, aliases: ['статус', 'статус заказа', 'status', 'state', 'күйі'] },
  ],
  PRODUCTS: [
    { key: 'sku', required: true, aliases: ['артикул', 'sku', 'код товара', 'код', 'артикул продавца', 'vendor code'] },
    { key: 'name', required: false, aliases: ['название', 'наименование', 'товар', 'name', 'product', 'атауы'] },
    { key: 'category', required: false, aliases: ['категория', 'группа', 'category', 'санат'] },
    { key: 'kaspiCode', required: false, aliases: ['код товара kaspi', 'kaspi код', 'код kaspi', 'master sku', 'kaspi sku', 'kaspi code'] },
    { key: 'costPrice', required: false, numeric: true, aliases: ['себестоимость', 'себестоимость за шт', 'закупочная цена', 'закупка', 'cost', 'cost price', 'өзіндік құны'] },
    { key: 'stock', required: false, numeric: true, aliases: ['остаток', 'остатки', 'количество на складе', 'склад', 'stock', 'qty in stock', 'қалдық'] },
    { key: 'leadTimeDays', required: false, numeric: true, aliases: ['срок поставки, дней', 'срок поставки', 'поставка дней', 'lead time', 'lead time days', 'жеткізу мерзімі'] },
    { key: 'commissionPct', required: false, numeric: true, aliases: ['комиссия kaspi, %', 'комиссия kaspi', 'комиссия', 'commission', 'commission %', 'комиссия, %'] },
  ],
  ADS: [
    { key: 'day', required: true, aliases: ['дата', 'день', 'месяц', 'date', 'day', 'month', 'күні'] },
    { key: 'sku', required: false, aliases: ['артикул', 'sku', 'код товара'] },
    { key: 'channel', required: false, aliases: ['канал', 'площадка', 'channel', 'source', 'арна'] },
    { key: 'spend', required: true, numeric: true, aliases: ['расход', 'расходы', 'затраты', 'бюджет', 'spend', 'cost', 'шығын'] },
  ],
};

export type Mapping = Record<string, string | undefined>;
export type SheetCandidate = { sheet: string; headers: string[]; rows: Array<Record<string, unknown>>; dataset: Dataset | undefined; mapping: Mapping; confidence: number; isKaspi: boolean };

const norm = (value: unknown) => String(value ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').replace(/[«»"]/g, '').trim();

function matchMapping(headers: string[], dataset: Dataset): { mapping: Mapping; score: number } {
  const mapping: Mapping = {};
  const used = new Set<string>();
  let score = 0;
  for (const field of FIELDS[dataset]) {
    const aliases = field.aliases.map(norm);
    // Aliases are ordered by preference: "Сумма" wins over "Цена" when a file has both.
    let exact: string | undefined;
    for (const alias of aliases) {
      exact = headers.find((header) => !used.has(header) && norm(header) === alias);
      if (exact) break;
    }
    const partial = exact ?? headers.find((header) => !used.has(header) && aliases.some((alias) => alias.length > 3 && norm(header).includes(alias)));
    if (partial) {
      mapping[field.key] = partial;
      used.add(partial);
      score += (field.required ? 3 : 1) * (exact ? 1 : 0.6);
    }
  }
  const requiredMissing = FIELDS[dataset].filter((field) => field.required && !mapping[field.key]).length;
  return { mapping, score: requiredMissing ? score / (1 + requiredMissing * 2) : score };
}

const SHEET_HINTS: Record<Dataset, RegExp> = { ORDERS: /(заказ|продаж|order|sale|тапсырыс|сату)/i, PRODUCTS: /(товар|product|остат|stock|тауар)/i, ADS: /(реклам|ads|advert|жарнама)/i };

export function detect(sheet: string, rows: Array<Record<string, unknown>>): SheetCandidate {
  const headers = Object.keys(rows[0] ?? {}).filter((header) => header && !header.startsWith('__EMPTY'));
  let best: { dataset: Dataset | undefined; mapping: Mapping; score: number } = { dataset: undefined, mapping: {}, score: 0 };
  for (const dataset of ['ORDERS', 'PRODUCTS', 'ADS'] as Dataset[]) {
    const { mapping, score } = matchMapping(headers, dataset);
    const boosted = score + (SHEET_HINTS[dataset].test(sheet) ? 1.5 : 0);
    if (boosted > best.score) best = { dataset, mapping, score: boosted };
  }
  const requiredOk = best.dataset ? FIELDS[best.dataset].every((field) => !field.required || best.mapping[field.key]) : false;
  const statusValues = best.mapping.status ? rows.slice(0, 50).map((row) => norm(row[best.mapping.status!])) : [];
  const isKaspi = best.dataset === 'ORDERS' && (headers.some((header) => /kaspi/i.test(header)) || statusValues.some((value) => /(выдан|передан на доставку|kaspi доставка|ожидает)/.test(value)));
  return { sheet, headers, rows, dataset: requiredOk ? best.dataset : best.score > 2 ? best.dataset : undefined, mapping: best.mapping, confidence: Math.min(1, best.score / 14), isKaspi };
}

export function remap(candidate: SheetCandidate, dataset: Dataset): SheetCandidate {
  return { ...candidate, dataset, mapping: matchMapping(candidate.headers, dataset).mapping };
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').replace(/[\s ]/g, '').replace(/[₸%]|тг|kzt/gi, '');
  if (!text) return null;
  const normalized = /,\d{1,2}$/.test(text) && !/\.\d/.test(text) ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value.toISOString();
  const text = String(value).trim();
  return text || null;
}

export type MissingField = { key: string };

export function missingRequired(candidate: SheetCandidate): string[] {
  if (!candidate.dataset) return [];
  return FIELDS[candidate.dataset].filter((field) => field.required && !candidate.mapping[field.key]).map((field) => field.key);
}

export function buildRows(candidate: SheetCandidate): { orders?: OrderRowInput[]; products?: ProductRowInput[]; ads?: AdRowInput[]; valid: number } {
  const get = (row: Record<string, unknown>, key: string) => (candidate.mapping[key] ? row[candidate.mapping[key]!] : undefined);
  if (candidate.dataset === 'ORDERS') {
    const orders = candidate.rows.map((row): OrderRowInput | undefined => {
      const orderedAt = toText(get(row, 'orderedAt'));
      const sku = toText(get(row, 'sku'));
      const quantity = toNumber(get(row, 'quantity')) ?? 1;
      const amount = toNumber(get(row, 'amount'));
      if (!orderedAt || !sku || amount === null || amount < 0 || amount > 1e10 || quantity < 0 || quantity > 1e7) return undefined;
      return { orderCode: toText(get(row, 'orderCode')), orderedAt: orderedAt.slice(0, 40), sku: sku.slice(0, 120), productName: toText(get(row, 'productName'))?.slice(0, 400) ?? null, quantity, amount, status: toText(get(row, 'status'))?.slice(0, 80) ?? null };
    }).filter((row): row is OrderRowInput => Boolean(row));
    return { orders, valid: orders.length };
  }
  if (candidate.dataset === 'PRODUCTS') {
    const products = candidate.rows.map((row): ProductRowInput | undefined => {
      const sku = toText(get(row, 'sku'));
      if (!sku) return undefined;
      const commission = toNumber(get(row, 'commissionPct'));
      return {
        sku: sku.slice(0, 120),
        name: toText(get(row, 'name'))?.slice(0, 400) ?? null,
        category: toText(get(row, 'category'))?.slice(0, 200) ?? null,
        kaspiCode: toText(get(row, 'kaspiCode'))?.slice(0, 60) ?? null,
        costPrice: toNumber(get(row, 'costPrice')),
        stock: toNumber(get(row, 'stock')),
        leadTimeDays: toNumber(get(row, 'leadTimeDays')),
        commissionPct: commission !== null && commission > 0 && commission < 1 ? commission * 100 : commission,
      };
    }).filter((row): row is ProductRowInput => Boolean(row));
    return { products, valid: products.length };
  }
  if (candidate.dataset === 'ADS') {
    const ads = candidate.rows.map((row): AdRowInput | undefined => {
      const day = toText(get(row, 'day'));
      const spend = toNumber(get(row, 'spend'));
      if (!day || spend === null) return undefined;
      return { day: day.slice(0, 40), sku: toText(get(row, 'sku'))?.slice(0, 120) ?? null, channel: toText(get(row, 'channel'))?.slice(0, 80) ?? null, spend };
    }).filter((row): row is AdRowInput => Boolean(row));
    return { ads, valid: ads.length };
  }
  return { valid: 0 };
}

export { MAX_FILE_BYTES } from './import-parse';

class WorkerUnavailable extends Error {}

/** Parses in a Web Worker; resolves sheets or rejects with an i18n key. */
function parseInWorker(file: File): Promise<RawSheet[]> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      reject(new WorkerUnavailable());
      return;
    }
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      worker.terminate();
      if (event.data.ok) resolve(event.data.sheets);
      else reject(new Error(event.data.message));
    };
    // The worker script itself failed to load or crashed: parse on the main thread instead.
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      reject(new WorkerUnavailable());
    };
    worker.postMessage(file);
  });
}

export async function readFile(file: File): Promise<SheetCandidate[]> {
  assertImportable(file);
  let sheets: RawSheet[];
  if (typeof Worker === 'undefined') sheets = await parseFile(file);
  else {
    try {
      sheets = await parseInWorker(file);
    } catch (error) {
      if (!(error instanceof WorkerUnavailable)) throw error;
      sheets = await parseFile(file);
    }
  }
  return sheets.map((sheet) => detect(sheet.sheet, sheet.rows));
}
