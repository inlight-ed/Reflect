/**
 * Reading the agency's media plans: grids laid out for people, with titles, merged variant
 * sections, repeated headers, totals and a rate-card sheet that must not win.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseMediaPlan, toNumber } from '../lib/media-plan';

const HEADER = ['Площадка', 'Инструмент / Формат', 'Период', 'Механика и Описание', 'Стоимость (₸, без НДС)', 'Прогн. Показы', 'Прогн. Охват (Уники)', 'Прогн. CTR (%)', 'Прогн. Клики', 'Ожидаемый CVR / Эффект'];

// The layout of a multi-variant plan: a section row, its own header, rows and a total, per variant.
const detail = [
  ['ПОДРОБНЫЙ МЕДИАПЛАН ПО 3 ВАРИАНТАМ СТРАТЕГИИ', '', '', '', '', '', '', '', '', ''],
  ['ФОРМАТ 1: ЛАЙТ (Минимальный бюджет, максимальная эффективность)', '', '', '', '', '', '', '', '', ''],
  HEADER,
  ['Kaspi', 'Пакеты Новинки Brand', '4 недели', 'Комплексное усиление новых товаров', '2,000,000 ₸', '', '', '', '', ''],
  ['Arbuz.kz', 'Топ-позиционирование в поиске', '2 недели', 'Закрепление на 1-х строчках', '450,000 ₸', '80,000', '50,000', '5.0%', '4,000', 'CR Add-to-Cart 67%'],
  ['Wolt Ads', 'Sponsored Search & Cart Cross-sell', '1 месяц', 'Закрепление в поиске', '600,000 ₸', '150,000', '90,000', '4.5%', '6,750', 'CVR 8–10%'],
  ['ИТОГО ФОРМАТ 1', '', '', '', '3,850,000 ₸', '230,000', '140,000', '', '10,750', ''],
  ['ФОРМАТ 2: МЕДИУМ (Сбалансированный охват + конверсии)', '', '', '', '', '', '', '', '', ''],
  HEADER,
  ['Magnum (Kaspi)', 'Super Promo – Пакет «Drive»', '1 месяц', 'Комплексная поддержка', '16,500,000 ₸', '25,000,000', '5,000,000', '0.80%', '200,000', 'Аплифт продаж'],
  ['Arbuz.kz', 'Кросс-сейл в корзине', '1 месяц', 'Апсейл предчекаута', '700,000 ₸', '60,000', '40,000', '8.0%', '9,000', 'CR 63%'],
  ['ИТОГО ФОРМАТ 2', '', '', '', '17,200,000 ₸', '25,060,000', '5,040,000', '', '209,000', ''],
];
const rateCard = [
  ['СПРАВОЧНИК РЕКЛАМНОГО ИНВЕНТАРЯ', '', '', '', '', ''],
  ['Площадка', 'Формат / Инструмент', 'Тип закупки', 'Период размещения', 'Стоимость (₸, без НДС)', 'Бенчмарк CTR (%)'],
  ...Array.from({ length: 12 }, (_, i) => ['Wolt Ads', `Формат ${i}`, 'Fix / Месяц', '1 месяц', '600,000 ₸', '1.2%']),
];
const summary = [
  ['E-COMMERCE МЕДИАПЛАН: СРАВНЕНИЕ СТРАТЕГИЙ'],
  ['Показатель / Метрика', '1. ЛАЙТ', '2. МЕДИУМ'],
  ['Общий бюджет (без НДС)', '3,850,000 ₸', '21,700,000 ₸'],
];

describe('media plan file', () => {
  const plan = parseMediaPlan([
    { sheet: 'Сводка (Summary)', matrix: summary },
    { sheet: 'Детальный Медиаплан', matrix: detail },
    { sheet: 'Справочник Инвентаря', matrix: rateCard },
  ]);

  it('takes the detailed sheet, not the summary or the rate card with more rows', () => {
    assert.equal(plan?.sheet, 'Детальный Медиаплан');
    assert.equal(plan?.title, 'ПОДРОБНЫЙ МЕДИАПЛАН ПО 3 ВАРИАНТАМ СТРАТЕГИИ');
    assert.equal(plan?.placements.length, 5);
  });

  it('splits placements by variant and reads numbers written either way', () => {
    assert.deepEqual([...new Set(plan?.placements.map((p) => p.variant))], ['ФОРМАТ 1: ЛАЙТ', 'ФОРМАТ 2: МЕДИУМ']);
    const arbuz = plan?.placements[1];
    assert.equal(arbuz?.platform, 'Arbuz.kz');
    assert.equal(arbuz?.cost, 450_000);
    assert.equal(arbuz?.planImpressions, 80_000);
    assert.equal(arbuz?.planCtr, 0.05);
    assert.equal(arbuz?.planClicks, 4_000);
    assert.equal(arbuz?.expectedEffect, 'CR Add-to-Cart 67%');
    assert.equal(plan?.placements[0]?.planImpressions, null, 'a package with no forecast stays empty');
  });

  it('keeps the totals the file declares, to check them against the rows', () => {
    assert.deepEqual(plan?.declaredTotals, [
      { variant: 'ФОРМАТ 1: ЛАЙТ', cost: 3_850_000, impressions: 230_000, clicks: 10_750 },
      { variant: 'ФОРМАТ 2: МЕДИУМ', cost: 17_200_000, impressions: 25_060_000, clicks: 209_000 },
    ]);
  });

  it('reads a single-variant plan with Russian number formats and a merged variant row', () => {
    const single = parseMediaPlan([{ sheet: 'Детальный', matrix: [
      ['ДЕТАЛЬНЫЙ МЕДИАПЛАН WOLT ADS & GLOVO ADS'],
      ['Площадка', 'Инвентарь / Формат', 'Механика и Формат закупки', 'Период', 'Стоимость (₸, без НДС)', 'Показы (Impressions)', 'Охват (Уники)', 'CTR (%)', 'Клики (Clicks)'],
      ['ВАРИАНТ 1: СРЕДНИЙ БЮДЖЕТ (6,400,000 ₸ / МЕСЯЦ)', 'ВАРИАНТ 1: СРЕДНИЙ БЮДЖЕТ (6,400,000 ₸ / МЕСЯЦ)', '', '', '', '', '', '', ''],
      ['Wolt Ads', 'Hero Banner (Discovery/Retail)', 'Главный баннер', '1 месяц', '1 600 000 ₸', '1 200 000', '500 000', '1,00%', '12 000'],
    ] }]);
    assert.equal(single?.placements[0]?.variant, 'ВАРИАНТ 1: СРЕДНИЙ БЮДЖЕТ');
    assert.equal(single?.placements[0]?.cost, 1_600_000);
    assert.equal(single?.placements[0]?.planCtr, 0.01);
    assert.equal(single?.placements[0]?.mechanic, 'Главный баннер');
  });

  it('turns written numbers into numbers', () => {
    assert.equal(toNumber('1 600 000 ₸'), 1_600_000);
    assert.equal(toNumber('1,600,000 ₸'), 1_600_000);
    assert.equal(toNumber('3 ₸'), 3);
    assert.equal(toNumber('1,55%'), 0.0155);
    assert.equal(toNumber(0.012, true), 0.012);
    assert.equal(toNumber(1.5, true), 0.015);
    assert.equal(toNumber('—'), null);
  });
});
