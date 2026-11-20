import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The test runner compiles JSX with the classic transform and has no browser: give it React and a stored language.
(globalThis as { React?: typeof React }).React = React;
let stored = 'ru';
(globalThis as { window?: unknown }).window = { localStorage: { getItem: () => stored, setItem: () => undefined } };
const { I18nProvider } = await import('../lib/i18n');
const { DataFreshness, DataSourceBadge } = await import('../components/data-trust');
const { PageHead } = await import('../components/common');
const h = React.createElement;

const render = (node: React.ReactElement, locale = 'ru') => {
  stored = locale;
  return renderToStaticMarkup(h(I18nProvider, null, node));
};
const tone = (markup: string) => markup.match(/rf-badge--(\w+)/)?.[1];

describe('DataSourceBadge', () => {
  it('names each source in words, with its own tone', () => {
    assert.match(render(h(DataSourceBadge, { source: 'DEMO DATA' })), /Демо-данные/);
    assert.equal(tone(render(h(DataSourceBadge, { source: 'DEMO DATA' }))), 'warning');
    assert.equal(tone(render(h(DataSourceBadge, { source: 'MOCK' }))), 'warning');
    assert.match(render(h(DataSourceBadge, { source: 'USER DATA' })), /Ваши данные/);
    // C01-16 (D3): the source itself is neutral; colour is kept for caveats (demo, partial) and errors.
    assert.equal(tone(render(h(DataSourceBadge, { source: 'USER DATA' }))), 'neutral');
    for (const source of ['KASPI API', 'KASPI ADS', 'META']) assert.equal(tone(render(h(DataSourceBadge, { source }))), 'neutral', source);
    assert.equal(tone(render(h(DataSourceBadge, { source: 'REDSTAT', status: 'READY' }))), 'neutral');
    assert.match(render(h(DataSourceBadge, { source: 'REDSTAT', status: 'READY' })), />RedStat</);
  });

  it('never shows an unavailable, partial or unknown source in the "connected" tone', () => {
    const unavailable = render(h(DataSourceBadge, { source: 'REDSTAT', status: 'UNAVAILABLE' }));
    assert.equal(tone(unavailable), 'danger');
    assert.match(unavailable, /RedStat недоступен/);
    assert.equal(tone(render(h(DataSourceBadge, { source: 'REDSTAT', status: 'PARTIAL' }))), 'warning');
    assert.equal(tone(render(h(DataSourceBadge, { source: 'REDSTAT', status: 'NOT_CONFIGURED' }))), 'neutral');
    const unknown = render(h(DataSourceBadge, {}));
    assert.equal(tone(unknown), 'neutral');
    assert.match(unknown, /Источник неизвестен/);
    assert.equal(tone(render(h(DataSourceBadge, { source: 'SOMETHING ELSE' }))), 'neutral');
  });

  it('does not call a source "live"', () => {
    for (const source of ['DEMO DATA', 'MOCK', 'USER DATA', 'REDSTAT', 'KASPI API', 'KASPI ADS', 'META', undefined]) {
      assert.doesNotMatch(render(h(DataSourceBadge, { source }), 'en'), /live/i);
    }
  });

  it('keeps the test id and explains the source for screen readers', () => {
    const markup = render(h(DataSourceBadge, { source: 'DEMO DATA' }));
    assert.match(markup, /data-testid="status-data-source"/);
    assert.match(markup, /class="visually-hidden"> — Снимок демо-магазина/);
  });
});

describe('DataFreshness', () => {
  it('shows nothing without a timestamp, or with an invalid one — never the current time', () => {
    assert.equal(render(h(DataFreshness, {})), '');
    assert.equal(render(h(DataFreshness, { at: null })), '');
    assert.equal(render(h(DataFreshness, { at: 'not a date' })), '');
  });

  it('gives the date and time of an earlier day, in the interface language', () => {
    const at = '2026-08-18T04:42:00.000Z'; // 09:42 in Almaty
    // The year is added only when it is not the current one, so the pattern allows it.
    assert.match(render(h(DataFreshness, { at })), /<time class="rf-freshness" dateTime="2026-08-18T04:42:00.000Z">Обновлено 18 авг\.( 2026)?, 09:42/i);
    assert.match(render(h(DataFreshness, { at }), 'kk'), /Жаңартылды 18 там\.( 2026)?, 09:42/);
    assert.match(render(h(DataFreshness, { at }), 'en'), /Updated Aug 18( 2026)?, 09:42 AM/);
  });

  it('adds the year when it is not the current one', () => {
    // Almaty was UTC+6 in 2020, so only the date part is checked here.
    assert.match(render(h(DataFreshness, { at: '2020-01-05T04:00:00.000Z' })), /Обновлено 05 янв\. 2020, \d\d:\d\d/);
  });

  it('says "today" for a timestamp from today', () => {
    assert.match(render(h(DataFreshness, { at: new Date().toISOString() })), /Обновлено сегодня в \d\d:\d\d/);
  });

  it('says "checked" when the timestamp is the time a source was asked', () => {
    assert.match(render(h(DataFreshness, { at: new Date().toISOString(), kind: 'checked' })), /Проверено сегодня в \d\d:\d\d/);
  });

  it('shows the day the data reaches for dataAsOf', () => {
    assert.match(render(h(DataFreshness, { at: '2026-08-17', kind: 'asOf' })), /Данные по 17 авг\.( 2026)?</);
  });
});

describe('PageHead freshness', () => {
  const head = (props: Record<string, unknown>) => render(h(PageHead, { eyebrow: 'e', title: 't', subtitle: 's', ...props }));
  const at = '2026-08-18T04:42:00.000Z';

  it('hides the time of an empty workspace: its timestamp is only the moment of the answer', () => {
    const markup = head({ source: 'USER DATA', mode: 'EMPTY', refreshedAt: at });
    assert.doesNotMatch(markup, /page-refreshed-at|Обновлено/);
    assert.match(markup, /Ваши данные/);
  });

  it('shows the time for demo and for a workspace with data', () => {
    assert.match(head({ source: 'DEMO DATA', mode: 'DEMO', refreshedAt: at }), /data-testid="page-refreshed-at"[^>]*>Обновлено 18 авг/);
    assert.match(head({ mode: 'USER', refreshedAt: at, dataAsOf: '2026-08-17' }), /Ваши данные.*Обновлено 18 авг.*Данные по 17 авг/);
  });

  it('shows no time at all when the page passes none', () => {
    assert.doesNotMatch(head({ source: 'USER DATA', mode: 'USER' }), /<time/);
  });
});
