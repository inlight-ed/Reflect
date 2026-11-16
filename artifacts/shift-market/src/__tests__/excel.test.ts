import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as XLSX from 'xlsx';
import { parseFile } from '../lib/import-parse';

/** Builds a Kaspi-like export with a title block above the header, the way the cabinet saves it. */
function workbookBytes(bookType: 'xlsx' | 'xls') {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Отчёт по заказам'],
    [],
    ['№ заказа', 'Дата поступления заказа', 'Артикул', 'Название товара в Kaspi Магазине', 'Количество', 'Сумма'],
    ['800001', '02.08.2026 15:04', 'FX-1', 'Крем для рук 75 мл', 2, 7800],
    ['800002', '03.08.2026 10:00', 'FX-2', 'Бальзам для губ', 1, 2500],
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Заказы');
  return XLSX.write(book, { type: 'array', bookType }) as ArrayBuffer;
}

describe('Excel import', () => {
  for (const format of ['xlsx', 'xls'] as const) {
    it(`reads .${format} files and finds the header below the title block`, async () => {
      const file = new File([workbookBytes(format)], `orders.${format}`);
      const [sheet] = await parseFile(file);
      assert.equal(sheet.sheet, 'Заказы');
      assert.equal(sheet.rows.length, 2);
      assert.equal(sheet.rows[0]['Артикул'], 'FX-1');
      assert.equal(Number(sheet.rows[1]['Сумма']), 2500);
    });
  }
});
