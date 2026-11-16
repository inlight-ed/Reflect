import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCsv } from '../lib/import-parse';

describe('parseCsv', () => {
  it('handles quoted cells with delimiters, doubled quotes and line breaks', () => {
    const rows = parseCsv('Артикул;Название;Сумма\r\nA1;"Крем; 50 мл";1000\r\nA2;"Строка 1\nстрока ""2""";2000\r\n');
    assert.deepEqual(rows, [['Артикул', 'Название', 'Сумма'], ['A1', 'Крем; 50 мл', '1000'], ['A2', 'Строка 1\nстрока "2"', '2000']]);
  });

  it('detects comma, semicolon and tab delimiters, ignoring quoted ones in the header', () => {
    assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
    assert.deepEqual(parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
    assert.deepEqual(parseCsv('"a,b";c\n1;2'), [['a,b', 'c'], ['1', '2']]);
  });

  it('skips blank lines, strips the BOM and keeps a last row without a trailing newline', () => {
    assert.deepEqual(parseCsv('﻿a,b\n\n1,2'), [['a', 'b'], ['1', '2']]);
  });
});
