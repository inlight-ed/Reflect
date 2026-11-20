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
const { ApiError } = await import('@workspace/api-client-react');
const { I18nProvider } = await import('../lib/i18n');
const { SessionProvider } = await import('../lib/session');
const { canRetry, classifyError, createRetryGuard, nextShownError } = await import('../lib/query-state');
const { BlockError, EmptyState, ErrorState, MissingValue, PageSkeleton, RefreshingNotice } = await import('../components/states');
const h = React.createElement;

const render = (node: React.ReactElement, { demo = false } = {}) => {
  if (demo) memory.set('reflect-demo', '1'); else memory.delete('reflect-demo');
  // No garbage-collection timers: they would keep the test process alive for minutes.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false, gcTime: Infinity } } });
  const markup = renderToStaticMarkup(h(Router, { ssrPath: '/overview' }, h(QueryClientProvider, { client }, h(I18nProvider, null, h(SessionProvider, null, node)))));
  client.clear();
  return markup;
};
const apiError = (status: number) => new ApiError(new Response(null, { status, statusText: 'x' }), null, { method: 'GET', url: '/api/x' });
const parseError = Object.assign(new Error('Failed to parse response'), { name: 'ResponseParseError' });

describe('classifyError', () => {
  it('tells failures apart only by what the error shows', () => {
    assert.equal(classifyError(apiError(401)), 'auth');
    assert.equal(classifyError(apiError(403)), 'auth');
    assert.equal(classifyError(apiError(429)), 'rateLimit');
    assert.equal(classifyError(apiError(504)), 'timeout');
    assert.equal(classifyError(apiError(408)), 'timeout');
    assert.equal(classifyError(apiError(500)), 'server');
    assert.equal(classifyError(apiError(503)), 'server');
    assert.equal(classifyError(apiError(400)), 'request');
    assert.equal(classifyError(parseError), 'parse');
    assert.equal(classifyError(new TypeError('Failed to fetch')), 'network');
    assert.equal(classifyError(new TypeError('NetworkError when attempting to fetch resource.')), 'network');
  });

  it('does not call a bug in the page a network problem', () => {
    assert.equal(classifyError(new TypeError("Cannot read properties of undefined (reading 'map')")), 'unexpected');
    assert.equal(classifyError(new Error('boom')), 'unexpected');
    assert.equal(classifyError(undefined), 'unexpected');
  });

  it('offers a retry only where repeating can help', () => {
    assert.equal(canRetry('auth'), false);
    assert.equal(canRetry('request'), false);
    for (const kind of ['network', 'rateLimit', 'timeout', 'server', 'parse', 'unexpected'] as const) assert.equal(canRetry(kind), true);
  });
});

describe('createRetryGuard', () => {
  it('runs one refetch at a time: clicks during a retry do not send more requests', async () => {
    let calls = 0;
    let finish!: () => void;
    const states: boolean[] = [];
    // The first refetch waits until the test lets it finish; later ones resolve at once.
    const guard = createRetryGuard(() => { calls += 1; return calls === 1 ? new Promise<void>((done) => { finish = done; }) : Promise.resolve(); }, (pending) => states.push(pending));
    const first = guard.run();
    const second = guard.run();
    const third = guard.run();
    assert.equal(calls, 1);
    assert.equal(guard.pending, true);
    assert.equal(first, second);
    assert.equal(second, third);
    finish();
    await first;
    assert.equal(guard.pending, false);
    assert.deepEqual(states, [true, false]);
    // Once it is done, a new click retries again.
    await guard.run();
    assert.equal(calls, 2);
  });

  it('ends the pending state when the retry fails, without looping', async () => {
    let calls = 0;
    const guard = createRetryGuard(() => { calls += 1; return Promise.reject(new Error('still down')); });
    await guard.run();
    assert.equal(guard.pending, false);
    assert.equal(calls, 1);
  });
});

describe('nextShownError', () => {
  it('keeps the last error on screen while its retry runs, and drops it once the retry ends', () => {
    const failure = new Error('down');
    let shown = nextShownError(null, { error: failure, isFetching: false });
    assert.equal(shown, failure);
    shown = nextShownError(shown, { error: null, isFetching: true });
    assert.equal(shown, failure);
    shown = nextShownError(shown, { error: null, isFetching: false });
    assert.equal(shown, null);
    assert.equal(nextShownError(null, { error: null, isFetching: true }), null);
  });
});

describe('PageSkeleton', () => {
  it('outlines a page and tells assistive tech it is loading', () => {
    const markup = render(h(PageSkeleton));
    assert.match(markup, /<main class="page rf-page-skeleton[^"]*" aria-busy="true" data-testid="status-loading">/);
    assert.match(markup, /role="status">Загрузка…</);
    assert.equal(markup.match(/rf-skeleton-metric/g)?.length, 4);
    assert.equal(markup.match(/rf-skeleton--card/g)?.length, 3);
  });

  it('draws only the parts a page has', () => {
    const markup = render(h(PageSkeleton, { metrics: 0, cards: 1, chart: false }));
    assert.doesNotMatch(markup, /rf-skeleton-metric/);
    assert.equal(markup.match(/rf-skeleton--card/g)?.length, 1);
  });
});

describe('ErrorState', () => {
  const noop = () => undefined;

  it('names the kind of failure, with a retry, and never shows the raw API message', () => {
    const markup = render(h(ErrorState, { error: apiError(500), onRetry: noop }));
    assert.match(markup, /data-error-kind="server"/);
    assert.match(markup, /role="alert"/);
    assert.match(markup, /<h1 class="rf-state-title">Сервис временно недоступен<\/h1>/);
    assert.match(markup, /data-testid="button-retry"[^>]*>.*Повторить/);
    assert.doesNotMatch(markup, /HTTP 500/);
  });

  it('says "no connection" for a network failure', () => {
    assert.match(render(h(ErrorState, { error: new TypeError('Failed to fetch'), onRetry: noop })), /Нет связи с сервером/);
  });

  it('offers to sign in again instead of a pointless retry when access is refused', () => {
    const markup = render(h(ErrorState, { error: apiError(401), onRetry: noop }));
    assert.match(markup, /Нет доступа/);
    assert.match(markup, /data-testid="button-signin-again"/);
    assert.doesNotMatch(markup, /button-retry/);
  });

  it('offers a reload for a rejected request', () => {
    const markup = render(h(ErrorState, { error: apiError(400), onRetry: noop }));
    assert.match(markup, /data-testid="button-reload"/);
    assert.doesNotMatch(markup, /button-retry/);
  });

  it('keeps the demo badge for a guest and shows none for a signed-in person', () => {
    assert.match(render(h(ErrorState, { error: apiError(500), onRetry: noop }), { demo: true }), /Демо-данные/);
    assert.doesNotMatch(render(h(ErrorState, { error: apiError(500), onRetry: noop })), /status-data-source/);
  });

  it('takes the kind from the caller for a crash in the page', () => {
    assert.match(render(h(ErrorState, { error: new TypeError('Failed to fetch'), kind: 'unexpected', onRetry: noop })), /Что-то пошло не так/);
  });
});

describe('BlockError', () => {
  it('names the block that failed and keeps its own retry', () => {
    const markup = render(h(BlockError, { error: apiError(503), onRetry: () => undefined, what: 'Исходы решений', testId: 'outcomes-error' }));
    assert.match(markup, /rf-notice--danger/);
    assert.match(markup, /role="alert"/);
    assert.match(markup, /Не загрузилось: Исходы решений/);
    assert.match(markup, /data-testid="outcomes-error-retry"/);
  });

  it('as a stale warning, says the earlier data is still shown', () => {
    const markup = render(h(BlockError, { error: apiError(503), onRetry: () => undefined, what: 'Пульс бизнеса', stale: true }));
    assert.match(markup, /rf-notice--warning/);
    assert.match(markup, /Показаны прежние данные/);
  });
});

describe('EmptyState', () => {
  it('explains what happened, why and what to do next', () => {
    const markup = render(h(EmptyState, { label: 'filtered products', title: 'Нет товаров', hint: 'Фильтр скрыл все товары.', action: h('button', null, 'Показать все') }));
    assert.match(markup, /data-testid="empty-filtered-products"/);
    assert.match(markup, /<h3 class="rf-empty-title">Нет товаров<\/h3><p class="rf-empty-hint">Фильтр скрыл все товары.<\/p><div class="rf-empty-action"><button>/);
  });

  it('keeps the short line for blocks not migrated yet', () => {
    assert.match(render(h(EmptyState, { label: 'channels' })), /data-testid="empty-channels".*В этом снимке нет данных:/);
  });
});

describe('MissingValue and RefreshingNotice', () => {
  it('shows a dash with the reason, never a zero', () => {
    const markup = render(h(MissingValue, { reason: 'notCalculable' }));
    assert.match(markup, /<span aria-hidden="true">—<\/span><span class="visually-hidden">Нельзя посчитать: не хватает данных<\/span>/);
    assert.doesNotMatch(markup, />0</);
  });

  it('keeps a live region and speaks only while updating', () => {
    assert.match(render(h(RefreshingNotice, { active: false })), /<span class="rf-refreshing" role="status" aria-live="polite" data-testid="status-refreshing"><\/span>/);
    assert.match(render(h(RefreshingNotice, { active: true })), /data-active="true">.*Обновляем данные…/);
  });
});
