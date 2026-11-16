import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildRows, detect, missingRequired, remap } from '../lib/importer';

const kaspiRows = [
  { '№ заказа': '501', 'Дата поступления заказа': '15.08.2026 10:00', 'Артикул': 'KS-1', 'Название товара в Kaspi магазине': 'Крем', 'Количество': '2', 'Сумма': '12 500,50', 'Статус': 'Выдан' },
  { '№ заказа': '502', 'Дата поступления заказа': '16.08.2026 11:00', 'Артикул': 'KS-2', 'Название товара в Kaspi магазине': 'Сыворотка', 'Количество': '1', 'Сумма': '7 990 ₸', 'Статус': 'Передан на доставку' },
];

describe('detect', () => {
  it('recognises a Kaspi orders export by its columns', () => {
    const candidate = detect('orders.xlsx', kaspiRows);
    assert.equal(candidate.dataset, 'ORDERS');
    assert.equal(candidate.isKaspi, true);
    assert.equal(candidate.mapping.amount, 'Сумма');
    assert.deepEqual(missingRequired(candidate), []);
  });

  it('recognises the products template', () => {
    const candidate = detect('Товары', [{ 'Артикул': 'KS-1', 'Себестоимость': '4000', 'Остаток': '12', 'Срок поставки, дней': '10' }]);
    assert.equal(candidate.dataset, 'PRODUCTS');
  });

  it('leaves unrelated sheets unrecognised', () => {
    assert.equal(detect('Notes', [{ Comment: 'hello', Author: 'me' }]).dataset, undefined);
  });
});

describe('buildRows', () => {
  it('parses tenge amounts with spaces, decimal commas and currency signs', () => {
    const { orders } = buildRows(detect('orders.csv', kaspiRows));
    assert.deepEqual(orders?.map((row) => row.amount), [12500.5, 7990]);
    assert.deepEqual(orders?.map((row) => row.quantity), [2, 1]);
  });

  it('skips rows without a date, SKU or amount', () => {
    const { orders, valid } = buildRows(detect('orders.csv', [...kaspiRows, { ...kaspiRows[0], 'Артикул': '' }, { ...kaspiRows[0], 'Сумма': '' }]));
    assert.equal(valid, 2);
    assert.equal(orders?.length, 2);
  });

  it('turns a 0.12 commission into 12 %', () => {
    const candidate = remap(detect('Товары', [{ 'Артикул': 'A', 'Комиссия Kaspi, %': '0,12' }]), 'PRODUCTS');
    assert.equal(buildRows(candidate).products?.[0]?.commissionPct, 12);
  });
});

describe('amount limits', () => {
  it('skips negative and absurdly large amounts instead of importing them', () => {
    const { orders, valid } = buildRows(detect('orders.csv', [...kaspiRows, { ...kaspiRows[0], 'Сумма': '-500' }, { ...kaspiRows[0], 'Сумма': '9e300' }, { ...kaspiRows[0], 'Количество': '-1' }]));
    assert.equal(valid, 2);
    assert.equal(orders?.length, 2);
  });
});
