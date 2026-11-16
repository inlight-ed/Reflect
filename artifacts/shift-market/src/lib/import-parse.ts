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

/** Picks the delimiter from the first line, ignoring anything inside quotes. */
function detectDelimiter(text: string) {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char in counts) counts[char] += 1;
    else if (!quoted && (char === '\n' || char === '\r')) break;
  }
  const best = Object.entries(counts).sort((left, right) => right[1] - left[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

/** RFC 4180 style parser: quoted cells may contain delimiters, doubled quotes and line breaks. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let cells: string[] = [];
  let current = '';
  let quoted = false;
  const endRow = () => {
    cells.push(current.trim());
    current = '';
    if (cells.some((cell) => cell !== '')) rows.push(cells);
    cells = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { current += '"'; index += 1; } else quoted = false;
      } else current += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { cells.push(current.trim()); current = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      endRow();
    } else current += char;
  }
  endRow();
  return rows;
}

function csvRows(text: string) {
  const [headers = [], ...body] = parseCsv(text);
  return body.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
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
