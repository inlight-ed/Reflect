
/**
 * Parses a brand's orders report (CSV/XLSX) entirely in the browser.
 *
 * Two layouts are recognised:
 *  - long:  one row per period × partner, with a partner column and an orders column;
 *  - wide:  one row per period, with one numeric column per partner (or a single orders column).
 * Partner names come from the file itself, so any distributor, store or channel works.
 */

export const TOTAL_SERIES = "__total__";
export const OTHER_SERIES = "__other__";
export const MAX_SERIES = 8;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type SalesSeries = { key: string; label: string };

export type SalesPoint = {
  period: string;
  sortKey: number;
  total: number;
  [seriesKey: string]: number | string;
};

export type ImportedSalesReport = {
  fileName: string;
  uploadedAt: string;
  rowsProcessed: number;
  series: SalesSeries[];
  points: SalesPoint[];
};

type Row = Record<string, unknown>;

const periodAliases = ["period", "date", "month", "week", "day", "дата", "период", "месяц", "неделя", "день", "күн", "ай", "кезең"];
const partnerAliases = ["distributor", "retailer", "store", "partner", "channel", "seller", "дистрибьютор", "ритейлер", "магазин", "партнер", "канал", "продавец", "дистрибьютер", "серіктес", "дүкен", "арна"];
const orderAliases = ["orders", "order", "orderqty", "quantity", "qty", "sales", "заказы", "заказ", "количество", "продажи", "тапсырыстар", "сату", "саны"];

// Spelling variants of partners this brand already works with; unknown names are kept as written.
const knownPartners: Record<string, string[]> = {
  MonAmie: ["monamie", "мон ами", "монами"],
  Magnum: ["magnum", "магнум"],
  Cosmart: ["cosmart", "космарт"],
  "Французский дом": ["французский дом", "france house", "french house"],
};

function normalize(value: unknown) {
  return String(value ?? "")
    .toLocaleLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-яәіңғүұқөһ0-9]+/gi, "");
}

function findKey(row: Row, aliases: string[]) {
  return Object.keys(row).find((key) => aliases.includes(normalize(key)));
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const text = String(value ?? "").replace(/[\s ]/g, "").replace(/[₸$€]/g, "");
  if (!text) return undefined;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function partnerLabel(value: unknown): string | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const normalized = normalize(raw);
  const known = Object.entries(knownPartners).find(([, aliases]) => aliases.some((alias) => normalize(alias) === normalized));
  return known ? known[0] : raw;
}

function periodValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return { label: value.toISOString().slice(0, 10), sortKey: value.valueOf() };
  }
  const text = String(value ?? "").trim();
  const dotted = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  const iso = dotted ? `${dotted[3]}-${dotted[2].padStart(2, "0")}-${dotted[1].padStart(2, "0")}` : text;
  const parsed = new Date(iso);
  if (iso && !Number.isNaN(parsed.valueOf())) {
    return { label: parsed.toISOString().slice(0, 10), sortKey: parsed.valueOf() };
  }
  return text ? { label: text, sortKey: Number.MAX_SAFE_INTEGER } : undefined;
}

/** Collects orders per period and partner label. */
function collect(rows: Row[]) {
  const byPeriod = new Map<string, { label: string; sortKey: number; values: Map<string, number> }>();
  // The same partner spelled differently ("Sulpak" / "sulpak ") is one series, labelled as first seen.
  const canonical = new Map<string, string>();
  const unify = (label: string) => {
    const key = normalize(label) || label;
    if (!canonical.has(key)) canonical.set(key, label);
    return canonical.get(key)!;
  };
  const sample = rows[0] ?? {};
  const periodKey = findKey(sample, periodAliases);
  if (!periodKey) return byPeriod;
  const partnerKey = findKey(sample, partnerAliases);
  const ordersKey = findKey(sample, orderAliases);

  // Wide layout: every other column that is mostly numeric is a partner (or the single orders column).
  const wideColumns = partnerKey
    ? []
    : Object.keys(sample).filter((key) => key !== periodKey && rows.slice(0, 50).filter((row) => asNumber(row[key]) !== undefined).length >= Math.min(rows.length, 50) * 0.6);

  for (const row of rows) {
    const period = periodValue(row[periodKey]);
    if (!period) continue;
    const mapKey = `${period.sortKey}-${period.label}`;
    const entry = byPeriod.get(mapKey) ?? { label: period.label, sortKey: period.sortKey, values: new Map<string, number>() };
    const add = (label: string, amount: number | undefined) => {
      if (amount === undefined || amount <= 0) return;
      entry.values.set(label, (entry.values.get(label) ?? 0) + amount);
    };

    if (partnerKey && ordersKey) {
      const label = partnerLabel(row[partnerKey]);
      if (label) add(unify(label), asNumber(row[ordersKey]));
    } else if (wideColumns.length === 1 || (ordersKey && wideColumns.includes(ordersKey) && wideColumns.length === 1)) {
      add(TOTAL_SERIES, asNumber(row[wideColumns[0]]));
    } else {
      for (const column of wideColumns) add(unify(partnerLabel(column) ?? column), asNumber(row[column]));
    }
    if (entry.values.size) byPeriod.set(mapKey, entry);
  }
  return byPeriod;
}

export function rowsToReport(rows: Row[]): Pick<ImportedSalesReport, "series" | "points"> {
  const collected = [...collect(rows).values()].sort((a, b) => a.sortKey - b.sortKey);

  const volume = new Map<string, number>();
  for (const period of collected) for (const [label, amount] of period.values) volume.set(label, (volume.get(label) ?? 0) + amount);
  const ranked = [...volume.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);
  const kept = ranked.length > MAX_SERIES ? ranked.slice(0, MAX_SERIES - 1) : ranked;
  const hasOther = ranked.length > kept.length;
  const series: SalesSeries[] = [...kept, ...(hasOther ? [OTHER_SERIES] : [])].map((label, index) => ({ key: `s${index}`, label }));
  const keyOf = new Map(series.map((item) => [item.label, item.key]));
  const otherKey = keyOf.get(OTHER_SERIES);

  const points: SalesPoint[] = collected.map((period) => {
    const point: SalesPoint = { period: period.label, sortKey: period.sortKey, total: 0 };
    for (const item of series) point[item.key] = 0;
    for (const [label, amount] of period.values) {
      const key = keyOf.get(label) ?? otherKey;
      if (!key) continue;
      point[key] = (point[key] as number) + amount;
      point.total += amount;
    }
    return point;
  }).filter((point) => point.total > 0);

  return { series, points };
}

function csvRows(text: string) {
  const head = text.split("\n").slice(0, 3).join("\n");
  const delimiter = head.split(";").length > head.split(",").length ? ";" : head.includes("\t") ? "\t" : ",";
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
  const parseLine = (line: string) => {
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (quoted && line[index + 1] === '"') { current += '"'; index += 1; }
        else quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        cells.push(current.trim()); current = "";
      } else current += char;
    }
    cells.push(current.trim());
    return cells;
  };
  const headers = parseLine(lines[0] ?? "");
  return lines.slice(1).map((line) => {
    const cells = parseLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

export async function parseSalesReport(file: File): Promise<ImportedSalesReport> {
  if (file.size > MAX_FILE_BYTES) throw new Error("Файл слишком большой. Максимум 10 МБ.");
  const extension = file.name.split(".").pop()?.toLowerCase();
  let rows: Row[];

  if (extension === "csv") rows = csvRows(await file.text());
  else if (extension === "xlsx" || extension === "xls") {
    // Loaded only when someone uploads a spreadsheet: the library is large.
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) throw new Error("В файле нет листа с данными.");
    rows = XLSX.utils.sheet_to_json<Row>(workbook.Sheets[firstSheet], { defval: "" });
  } else throw new Error("Поддерживаются только файлы CSV, XLSX и XLS.");

  const { series, points } = rowsToReport(rows);
  if (!points.length) {
    throw new Error("Не удалось найти строки с периодом и количеством заказов. Добавьте колонки «Дата/Период», «Заказы» и «Дистрибьютор» или отдельные колонки дистрибьюторов.");
  }

  return { fileName: file.name, uploadedAt: new Date().toISOString(), rowsProcessed: rows.length, series, points };
}

export function isImportedSalesReport(value: unknown): value is ImportedSalesReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<ImportedSalesReport>;
  return typeof report.fileName === "string"
    && typeof report.uploadedAt === "string"
    && typeof report.rowsProcessed === "number"
    && Array.isArray(report.series)
    && report.series.every((item) => item && typeof item.key === "string" && typeof item.label === "string")
    && Array.isArray(report.points)
    && report.points.every((point) => point
      && typeof point.period === "string"
      && typeof point.sortKey === "number"
      && typeof point.total === "number"
      && report.series!.every((item) => typeof point[item.key] === "number"));
}

// Six monthly periods ending with the current month, so the demo never looks stale.
const demoMonths = Array.from({ length: 6 }, (_, index) => {
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + index, 1));
  return month.toISOString().slice(0, 10);
});

const demoRows: Row[] = [
  [620, 710, 480, 330],
  [690, 770, 530, 370],
  [720, 810, 560, 390],
  [760, 860, 600, 420],
  [830, 940, 650, 450],
  [900, 1010, 700, 480],
].map(([monAmie, magnum, cosmart, frenchHouse], index) => ({ period: demoMonths[index], MonAmie: monAmie, Magnum: magnum, Cosmart: cosmart, "Французский дом": frenchHouse }));

export const demoSalesReport: ImportedSalesReport = {
  fileName: "demo-sales-report.csv",
  uploadedAt: new Date().toISOString(),
  rowsProcessed: 24,
  ...rowsToReport(demoRows),
};
