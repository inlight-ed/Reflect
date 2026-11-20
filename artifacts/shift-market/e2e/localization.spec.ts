import { expect, test, type Page } from '@playwright/test';

// Dates and times below assume the API runs with DEMO_SNAPSHOT_DATE=2026-08-18,
// which pins the demo snapshot to its authored day (otherwise it follows today's date).
import { sourceMessageCatalog, sourceMessageKeys, type Locale } from '../src/lib/i18n';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type LocaleExpectation = {
  locale: 'ru' | 'kk' | 'en';
  languageText: string;
  advertisingHeading: string;
  /** The freshness label; the date part depends on the day the tests run, so only the label and the time are checked. */
  refreshedLabel: RegExp;
  refreshedTime: string;
  activityDate: string;
  ctr: string;
  currency: string;
  demoLabel: string;
  demoSource: string;
  signalLabel: string;
  errorTitle: string;
  errorBody: string;
  retryLabel: string;
  connectorStatus: string;
  connectorDetail: string;
};

const expectations: LocaleExpectation[] = [
  {
    locale: 'ru',
    languageText: 'Русский',
    advertisingHeading: 'Рекламные каналы',
    refreshedLabel: /обновлено/i,
    refreshedTime: '09:42',
    activityDate: '17 авг.',
    ctr: '4,57%',
    currency: '92,40 ₸',
    demoLabel: 'Демо · оценка',
    demoSource: 'Демо-данные',
    signalLabel: 'СИГНАЛ ИИ · ДЕМО-ОЦЕНКА',
    // A 503 is a failure on the server's side, and the state says so.
    errorTitle: 'Сервис временно недоступен',
    errorBody: 'Ошибка на стороне сервера. Повторите попытку чуть позже.',
    retryLabel: 'Повторить',
    connectorStatus: 'НЕ ПОДКЛЮЧЕНО',
    connectorDetail: 'Прямое подключение появится позже. Сейчас можно загрузить отчёт продаж из файла.',
  },
  {
    locale: 'kk',
    languageText: 'Қазақша',
    advertisingHeading: 'Жарнама арналары',
    refreshedLabel: /жаңартылды/i,
    refreshedTime: '09:42',
    activityDate: '17 там.',
    ctr: '4,57%',
    currency: '92,40 ₸',
    demoLabel: 'Демо · бағалау',
    demoSource: 'Демо деректер',
    signalLabel: 'AI СИГНАЛЫ · ДЕМО БАҒАЛАУ',
    errorTitle: 'Сервис уақытша қолжетімсіз',
    errorBody: 'Сервер жағындағы қате. Сәл кейінірек қайталап көріңіз.',
    retryLabel: 'Қайталау',
    connectorStatus: 'ҚОСЫЛМАҒАН',
    connectorDetail: 'Тікелей қосылым кейінірек пайда болады. Қазір сату есебін файлдан жүктеуге болады.',
  },
  {
    locale: 'en',
    languageText: 'English',
    advertisingHeading: 'Advertising channels',
    refreshedLabel: /updated/i,
    refreshedTime: '09:42 AM',
    activityDate: 'Aug 17',
    ctr: '4.57%',
    currency: '₸92.40',
    demoLabel: 'Demo · estimate',
    demoSource: 'Demo data',
    signalLabel: 'AI SIGNAL · DEMO ESTIMATE',
    errorTitle: 'The service is temporarily unavailable',
    errorBody: 'Something went wrong on our side. Try again a little later.',
    retryLabel: 'Retry',
    connectorStatus: 'NOT CONNECTED',
    connectorDetail: 'A direct connection is coming later. You can upload a sales report from a file now.',
  },
];

const channelIds = ['google', 'meta', 'tiktok', 'kaspi'];

test('keeps every API source message key translated in every supported locale', async ({ request }) => {
  const response = await request.get('/api/shift-market/integrations');
  expect(response.ok()).toBeTruthy();
  const integrations = await response.json();
  const statuses = [integrations.kaspi, integrations.redstat, ...integrations.media];

  for (const locale of ['ru', 'kk', 'en'] as Locale[]) {
    for (const key of sourceMessageKeys) {
      expect(sourceMessageCatalog[locale][key], `${locale} is missing ${key}`).toBeTruthy();
    }
  }

  for (const status of statuses) {
    expect(sourceMessageKeys, `API returned an unknown source message key: ${status.detail}`).toContain(status.detail);
  }
});

async function chooseLanguage(
  page: Page,
  locale: LocaleExpectation['locale'],
) {
  await page.getByTestId('select-language').selectOption(locale);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}

// Guests land on the start page; the demo opens from there.
async function openDemo(page: Page) {
  await page.goto('/');
  await page.evaluate(() => { window.localStorage.removeItem('shift-market-locale'); window.sessionStorage.clear(); });
  await page.reload();
  await page.getByTestId('button-demo').click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByTestId('select-language')).toHaveValue('ru');
}

// The API limits requests per client address. Each test is a separate person, so each gets its own
// address; otherwise the whole suite, run from one machine, shares one person's limit and the tests
// near the end fail with "too many requests" depending on how fast the earlier ones ran.
let clientNumber = 0;

test.beforeEach(async ({ page }, testInfo) => {
  clientNumber += 1;
  await page.context().setExtraHTTPHeaders({ 'X-Forwarded-For': `10.${testInfo.workerIndex % 250}.${Math.floor(clientNumber / 250) % 250}.${(clientNumber % 250) + 1}` });
  if (testInfo.title.startsWith('seller:')) return;
  await openDemo(page);
});

test('keeps the selected interface language after navigation and reload', async ({ page }) => {
  await expect(page.getByText('Обзор', { exact: true }).first()).toBeVisible();

  await chooseLanguage(page, 'kk');
  await expect(page.getByText('Шолу', { exact: true }).first()).toBeVisible();
  await page.getByTestId('link-nav-реклама').click();
  await expect(page).toHaveURL(/\/advertising$/);
  await expect(page.getByRole('heading', { name: 'Жарнама арналары', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('select-language')).toHaveValue('kk');
  await expect(page.getByRole('heading', { name: 'Жарнама арналары', exact: true })).toBeVisible();

  await chooseLanguage(page, 'en');
  await expect(page.getByRole('heading', { name: 'Advertising channels', exact: true })).toBeVisible();
  await page.getByTestId('link-nav-обзор').click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole('heading', { name: 'What to do today', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('select-language')).toHaveValue('en');
  await expect(page.getByRole('heading', { name: 'What to do today', exact: true })).toBeVisible();

  await chooseLanguage(page, 'ru');
  await expect(page.getByText('Обзор', { exact: true }).first()).toBeVisible();
});

for (const expected of expectations) {
  test(`formats advertising analytics and marks every channel as demo in ${expected.languageText}`, async ({ page }) => {
    await chooseLanguage(page, expected.locale);
    await page.getByTestId('link-nav-реклама').click();
    await expect(page).toHaveURL(/\/advertising$/);
    await expect(page.getByRole('heading', { name: expected.advertisingHeading, exact: true })).toBeVisible();

    await expect(page.getByTestId('page-refreshed-at')).toContainText(expected.refreshedLabel);
    await expect(page.getByTestId('page-refreshed-at')).toContainText(expected.refreshedTime);
    await expect(page.getByTestId('advertising-activity-google-1').locator('td').first()).toHaveText(expected.activityDate);

    const googleMetrics = page.getByTestId('card-ad-channel-google').locator('.channel-metrics');
    await expect(googleMetrics).toContainText('CTR');
    await expect(googleMetrics).toContainText(expected.ctr);
    await expect(googleMetrics).toContainText(expected.currency);

    for (const channelId of channelIds) {
      const card = page.getByTestId(`card-ad-channel-${channelId}`);
      await expect(card).toBeVisible();
      await expect(card).toContainText(expected.demoLabel);
      await expect(card).toContainText(expected.signalLabel);
    }
  });
}

for (const expected of expectations) {
  test(`keeps empty, failed, and connector states localized in ${expected.languageText}`, async ({ page }) => {
    const rawApiMessage = 'Upstream connector diagnostic that must not reach the seller';
    let responseMode: 'error' | 'empty' = 'error';

    await chooseLanguage(page, expected.locale);
    await page.route('**/api/shift-market/advertising', async (route) => {
      if (responseMode === 'error') {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: rawApiMessage }),
        });
        return;
      }

      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ source: 'DEMO DATA', channels: [], activities: [] }),
      });
    });

    await page.getByTestId('link-nav-реклама').click();
    const errorState = page.getByTestId('status-error');
    await expect(errorState).toContainText(expected.errorTitle);
    await expect(errorState).toContainText(expected.errorBody);
    await expect(errorState).toContainText(expected.retryLabel);
    await expect(errorState).toContainText(expected.demoSource);
    await expect(errorState).not.toContainText(rawApiMessage);

    responseMode = 'empty';
    await page.getByTestId('button-retry').click();
    await expect(page.getByTestId('empty-channels')).toBeVisible();
    await expect(page.getByTestId('status-data-source')).toContainText(expected.demoSource);
    await expect(page.getByTestId('advertising-demo-notice')).toContainText(expected.locale === 'en' ? 'Demo data' : expected.locale === 'kk' ? 'Демо деректер' : 'Демо-данные');

    await page.getByTestId('link-nav-settings').click();
    const kaspiConnector = page.getByTestId('row-integration-Kaspi Seller API');
    await expect(kaspiConnector).toContainText(expected.connectorStatus);
    await expect(kaspiConnector).toContainText(expected.connectorDetail);
  });
}
const assistantExpectations = [
  { locale: 'ru' as const, question: 'Какие SKU стоит масштабировать?', answer: 'Масштабировать стоит эти товары', insufficient: 'Недостаточно данных для уверенного вывода.' },
  { locale: 'kk' as const, question: 'Қай SKU-ларды ауқымдау керек?', answer: 'Мына тауарларды ауқымдау керек', insufficient: 'Сенімді қорытынды жасау үшін деректер жеткіліксіз.' },
  { locale: 'en' as const, question: 'Which SKUs should I scale?', answer: 'These products are worth scaling', insufficient: 'Not enough data for a confident conclusion.' },
];

for (const expected of assistantExpectations) {
  test(`answers from app data and admits missing data in ${expected.locale}`, async ({ page }) => {
    await chooseLanguage(page, expected.locale);
    await page.goto('/assistant');
    const suggestions = page.getByTestId('assistant-suggestion');
    await expect(suggestions.nth(1)).toHaveText(expected.question);
    await suggestions.nth(1).click();
    await expect(page.getByTestId('assistant-answer').first()).toContainText(expected.answer);
    await suggestions.nth(4).click();
    await expect(page.getByTestId('assistant-answer').nth(1)).toContainText(expected.insufficient);
  });
}

test('explains every dashboard confidence with its supporting signals', async ({ page }) => {
  const actions = page.locator('[data-testid^="card-action-"]');
  await expect(actions.first()).toBeVisible();
  const count = await actions.count();
  for (let index = 0; index < count; index += 1) {
    const toggle = actions.nth(index).getByTestId('reveal-action');
    await expect(toggle).toContainText('Подтверждают');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(actions.nth(index).locator('.confidence-basis li').first()).toBeVisible();
  }
});

test('guests without demo are sent to the start page', async ({ page }) => {
  await page.evaluate(() => window.sessionStorage.clear());
  await page.goto('/products');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('link-register')).toBeVisible();
});

/**
 * The orders fixture has fixed dates. Stock forecasts only look at recent sales, so the dates are
 * shifted to end yesterday; otherwise this test starts failing a few weeks after the fixture was made.
 */
function freshOrdersFixture(): string {
  const source = readFileSync(new URL('./fixtures/kaspi-orders.csv', import.meta.url), 'utf8');
  const stamp = /(\d{2})\.(\d{2})\.(\d{4})/g;
  const days = [...source.matchAll(stamp)].map((match) => Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  const shift = Math.floor((Date.now() - 86_400_000 - Math.max(...days)) / 86_400_000) * 86_400_000;
  const two = (value: number) => String(value).padStart(2, '0');
  const shifted = source.replace(stamp, (_all, day, month, year) => {
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)) + shift);
    return `${two(date.getUTCDate())}.${two(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
  });
  const path = join(mkdtempSync(join(tmpdir(), 'reflect-e2e-')), 'kaspi-orders.csv');
  writeFileSync(path, shifted);
  return path;
}

test('seller: registers, imports a Kaspi export and marks a recommendation', async ({ page }) => {
  await page.goto('/register');
  await page.getByTestId('input-email').fill(`e2e-${Date.now()}@example.kz`);
  await page.getByTestId('input-password').fill('password-123');
  await page.getByTestId('button-auth-submit').click();
  await expect(page.getByTestId('onboarding')).toBeVisible();

  await page.getByTestId('onboarding-upload').click();
  await page.getByTestId('input-data-file').setInputFiles([freshOrdersFixture(), new URL('./fixtures/products.csv', import.meta.url).pathname]);
  await expect(page.getByTestId('import-card')).toHaveCount(2);
  await expect(page.getByTestId('select-dataset').first()).toHaveValue('ORDERS');
  await expect(page.getByTestId('select-dataset').nth(1)).toHaveValue('PRODUCTS');
  await page.getByTestId('button-import-all').click();
  await expect(page.getByText(/Загружено строк/)).toHaveCount(2);

  await page.getByTestId('link-nav-обзор').click();
  await expect(page.getByTestId('revenue-chart')).toBeVisible();
  // The chart ends where the data ends and says so, instead of dropping to zero after the export.
  await expect(page.getByTestId('chart-data-as-of')).toContainText('данные по');
  await expect(page.getByTestId('forecast')).toContainText('Крем для рук');
  const firstAction = page.getByTestId('card-action-0');
  await expect(firstAction).toContainText('Дозаказать');
  await firstAction.getByTestId('verdict-worked').click();
  await expect(firstAction.getByTestId('verdict-worked')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('outcomes')).toContainText('Сработало');

  await page.getByTestId('period-7').click();
  await expect(page.getByTestId('period-7')).toHaveAttribute('aria-pressed', 'true');
});

test('forgot password: same answer for any address, link from the sign-in form', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('link-forgot-password').click();
  await expect(page).toHaveURL(/forgot-password/);
  await page.getByTestId('input-reset-email').fill(`nobody-${Date.now()}@example.kz`);
  await page.getByTestId('button-reset-request').click();
  await expect(page.getByTestId('reset-sent')).toContainText('Проверьте почту');
  await page.goto('/reset-password?token=not-a-real-token-but-long-enough');
  await page.getByTestId('input-new-password').fill('new-password-123');
  await page.getByTestId('button-reset-submit').click();
  await expect(page.getByTestId('reset-error')).toContainText('Ссылка недействительна');
});

test('first screen: a Kaspi token loads orders and the plan without any file', async ({ page }) => {
  test.skip(!process.env.FAKE_KASPI, 'needs the fake Kaspi API (FAKE_KASPI=1, see e2e/fake-kaspi.mjs)');
  await page.goto('/register');
  await page.getByTestId('input-email').fill(`token-${Date.now()}@example.kz`);
  await page.getByTestId('input-password').fill('password-123');
  await page.getByTestId('button-auth-submit').click();
  await expect(page.getByTestId('onboarding')).toBeVisible();
  await page.getByTestId('input-onboarding-kaspi_api').fill('wrong-token');
  await page.getByTestId('onboarding-connect-kaspi_api').getByRole('button').click();
  await expect(page.getByTestId('onboarding-connect-kaspi_api').getByRole('alert')).toBeVisible();
  await page.getByTestId('input-onboarding-kaspi_api').fill('test-kaspi-token');
  await page.getByTestId('onboarding-connect-kaspi_api').getByRole('button').click();
  // The first sync runs in the background; the overview appears when it is done.
  await expect(page.getByTestId('revenue-chart')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('chart-data-as-of')).toBeVisible();
});

test('overview: the period\'s figures come first, then actions with their kind, effect and confidence', async ({ page }) => {
  const order = await page.locator('#main-content h2.section-title').allTextContents();
  expect(order.indexOf('Пульс бизнеса')).toBeGreaterThanOrEqual(0);
  expect(order.indexOf('Пульс бизнеса')).toBeLessThan(order.indexOf('Что сделать сегодня'));
  const first = page.getByTestId('card-action-0');
  await expect(first.locator('.rf-badge')).toHaveText(/Исправить|Масштабировать|Оптимизировать|Защищать|Наблюдать|Дозаказать/);
  await expect(first.getByRole('meter')).toHaveAttribute('aria-valuenow', /\d+/);
  await expect(first.locator('.rf-action-impact')).toContainText('Ожидаемый эффект');
  // The demo's log covers a fixed window, and says so.
  await expect(page.locator('.rf-timeline-window')).toHaveText('последние 7 дней');
});

test('overview: while loading, the page shows its own outline', async ({ page }) => {
  await page.route('**/api/shift-market/dashboard**', async (route) => { await new Promise((done) => setTimeout(done, 1500)); await route.continue(); });
  await page.goto('/overview');
  await expect(page.getByTestId('status-loading')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByTestId('status-loading').locator('.rf-skeleton-metric')).toHaveCount(4);
  await expect(page.getByTestId('card-action-0')).toBeVisible();
});

test('overview: no sideways scrolling on a phone, with demo data and for a new workspace', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/overview');
  await expect(page.getByTestId('card-action-0')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.goto('/register');
  await page.getByTestId('input-email').fill(`phone-${Date.now()}@example.kz`);
  await page.getByTestId('input-password').fill('password-123');
  await page.getByTestId('button-auth-submit').click();
  await expect(page.getByTestId('onboarding')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

// ---- Common UI states: transitions between loading, error, retry and data ----

test('states: a failed overview says what failed, then loads again and shows the data after one retry request', async ({ page }) => {
  let failing = true;
  let requests = 0;
  await page.route('**/api/shift-market/dashboard**', async (route) => {
    requests += 1;
    if (failing) { await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"down"}' }); return; }
    await new Promise((done) => setTimeout(done, 600));
    await route.continue();
  });
  await page.goto('/overview');
  const error = page.getByTestId('status-error');
  await expect(error).toHaveAttribute('data-error-kind', 'server');
  await expect(error.getByRole('heading', { level: 1 })).toHaveText('Сервис временно недоступен');
  failing = false;
  const before = requests;
  const retry = page.getByTestId('button-retry');
  // Error → loading (the page's outline) → data; a quick second click lands on nothing.
  await retry.click();
  await retry.click({ timeout: 300 }).catch(() => undefined);
  await expect(page.getByTestId('status-loading')).toBeVisible();
  await expect(page.getByTestId('card-action-0')).toBeVisible();
  expect(requests - before).toBe(1);
  // Focus is not left on a button that disappeared.
  await expect(page.locator('#main-content')).toBeFocused();
});

test('states: a lost connection is not called a server error', async ({ page }) => {
  await page.route('**/api/shift-market/dashboard**', (route) => route.abort('internetdisconnected'));
  await page.goto('/overview');
  await expect(page.getByTestId('status-error')).toHaveAttribute('data-error-kind', 'network');
  await expect(page.getByTestId('status-error')).toContainText('Нет связи с сервером');
});

test('states: a filter that hides every product explains itself and can be reset', async ({ page }) => {
  await page.route('**/api/shift-market/products**', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.products = body.products.map((product: Record<string, unknown>) => ({ ...product, opportunity: 'SCALE' }));
    await route.fulfill({ response, json: body });
  });
  await page.goto('/products');
  await page.getByTestId('filter-products-fix').click();
  const empty = page.getByTestId('empty-filtered-products');
  await expect(empty).toContainText('Фильтр скрыл все товары');
  await empty.getByTestId('button-reset-filter').click();
  await expect(page.getByTestId('empty-filtered-products')).toHaveCount(0);
  await expect(page.getByTestId('filter-products-all')).toHaveAttribute('aria-pressed', 'true');
});

test('states with seller data: partial failure, a new period and a failed refresh keep what is on screen', async ({ page }) => {
  test.skip(!process.env.FAKE_KASPI, 'needs the fake Kaspi API (FAKE_KASPI=1, see e2e/fake-kaspi.mjs)');
  await page.goto('/register');
  await page.getByTestId('input-email').fill(`states-${Date.now()}@example.kz`);
  await page.getByTestId('input-password').fill('password-123');
  await page.getByTestId('button-auth-submit').click();
  await page.getByTestId('input-onboarding-kaspi_api').fill('test-kaspi-token');
  await page.getByTestId('onboarding-connect-kaspi_api').getByRole('button').click();
  await expect(page.getByTestId('revenue-chart')).toBeVisible({ timeout: 30_000 });

  // One block fails, the rest of the page keeps working.
  await page.route('**/api/feedback**', (route) => route.fulfill({ status: 500, body: '{}' }));
  await page.reload();
  await expect(page.getByTestId('outcomes-error')).toContainText('Результаты действий');
  await expect(page.getByTestId('revenue-chart')).toBeVisible();
  // The block keeps its retry button busy while it retries, so a second click sends nothing.
  let feedbackRequests = 0;
  await page.unroute('**/api/feedback**');
  await page.route('**/api/feedback**', async (route) => { feedbackRequests += 1; await new Promise((done) => setTimeout(done, 800)); await route.continue(); });
  const blockRetry = page.getByTestId('outcomes-error-retry');
  await blockRetry.click();
  await expect(blockRetry).toBeDisabled();
  await expect(blockRetry).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByTestId('outcomes-error')).toHaveCount(0);
  expect(feedbackRequests).toBe(1);
  await page.unroute('**/api/feedback**');

  // Verdicts already on screen stay when their update fails, marked as older, with a retry.
  const verdict = { id: 'f1', actionKey: 'k1', actionType: 'RESTOCK', sku: 'X-1', object: 'Тестовый товар', verdict: 'TOO_EARLY', createdAt: new Date().toISOString(), beforePerDay: 1000, afterPerDay: null, changePct: null };
  await page.route('**/api/feedback**', (route) => route.fulfill({ json: [verdict] }));
  await page.reload();
  await expect(page.getByTestId('outcomes')).toContainText('Тестовый товар');
  await page.unroute('**/api/feedback**');
  await page.route('**/api/feedback**', (route) => route.fulfill({ status: 500, body: '{}' }));
  await page.getByTestId('button-refresh-workspace').click();
  await expect(page.getByTestId('outcomes-error')).toContainText('Показаны прежние данные');
  await expect(page.getByTestId('outcomes-error-retry')).toBeEnabled();
  await expect(page.getByTestId('outcomes')).toContainText('Тестовый товар');
  await page.unroute('**/api/feedback**');

  // A new period: the figures stay on screen, marked as updating, until the answer comes.
  await page.route('**/api/shift-market/dashboard**', async (route) => { await new Promise((done) => setTimeout(done, 1200)); await route.continue(); });
  await page.getByTestId('period-7').click();
  await expect(page.getByTestId('status-refreshing')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('revenue-chart')).toBeVisible();
  await expect(page.locator('main.rf-overview')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByTestId('status-refreshing')).not.toHaveAttribute('data-active', 'true');
  await page.unroute('**/api/shift-market/dashboard**');

  // The refresh fails: the earlier figures stay, with a warning and a retry, not an error page.
  await page.route('**/api/shift-market/dashboard**', (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.getByTestId('period-90').click();
  await expect(page.getByTestId('overview-stale-error')).toContainText('Показаны прежние данные');
  await expect(page.getByTestId('revenue-chart')).toBeVisible();
  await expect(page.getByTestId('status-error')).toHaveCount(0);
  await page.unroute('**/api/shift-market/dashboard**');
  const stale = page.getByTestId('overview-stale-error');
  const staleRetry = page.getByTestId('overview-stale-error-retry');
  // A retry that fails again: the warning stays while it runs and says so (the only notice), then shows the error again.
  await page.route('**/api/shift-market/dashboard**', async (route) => { await new Promise((done) => setTimeout(done, 800)); await route.fulfill({ status: 503, body: '{}' }); });
  await staleRetry.click();
  await expect(stale).toContainText('Обновляем данные…');
  await expect(staleRetry).toBeDisabled();
  await expect(page.getByTestId('status-refreshing')).not.toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('revenue-chart')).toBeVisible();
  await expect(stale).toContainText('Ошибка на стороне сервера');
  await expect(staleRetry).toBeEnabled();
  await page.unroute('**/api/shift-market/dashboard**');
  // A retry that succeeds: the warning stays until the answer comes, then goes.
  await page.route('**/api/shift-market/dashboard**', async (route) => { await new Promise((done) => setTimeout(done, 800)); await route.continue(); });
  await staleRetry.click();
  await expect(stale).toContainText('Обновляем данные…');
  await expect(stale).toHaveCount(0);
  await expect(page.getByTestId('revenue-chart')).toBeVisible();
  await page.unroute('**/api/shift-market/dashboard**');

  // The data summary on screen stays when its update fails, marked as older.
  await page.goto('/data');
  await expect(page.locator('.grid-3 .metric-value')).toHaveCount(3);
  await page.route('**/api/data/status**', (route) => route.fulfill({ status: 500, body: '{}' }));
  await page.getByTestId('button-refresh-workspace').click();
  await expect(page.getByTestId('data-summary-error')).toContainText('Показаны прежние данные');
  await expect(page.locator('.grid-3 .metric-value')).toHaveCount(3);
  // With nothing loaded yet, it never shows a made-up 0 when its request fails.
  await page.goto('/data');
  await expect(page.getByTestId('data-summary-error')).toBeVisible();
  await expect(page.getByTestId('data-summary-error')).not.toContainText('Показаны прежние данные');
  await expect(page.locator('.grid-3 .metric-value')).toHaveCount(0);
  await page.unroute('**/api/data/status**');

  // The team list and the sync log on screen stay when their update fails, each marked as older.
  await page.goto('/settings');
  await expect(page.getByTestId('team-members')).toBeVisible();
  await expect(page.getByTestId('sync-runs')).toBeVisible();
  await page.route('**/api/workspace/members**', (route) => route.fulfill({ status: 500, body: '{}' }));
  await page.route('**/api/integrations/runs**', (route) => route.fulfill({ status: 500, body: '{}' }));
  await page.getByTestId('button-refresh-workspace').click();
  await expect(page.getByTestId('team-members-error')).toContainText('Показаны прежние данные');
  await expect(page.getByTestId('team-members')).toBeVisible();
  await expect(page.getByTestId('sync-log-error')).toContainText('Показаны прежние данные');
  await expect(page.getByTestId('sync-runs')).toBeVisible();
  await page.unroute('**/api/workspace/members**');
  await page.unroute('**/api/integrations/runs**');

  // Signed in, but the server no longer accepts the session: a way back in, not a dead end or a loop.
  await page.route('**/api/shift-market/dashboard**', (route) => route.fulfill({ status: 401, body: '{}' }));
  await page.goto('/overview');
  await expect(page.getByTestId('status-error')).toHaveAttribute('data-error-kind', 'auth');
  await page.getByTestId('button-signin-again').click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId('input-email')).toBeVisible();
  await page.unroute('**/api/shift-market/dashboard**');
});

test('states: signing in while the data page is open keeps the page working', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (error) => crashes.push(error.message));
  // A guest in the demo (opened before each test) is asked to sign in here.
  await page.goto('/data');
  await expect(page.getByTestId('empty-data')).toBeVisible();
  // Signed in elsewhere (another tab); the same page picks up the new session on refresh.
  const registered = await page.request.post('/api/auth/register', { data: { email: `data-${Date.now()}@example.kz`, password: 'password-123' } });
  expect(registered.ok()).toBe(true);
  await page.getByTestId('button-refresh-workspace').click();
  await expect(page.getByTestId('dropzone')).toBeVisible();
  await expect(page.getByTestId('empty-data')).toHaveCount(0);
  await expect(page.getByTestId('status-error')).toHaveCount(0);
  expect(crashes).toEqual([]);
});

// A timestamp the server makes at the moment of the request is not a data update: none is shown for it.
const freshnessRoutes = ['/overview', '/attention', '/products', '/advertising', '/external-media'];

test('freshness: an empty workspace shows no update time', async ({ page }) => {
  await page.goto('/register');
  await page.getByTestId('input-email').fill(`fresh-empty-${Date.now()}@example.kz`);
  await page.getByTestId('input-password').fill('password-123');
  await page.getByTestId('button-auth-submit').click();
  await expect(page.getByTestId('onboarding')).toBeVisible();
  for (const route of freshnessRoutes) {
    await page.goto(route);
    await expect(page.locator('.page-head')).toBeVisible();
    await expect(page.getByTestId('page-refreshed-at'), route).toHaveCount(0);
  }
});

test('freshness: with seller data, ads and campaigns show no update time the API cannot vouch for', async ({ page }) => {
  test.skip(!process.env.FAKE_KASPI, 'needs the fake Kaspi API (FAKE_KASPI=1, see e2e/fake-kaspi.mjs)');
  await page.goto('/register');
  await page.getByTestId('input-email').fill(`fresh-user-${Date.now()}@example.kz`);
  await page.getByTestId('input-password').fill('password-123');
  await page.getByTestId('button-auth-submit').click();
  await page.getByTestId('input-onboarding-kaspi_api').fill('test-kaspi-token');
  await page.getByTestId('onboarding-connect-kaspi_api').getByRole('button').click();
  await expect(page.getByTestId('revenue-chart')).toBeVisible({ timeout: 30_000 });
  // The overview's time is the last import and its "data up to" the last order: both shown.
  await expect(page.getByTestId('page-refreshed-at')).toBeVisible();
  await expect(page.getByTestId('page-data-as-of')).toBeVisible();
  // A workspace's log is its latest imports and verdicts, not a fixed window: no "last 7 days".
  await expect(page.locator('.rf-timeline-card')).toBeVisible();
  await expect(page.locator('.rf-timeline-window')).toHaveCount(0);
  for (const route of ['/advertising', '/external-media']) {
    await page.goto(route);
    await expect(page.locator('.page-head')).toBeVisible();
    await expect(page.getByTestId('status-data-source'), route).toBeVisible();
    await expect(page.getByTestId('page-refreshed-at'), route).toHaveCount(0);
  }
});

test('competitors: the card in its market from RedStat, without growth claims across broken months', async ({ page }) => {
  test.skip(!process.env.FAKE_REDSTAT, 'needs the fake RedStat MCP server (FAKE_REDSTAT=1, see e2e/fake-redstat.mjs)');
  await page.goto('/register');
  await page.getByTestId('input-email').fill(`market-${Date.now()}@example.kz`);
  await page.getByTestId('input-password').fill('password-123');
  await page.getByTestId('button-auth-submit').click();
  await expect(page.getByTestId('onboarding')).toBeVisible();
  const connect = await page.request.put('/api/integrations/REDSTAT_MCP', { data: { url: 'http://127.0.0.1:8098/mcp' } });
  expect(connect.status()).toBe(200);
  await page.goto('/competitors');
  await page.getByTestId('input-competitor-sku').fill('102277651');
  await page.getByTestId('button-analyze-competitors').click();
  await expect(page.getByTestId('market-product')).toContainText('EVO Laboratoires');
  await expect(page.getByTestId('market-change')).toContainText('42,7');
  await expect(page.getByTestId('market-segments').locator('tr.yours')).toContainText('Бюджетный');
  await expect(page.getByTestId('market-dynamics')).toBeVisible();
  await expect(page.getByTestId('market-brands')).toContainText('MIXIT');
  await page.getByTestId('market-note').click();
  await expect(page.getByTestId('market-product')).toContainText('неполный');
});

test('products: data gaps are listed by revenue and fixed in place from the product economics', async ({ page }) => {
  test.skip(!process.env.FAKE_KASPI, 'needs the fake Kaspi API (FAKE_KASPI=1, see e2e/fake-kaspi.mjs)');
  await page.goto('/register');
  await page.getByTestId('input-email').fill(`profit-${Date.now()}@example.kz`);
  await page.getByTestId('input-password').fill('password-123');
  await page.getByTestId('button-auth-submit').click();
  await page.getByTestId('input-onboarding-kaspi_api').fill('test-kaspi-token');
  await page.getByTestId('onboarding-connect-kaspi_api').getByRole('button').click();
  await expect(page.getByTestId('revenue-chart')).toBeVisible({ timeout: 30_000 });
  const imported = await page.request.post('/api/data/import', { data: { kind: 'PRODUCTS', products: [{ sku: 'FX-1', costPrice: 1800, commissionPct: 12, stock: 40 }] } });
  expect(imported.status()).toBe(200);

  await page.goto('/products');
  await expect(page.getByTestId('data-issue-SOLD_NOT_IN_CATALOG')).toContainText('2');
  await expect(page.getByTestId('data-issue-NO_LOGISTICS')).toBeVisible();
  await page.getByTestId('fix-NO_LOGISTICS-FX-1').click();
  await expect(page.getByTestId('product-economics')).toContainText('Крем для рук');
  await page.getByTestId('economics-logisticsCost').fill('500');
  await page.getByTestId('economics-save').click();
  await expect(page.getByTestId('data-issue-NO_LOGISTICS')).toHaveCount(0);
  await expect(page.getByTestId('economics-net')).not.toContainText('не указано');
});

test('needs attention: thresholds crossed are listed, counted in the menu and lead to the product', async ({ page }) => {
  test.skip(!process.env.FAKE_KASPI, 'needs the fake Kaspi API (FAKE_KASPI=1, see e2e/fake-kaspi.mjs)');
  await page.goto('/register');
  await page.getByTestId('input-email').fill(`attention-${Date.now()}@example.kz`);
  await page.getByTestId('input-password').fill('password-123');
  await page.getByTestId('button-auth-submit').click();
  await page.getByTestId('input-onboarding-kaspi_api').fill('test-kaspi-token');
  await page.getByTestId('onboarding-connect-kaspi_api').getByRole('button').click();
  await expect(page.getByTestId('revenue-chart')).toBeVisible({ timeout: 30_000 });
  // One unit left of a product that sells every day, with a 14-day lead time.
  await page.request.post('/api/data/import', { data: { kind: 'PRODUCTS', products: [{ sku: 'FX-1', costPrice: 1800, commissionPct: 12, logisticsCost: 300, stock: 1, leadTimeDays: 14 }] } });
  await page.goto('/attention');
  await expect(page.getByTestId('attention-STOCK_BEFORE_DELIVERY:FX-1')).toBeVisible();
  await expect(page.getByTestId('attention-DATA_SOLD_NOT_IN_CATALOG')).toBeVisible();
  await expect(page.getByTestId('attention-badge')).toBeVisible();
  await page.getByTestId('attention-STOCK_BEFORE_DELIVERY:FX-1').getByRole('link').click();
  await expect(page).toHaveURL(/\/products\?sku=FX-1/);
  await expect(page.getByTestId('product-economics')).toContainText('Крем для рук');
});

test('needs attention: the demo shop shows its list without signing in', async ({ page }) => {
  await page.goto('/attention');
  await expect(page.getByTestId('attention-high')).toBeVisible();
});

test('media plans: the agency file is read as written, its arithmetic checked, and the fact gives delivery', async ({ page }) => {
  await page.goto('/register');
  await page.getByTestId('input-email').fill(`media-${Date.now()}@example.kz`);
  await page.getByTestId('input-password').fill('password-123');
  await page.getByTestId('button-auth-submit').click();
  await expect(page.getByTestId('onboarding')).toBeVisible();

  await page.goto('/media-plans');
  await page.getByTestId('media-file').setInputFiles(new URL('./fixtures/media-plan.xlsx', import.meta.url).pathname);
  // The detailed sheet wins over the summary and over the rate card with more rows.
  await expect(page.getByTestId('media-preview')).toContainText('Детальный Медиаплан');
  await expect(page.getByTestId('media-preview')).toContainText('5');
  await page.getByTestId('media-client').fill("L'Oréal");
  await page.getByTestId('media-save').click();

  await page.getByTestId('media-plan-list').getByRole('link').first().click();
  // Light: rows add up to 3 050 000 ₸, the file's total says 3 850 000 ₸; the Kaspi package has no forecast.
  await expect(page.getByTestId('media-check-TOTAL_MISMATCH')).toBeVisible();
  await expect(page.getByTestId('media-check-MISSING_FORECAST')).toContainText('Kaspi');

  await page.getByRole('tab', { name: /МЕДИУМ/ }).click();
  await page.getByTestId('media-fact-impressions-3').fill('900 000');
  await page.getByTestId('media-fact-clicks-3').fill('7200');
  await page.getByTestId('media-fact-save-3').click();
  await expect(page.getByTestId('media-delivery-3')).toContainText('75');
  await expect(page.getByTestId('media-totals')).toContainText('75');
});

test('agency: one sign-in, an agency next to the shop, and a viewer invited by link who can only look', async ({ page, browser }) => {
  const stamp = Date.now();
  await page.goto('/register');
  await page.getByTestId('input-email').fill(`agency-owner-${stamp}@example.kz`);
  await page.getByTestId('input-password').fill('password-123');
  await page.getByTestId('button-auth-submit').click();
  await expect(page.getByTestId('workspace-switcher')).toContainText('Магазин');

  // The agency is created from the switcher and opens straight away.
  await page.getByTestId('workspace-switcher').click();
  await page.getByTestId('workspace-create-agency').click();
  await page.getByTestId('workspace-new-name').fill(`Okori ${stamp}`);
  await page.getByTestId('workspace-create-submit').click();
  await expect(page.getByTestId('workspace-name')).toHaveText(`Okori ${stamp}`);
  await expect(page.getByTestId('workspace-switcher')).toContainText('Агентство');
  await page.getByTestId('media-file').setInputFiles(new URL('./fixtures/media-plan.xlsx', import.meta.url).pathname);
  await page.getByTestId('media-client').fill("L'Oréal");
  await page.getByTestId('media-save').click();
  await expect(page.getByTestId('media-plan-list')).toContainText("L'Oréal");

  // The shop does not see the agency's plans.
  await page.getByTestId('workspace-switcher').click();
  await page.getByTestId('workspace-option-shop').click();
  await page.goto('/media-plans');
  await expect(page.getByTestId('media-file')).toBeAttached();
  await expect(page.getByTestId('media-plan-list')).toHaveCount(0);
  await page.getByTestId('workspace-switcher').click();
  await page.getByTestId('workspace-option-agency').click();

  await page.goto('/settings');
  await page.getByTestId('invite-role').selectOption('VIEWER');
  await page.getByTestId('invite-create').click();
  const link = await page.getByTestId('invite-url').inputValue();
  expect(link).toMatch(/\/invite\//);

  // A colleague opens the link, creates an account and comes back to accept it.
  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto(link);
  await expect(guest.getByTestId('invite-text')).toContainText(`Okori ${stamp}`);
  await guest.getByTestId('invite-register').click();
  await guest.getByTestId('input-email').fill(`agency-viewer-${stamp}@example.kz`);
  await guest.getByTestId('input-password').fill('password-123');
  await guest.getByTestId('button-auth-submit').click();
  await guest.getByTestId('invite-accept').click();
  await expect(guest.getByTestId('workspace-name')).toHaveText(`Okori ${stamp}`);
  await expect(guest.getByTestId('viewer-banner')).toBeVisible();
  await guest.goto('/media-plans');
  await expect(guest.getByTestId('media-plan-list')).toContainText("L'Oréal");
  await expect(guest.getByTestId('media-file')).toHaveCount(0);
  await guest.getByTestId('media-plan-list').getByRole('link').first().click();
  await expect(guest.getByTestId('media-fact-readonly-0')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId(`member-agency-viewer-${stamp}@example.kz`)).toContainText('Наблюдатель');
  await context.close();
});

// ---- C01-01 / C01-02: responsive layout and table visibility ----
// Phone, tablet, laptop and wide desktop. The page itself never scrolls sideways; a wide table
// scrolls inside its own wrapper, keeps the row name in view and, from tablet up, the decision too.
const layoutViewports = [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }, { width: 1440, height: 900 }];

async function checkLayout(page: Page, label: string, decisionFrom?: number) {
  const width = page.viewportSize()?.width ?? 0;
  const layout = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    return {
      pageOverflow: document.documentElement.scrollWidth - viewport,
      tables: [...document.querySelectorAll('.table-scroll')].map((wrap) => {
        const box = wrap.getBoundingClientRect();
        const first = wrap.querySelector('thead th')?.getBoundingClientRect();
        const decision = wrap.querySelector('thead .col-decision')?.getBoundingClientRect();
        const visible = (cell?: DOMRect) => (cell ? cell.left >= box.left - 1 && cell.right <= Math.min(box.right, viewport) + 1 : null);
        return { inside: box.right <= viewport + 1, firstVisible: visible(first), decisionVisible: visible(decision) };
      }),
    };
  });
  expect(layout.pageOverflow, `${label} at ${width}px: page scrolls sideways`).toBeLessThanOrEqual(0);
  expect(layout.tables.length, `${label}: tables found`).toBeGreaterThan(0);
  for (const table of layout.tables) {
    expect(table.inside, `${label} at ${width}px: table wrapper stays inside the page`).toBe(true);
    expect(table.firstVisible, `${label} at ${width}px: first column in view`).toBe(true);
    if (decisionFrom !== undefined && table.decisionVisible !== null && width >= decisionFrom) expect(table.decisionVisible, `${label} at ${width}px: decision column in view`).toBe(true);
  }
}

test('layout: external media, products and advertising fit every screen width with demo data', async ({ page }) => {
  const routes: Array<[string, string, string, number?]> = [
    ['/external-media', '[data-testid^="row-campaign-"]', 'external media'],
    ['/products', '[data-testid^="row-product-"]', 'products', 768],
    ['/advertising', '[data-testid="advertising-activity-feed"]', 'advertising'],
  ];
  for (const viewport of layoutViewports) {
    await page.setViewportSize(viewport);
    for (const [route, ready, label, decisionFrom] of routes) {
      await page.goto(route);
      await expect(page.locator(ready).first()).toBeVisible();
      await checkLayout(page, label, decisionFrom);
    }
  }
});

test('layout: a seller\'s products keep the period, the source and the update time in view at every width, and the decision from tablet up', async ({ page }) => {
  test.skip(!process.env.FAKE_KASPI, 'needs the fake Kaspi API (FAKE_KASPI=1, see e2e/fake-kaspi.mjs)');
  await page.goto('/register');
  await page.getByTestId('input-email').fill(`layout-${Date.now()}@example.kz`);
  await page.getByTestId('input-password').fill('password-123');
  await page.getByTestId('button-auth-submit').click();
  await page.getByTestId('input-onboarding-kaspi_api').fill('test-kaspi-token');
  await page.getByTestId('onboarding-connect-kaspi_api').getByRole('button').click();
  await expect(page.getByTestId('revenue-chart')).toBeVisible({ timeout: 30_000 });
  for (const viewport of layoutViewports) {
    await page.setViewportSize(viewport);
    await page.goto('/products');
    await expect(page.locator('[data-testid^="row-product-"]').first()).toBeVisible();
    // The page head: period (7/30/90 and the comparison), data source and update time, all within the screen.
    for (const testId of ['period-7', 'period-30', 'period-90', 'select-compare', 'status-data-source', 'page-refreshed-at']) {
      const element = page.getByTestId(testId);
      await expect(element, `${testId} at ${viewport.width}px`).toHaveCount(1);
      await expect(element, `${testId} at ${viewport.width}px`).toBeVisible();
      const box = await element.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= viewport.width + 1, `${testId} at ${viewport.width}px: within the screen`).toBe(true);
    }
    await checkLayout(page, 'seller products', 768);
  }
});

// The scroll cue is a scroll-driven CSS animation of two custom properties on the wrapper:
// --rf-table-start (0 at the left edge, then 1) and --rf-table-end (1 until the right edge, then 0).
// Where the browser lacks scroll-driven animations only the geometry is checked.
async function tableScroll(page: Page, wrapper: string) {
  return page.evaluate((selector) => {
    const wrap = document.querySelector(selector) as HTMLElement;
    const box = wrap.getBoundingClientRect();
    const style = getComputedStyle(wrap);
    const rect = (cell: Element | null) => cell?.getBoundingClientRect();
    const first = rect(wrap.querySelector('thead th'));
    const decision = rect(wrap.querySelector('thead .col-decision'));
    const last = rect(wrap.querySelector('thead th:last-child'));
    return {
      scrollLeft: wrap.scrollLeft, maxScroll: wrap.scrollWidth - wrap.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      firstOffset: first ? Math.round(first.left - box.left) : null,
      decisionOffset: decision ? Math.round(box.right - decision.right) : null,
      lastVisible: last ? last.right <= box.right + 1 && last.left >= box.left - 1 : null,
      cue: CSS.supports('animation-timeline: scroll()') ? { start: Number(style.getPropertyValue('--rf-table-start')), end: Number(style.getPropertyValue('--rf-table-end')) } : null,
    };
  }, wrapper);
}

async function scrollTable(page: Page, wrapper: string, deltaX: number) {
  const before = (await tableScroll(page, wrapper)).scrollLeft;
  await page.locator(wrapper).hover();
  await page.mouse.wheel(deltaX, 0);
  await expect.poll(async () => (await tableScroll(page, wrapper)).scrollLeft).not.toBe(before);
}

test('layout: a wide table scrolls inside its wrapper with pinned columns and a cue at start, middle and end', async ({ page }) => {
  const cases: Array<{ route: string; ready: string; wrapper: string; width: number; pinned: 'first' | 'decision' | 'none' }> = [
    { route: '/products', ready: '[data-testid^="row-product-"]', wrapper: 'main .table-scroll', width: 768, pinned: 'decision' },
    { route: '/products', ready: '[data-testid^="row-product-"]', wrapper: 'main .table-scroll', width: 375, pinned: 'first' },
    { route: '/advertising', ready: '[data-testid="advertising-activity-feed"]', wrapper: '[data-testid="advertising-activity-feed"] .table-scroll', width: 768, pinned: 'none' },
  ];
  for (const { route, ready, wrapper, width, pinned } of cases) {
    const label = `${route} at ${width}px`;
    await page.setViewportSize({ width, height: 900 });
    await page.goto(route);
    await expect(page.locator(ready).first()).toBeVisible();

    // Start: the table is wider than its wrapper, the page is not.
    const start = await tableScroll(page, wrapper);
    expect(start.maxScroll, `${label}: table overflows its wrapper`).toBeGreaterThan(0);
    expect(start.scrollLeft, label).toBe(0);
    expect(start.pageOverflow, `${label}: page scrolls sideways`).toBeLessThanOrEqual(0);
    if (start.cue) await expect.poll(async () => (await tableScroll(page, wrapper)).cue, `${label}: cue at start`).toEqual({ start: 0, end: 1 });

    // Middle: scrolled by the wheel, the page still does not move, pinned columns stay where they were.
    await scrollTable(page, wrapper, 120);
    const middle = await tableScroll(page, wrapper);
    expect(middle.scrollLeft, label).toBeLessThan(middle.maxScroll);
    expect(middle.pageOverflow, `${label}: page scrolls sideways`).toBeLessThanOrEqual(0);
    if (pinned === 'first') expect(middle.firstOffset, `${label}: first column pinned`).toBe(start.firstOffset);
    if (pinned === 'decision') expect(middle.decisionOffset, `${label}: decision column pinned`).toBe(start.decisionOffset);
    if (middle.cue) await expect.poll(async () => (await tableScroll(page, wrapper)).cue, `${label}: cue in the middle`).toEqual({ start: 1, end: 1 });

    // End: every column reachable, including the last one (decision / impact on orders).
    await scrollTable(page, wrapper, 5000);
    await expect.poll(async () => { const state = await tableScroll(page, wrapper); return state.maxScroll - state.scrollLeft; }, `${label}: scrolled to the end`).toBeLessThanOrEqual(1);
    const end = await tableScroll(page, wrapper);
    expect(end.lastVisible, `${label}: last column in view at the end`).toBe(true);
    expect(end.pageOverflow, `${label}: page scrolls sideways`).toBeLessThanOrEqual(0);
    if (pinned === 'first') expect(end.firstOffset, `${label}: first column pinned`).toBe(start.firstOffset);
    if (pinned === 'decision') expect(end.decisionOffset, `${label}: decision column pinned`).toBe(start.decisionOffset);
    if (end.cue) await expect.poll(async () => (await tableScroll(page, wrapper)).cue, `${label}: cue at the end`).toEqual({ start: 1, end: 0 });
  }
});

test('layout: advertising keeps the whole impact on orders readable at every width', async ({ page }) => {
  for (const viewport of layoutViewports) {
    await page.setViewportSize(viewport);
    await page.goto('/advertising');
    await expect(page.getByTestId('advertising-activity-feed')).toBeVisible();
    const impact = await page.evaluate(() => {
      const wrap = document.querySelector('[data-testid="advertising-activity-feed"] .table-wrap') as HTMLElement;
      const cells = [...wrap.querySelectorAll('tbody td:last-child')] as HTMLElement[];
      const header = wrap.querySelector('thead th:last-child') as HTMLElement;
      return {
        rows: cells.length,
        clipped: cells.filter((cell) => cell.scrollWidth > cell.clientWidth + 1).map((cell) => cell.textContent),
        columnEnd: header.offsetLeft + header.offsetWidth,
        scrollWidth: wrap.scrollWidth,
      };
    });
    expect(impact.rows, `${viewport.width}px`).toBeGreaterThan(0);
    // No value is cut off, and the column lies within the scrollable width, so it can be reached.
    expect(impact.clipped, `${viewport.width}px: clipped impact values`).toEqual([]);
    expect(impact.columnEnd, `${viewport.width}px: impact column inside the scrollable table`).toBeLessThanOrEqual(impact.scrollWidth + 1);
  }
});

// ---- C01 PR 2: truthful states and interaction fixes ----
// Every point within 11.5 px of a control's centre must land on the control itself (a 24 px circle, WCAG 2.5.8).
async function hitArea(page: Page, selector: string, { inline = true }: { inline?: boolean } = {}) {
  return page.evaluate(async ({ selector, inline }) => {
    const misses: string[] = [];
    let checked = 0;
    for (const control of document.querySelectorAll(selector)) {
      if (!control.getBoundingClientRect().width) continue;
      control.scrollIntoView({ block: 'center', inline: inline ? 'center' : 'nearest' });
      await new Promise((done) => requestAnimationFrame(() => done(null)));
      const box = control.getBoundingClientRect();
      // Inside a wide table that is not scrolled: only controls the wrapper actually shows can be hit.
      const wrapper = inline ? null : control.closest('.table-scroll')?.getBoundingClientRect();
      if (wrapper && (box.left - 12 < wrapper.left || box.right + 12 > wrapper.right)) continue;
      checked += 1;
      for (let step = 0; step < 8; step += 1) {
        const angle = (step * Math.PI) / 4;
        const hit = document.elementFromPoint(box.left + box.width / 2 + 11.5 * Math.cos(angle), box.top + box.height / 2 + 11.5 * Math.sin(angle));
        if (!hit || !(hit === control || control.contains(hit))) { misses.push(`${(control as HTMLElement).className} → ${hit?.className ?? 'nothing'}`); break; }
      }
    }
    return { checked, misses };
  }, { selector, inline });
}

test('hit areas: glossary hints and "more" toggles are at least 24 × 24 and still work from the keyboard', async ({ page }) => {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/overview', '/advertising', '/external-media']) {
      await page.goto(route);
      await expect(page.locator('.hint-trigger').first()).toBeVisible();
      for (const selector of ['.hint-trigger', '.reveal-toggle']) {
        const result = await hitArea(page, selector);
        expect(result.checked, `${route} ${selector} at ${width}px`).toBeGreaterThan(0);
        expect(result.misses, `${route} ${selector} at ${width}px`).toEqual([]);
      }
    }
    // Table headers, with the table at its start: the hints in columns the wrapper shows.
    await page.goto('/products');
    await expect(page.locator('[data-testid^="row-product-"]').first()).toBeVisible();
    const headers = await hitArea(page, 'main .table-scroll .hint-trigger', { inline: false });
    expect(headers.checked, `products table hints at ${width}px`).toBeGreaterThan(0);
    expect(headers.misses, `products table hints at ${width}px`).toEqual([]);
    // Matrix dots already had a 28 px area; where two products sit closer than that, the nearer dot wins.
    const dots = await hitArea(page, 'button.matrix-dot', { inline: false });
    expect(dots.checked).toBeGreaterThan(0);
    expect(dots.misses.filter((miss) => !miss.split('→')[1].includes('matrix-dot')), `matrix dots at ${width}px`).toEqual([]);
  }
  // Keyboard: the enlarged controls are still ordinary buttons.
  await page.goto('/overview');
  const toggle = page.getByTestId('reveal-action').first();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const hint = page.locator('.hint-trigger').first();
  await hint.focus();
  await expect(hint).toBeFocused();
});

test('seller: settings tell help from errors, give each card one main action, and keep small controls reachable', async ({ page }) => {
  test.skip(!process.env.FAKE_KASPI, 'needs the fake Kaspi API (FAKE_KASPI=1, see e2e/fake-kaspi.mjs)');
  await page.goto('/register');
  await page.getByTestId('input-email').fill(`settings-${Date.now()}@example.kz`);
  await page.getByTestId('input-password').fill('password-123');
  await page.getByTestId('button-auth-submit').click();
  await page.getByTestId('input-onboarding-kaspi_api').fill('test-kaspi-token');
  await page.getByTestId('onboarding-connect-kaspi_api').getByRole('button').click();
  await expect(page.getByTestId('revenue-chart')).toBeVisible({ timeout: 30_000 });

  // C01-12: the first import has nothing to compare with yet, so every change is zero: no colour, no arrow.
  const changes = page.locator('[data-testid^="metric-change-"]');
  await expect(changes.first()).toBeVisible();
  for (const change of await changes.all()) {
    if ((await change.textContent())?.trim() !== '0%') continue;
    await expect(change).toHaveClass(/\bneutral\b/);
    await expect(change.locator('svg')).toHaveCount(0);
  }

  await page.goto('/settings');
  const colour = (testId: string) => page.getByTestId(testId).evaluate((element) => { const style = getComputedStyle(element); return { color: style.color, size: parseFloat(style.fontSize) }; });
  const danger = await page.evaluate(() => { const probe = document.createElement('span'); probe.style.color = 'var(--rf-color-danger-text)'; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; });

  // C01-09: the saved-key note is guidance, linked to its field, and does not look like an error.
  const helper = await colour('hint-secret-kaspi_api');
  expect(helper.color).not.toBe(danger);
  expect(helper.size).toBeGreaterThanOrEqual(11);
  await expect(page.getByTestId('input-secret-kaspi_api')).toHaveAttribute('aria-describedby', /secret-hint-KASPI_API/);
  await expect(page.getByTestId('input-secret-kaspi_api')).not.toHaveAttribute('aria-invalid', 'true');

  // An error is announced, coloured as an error and attached to the fields it is about.
  await page.getByTestId('button-save-custom_mcp').click();
  const error = page.getByTestId('error-connection-custom_mcp');
  await expect(error).toHaveAttribute('role', 'alert');
  expect((await colour('error-connection-custom_mcp')).color).toBe(danger);
  for (const input of ['input-url-custom_mcp', 'input-secret-custom_mcp']) {
    await expect(page.getByTestId(input)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId(input)).toHaveAttribute('aria-describedby', /connection-error-CUSTOM_MCP/);
  }
  // The other cards stay as they were.
  await expect(page.getByTestId('input-secret-kaspi_api')).not.toHaveAttribute('aria-invalid', 'true');

  // C01-10: one primary action per card; disconnecting is destructive, never a plain secondary.
  const isPrimary = async (testId: string) => !/\b(secondary|danger)\b/.test((await page.getByTestId(testId).getAttribute('class')) ?? '');
  expect(await isPrimary('button-sync-kaspi_api'), 'connected: update data is the main action').toBe(true);
  expect(await isPrimary('button-save-kaspi_api'), 'connected: a new key is secondary').toBe(false);
  await expect(page.getByTestId('button-remove-kaspi_api')).toHaveClass(/\bdanger\b/);
  for (const kind of ['moysklad', 'redstat_mcp', 'custom_mcp']) expect(await isPrimary(`button-save-${kind}`), `${kind}: connecting is the main action`).toBe(true);
  for (const card of await page.locator('[data-testid^="connection-"]').all()) {
    const primaries = await card.locator('button.btn').evaluateAll((buttons) => buttons.filter((button) => !/\b(secondary|danger)\b/.test(button.className)).length);
    expect(primaries, `${await card.getAttribute('data-testid')}: primary actions`).toBe(1);
  }
  await expect(page.getByTestId('button-logout-all')).toHaveClass(/\bdanger\b/);

  // C01-11: the product name in the decision table is a full-size target too.
  await page.goto('/products');
  await expect(page.locator('.row-link').first()).toBeVisible();
  const links = await hitArea(page, '.row-link', { inline: false });
  expect(links.checked).toBeGreaterThan(0);
  expect(links.misses).toEqual([]);
});
