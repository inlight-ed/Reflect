import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The test runner compiles JSX with the classic transform and has no browser: give it React and storage.
(globalThis as { React?: typeof React }).React = React;
const memory = new Map<string, string>([['shift-market-locale', 'ru']]);
const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value), removeItem: (key: string) => void memory.delete(key) };
(globalThis as { window?: unknown }).window = { localStorage: storage, sessionStorage: storage, location: { reload: () => undefined } };

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { Router } = await import('wouter');
const { I18nProvider } = await import('../lib/i18n');
const { SessionProvider } = await import('../lib/session');
const { MetricCards, metricChangeTone } = await import('../components/common');
type Metric = Parameters<typeof MetricCards>[0]['metrics'][number];
const h = React.createElement;

const render = (metrics: Metric[]) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false, gcTime: Infinity } } });
  const markup = renderToStaticMarkup(h(Router, { ssrPath: '/overview' }, h(QueryClientProvider, { client }, h(I18nProvider, null, h(SessionProvider, null, h(MetricCards, { metrics }))))));
  client.clear();
  return markup;
};
const metric = (change: Partial<Metric>): Metric => ({ label: 'metric.revenue', value: '100', amount: 100, unit: 'CURRENCY', change: '—', changePct: null, positive: true, ...change }) as Metric;
// The change line of the first card: its class and whether it draws an arrow (an svg).
const changeLine = (markup: string) => {
  const line = markup.match(/<div class="metric-change ([a-z]+)" data-testid="metric-change-0">(.*?)<\/div>/);
  assert.ok(line, 'change line rendered');
  return { tone: line[1], arrow: line[2].includes('<svg'), text: line[2].replace(/<[^>]+>/g, '').trim() };
};

describe('metricChangeTone (C01-12)', () => {
  it('keeps the verdict for a real change', () => {
    assert.equal(metricChangeTone({ change: '+12.4%', changePct: 12.4, positive: true }), 'positive');
    assert.equal(metricChangeTone({ change: '-11.2%', changePct: -11.2, positive: false }), 'negative');
    // Spend going down is good: the API's verdict wins over the sign, as before.
    assert.equal(metricChangeTone({ change: '-5%', changePct: -5, positive: true }), 'positive');
  });

  it('calls a zero change neutral, however it is written', () => {
    for (const changePct of [0, -0, 0.04, -0.04]) assert.equal(metricChangeTone({ change: '0%', changePct, positive: true }), 'neutral', String(changePct));
    for (const change of ['0%', '0,0%', '+0.0%', '−0%', '0']) assert.equal(metricChangeTone({ change, changePct: undefined, positive: true }), 'neutral', change);
  });

  it('is neutral when there is nothing to compare with', () => {
    assert.equal(metricChangeTone({ change: '—', changePct: null, positive: true }), 'neutral');
  });

  it('does not mistake text without a number for zero', () => {
    assert.equal(metricChangeTone({ change: '−2 дня', changePct: undefined, positive: false }), 'negative');
    assert.equal(metricChangeTone({ change: '+3–5%', changePct: undefined, positive: true }), 'positive');
  });
});

describe('MetricCards (C01-12)', () => {
  it('draws a rise with its colour and arrow', () => {
    assert.deepEqual(changeLine(render([metric({ change: '+12.4%', changePct: 12.4, positive: true })])), { tone: 'positive', arrow: true, text: '+12,4%' });
  });

  it('draws a fall with its colour and arrow', () => {
    assert.deepEqual(changeLine(render([metric({ change: '-11.2%', changePct: -11.2, positive: false })])), { tone: 'negative', arrow: true, text: '-11,2%' });
  });

  it('draws zero without colour or arrow, and with the same number as before', () => {
    assert.deepEqual(changeLine(render([metric({ change: '0%', changePct: 0, positive: true })])), { tone: 'neutral', arrow: false, text: '0%' });
    assert.deepEqual(changeLine(render([metric({ change: '0%', changePct: undefined, positive: true })])), { tone: 'neutral', arrow: false, text: '0%' });
  });

  it('shows a dash, not zero, when there is no comparison', () => {
    assert.deepEqual(changeLine(render([metric({ change: '—', changePct: null })])), { tone: 'neutral', arrow: false, text: '—' });
  });
});
