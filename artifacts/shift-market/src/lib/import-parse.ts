/**
 * Turns a CSV or Excel file into plain rows, one array per sheet. No DOM access, so it runs
 * the same in the import Web Worker and, as a fallback, on the main thread.
 */
export type RawSheet = { sheet: string; rows: Array<Record<string, unknown>> };

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const FORMATS = new Set(['csv', 'txt', 'xlsx', 'xls']);

export function fileExtension(name: string) {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

/** Throws an i18n key when the file cannot be imported at all. */
export function assertImportable(file: { name: string; size: number }) {
  if (file.size > MAX_FILE_BYTES) throw new Error('import.error.tooLarge');
  if (!FORMATS.has(fileExtension(file.name))) throw new Error('import.error.format');
}

function csvRows(text: string) {
  const head = text.split('\n').slice(0, 3).join('\n');
  const delimiter = head.split(';').length > head.split(',').length ? ';' : head.includes('\t') ? '\t' : ',';
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim());
  const parseLine = (line: string) => {
    const cells: string[] = [];
    let current = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (quoted && line[index + 1] === '"') { current += '"'; index += 1; } else quoted = !quoted;
      } else if (char === delimiter && !quoted) { cells.push(current.trim()); current = ''; } else current += char;
    }
    cells.push(current.trim());
    return cells;
  };
  const headers = parseLine(lines[0] ?? '');
  return lines.slice(1).map((line) => {
    const cells = parseLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  });
}

/** Finds the header row in sheets that start with a title block (common in marketplace exports). */
function sheetRows(XLSX: typeof import('xlsx'), sheet: import('xlsx').WorkSheet) {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true });
  let headerIndex = 0;
  for (let index = 0; index < Math.min(matrix.length, 15); index += 1) {
    const filled = (matrix[index] ?? []).filter((cell) => String(cell ?? '').trim()).length;
    if (filled >= 3) { headerIndex = index; break; }
  }
  const headers = (matrix[headerIndex] ?? []).map((cell, index) => String(cell ?? '').trim() || `__EMPTY${index}`);
  return matrix.slice(headerIndex + 1).filter((row) => row.some((cell) => String(cell ?? '').trim())).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

export async function parseFile(file: File): Promise<RawSheet[]> {
  assertImportable(file);
  const extension = fileExtension(file.name);
  if (extension === 'csv' || extension === 'txt') return [{ sheet: file.name, rows: csvRows(await file.text()) }];
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  return workbook.SheetNames.map((name) => ({ sheet: name, rows: sheetRows(XLSX, workbook.Sheets[name]) })).filter((sheet) => sheet.rows.length > 0);
}
