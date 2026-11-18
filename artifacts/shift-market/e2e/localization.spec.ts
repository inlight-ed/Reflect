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
  refreshed: string;
  activityDate: string;
  ctr: string;
  currency: string;
  demoLabel: string;
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
    refreshed: 'ОБНОВЛЕНО 09:42',
    activityDate: '17 авг.',
    ctr: '4,57%',
    currency: '92,40 ₸',
    demoLabel: 'ДЕМО / ОЦЕНКА',
    signalLabel: 'СИГНАЛ ИИ · ДЕМО-ОЦЕНКА',
    errorTitle: 'Сигнал недоступен',
    errorBody: 'Источник не вернул корректный снимок данных. Повторите подключение.',
    retryLabel: 'Повторить',
    connectorStatus: 'НЕ ПОДКЛЮЧЕНО',
    connectorDetail: 'Прямое подключение появится позже. Сейчас можно загрузить отчёт продаж из файла.',
  },
  {
    locale: 'kk',
    languageText: 'Қазақша',
    advertisingHeading: 'Жарнама арналары',
    refreshed: 'ЖАҢАРТЫЛДЫ 09:42',
    activityDate: '17 там.',
    ctr: '4,57%',
    currency: '92,40 ₸',
    demoLabel: 'ДЕМО / БАҒАЛАУ',
    signalLabel: 'AI СИГНАЛЫ · ДЕМО БАҒАЛАУ',
    errorTitle: 'Сигнал қолжетімсіз',
    errorBody: 'Дерек көзі дұрыс дерек үзіндісін қайтармады. Қайта қосып көріңіз.',
    retryLabel: 'Қайталау',
    connectorStatus: 'ҚОСЫЛМАҒАН',
    connectorDetail: 'Тікелей қосылым кейінірек пайда болады. Қазір сату есебін файлдан жүктеуге болады.',
  },
  {
    locale: 'en',
    languageText: 'English',
    advertisingHeading: 'Advertising channels',
    refreshed: 'UPDATED 09:42 AM',
    activityDate: 'Aug 17',
    ctr: '4.57%',
    currency: '₸92.40',
    demoLabel: 'DEMO / ESTIMATED',
    signalLabel: 'AI SIGNAL · DEMO ESTIMATE',
    errorTitle: 'Signal unavailable',
    errorBody: 'The source did not return a valid data snapshot. Try the connection again.',
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

test.beforeEach(async ({ page }, testInfo) => {
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

    await expect(page.locator('.page-meta')).toContainText(expected.refreshed);
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
    await expect(errorState).toContainText(expected.locale === 'en' ? 'DATA / DEMO' : expected.locale === 'kk' ? 'ДЕРЕКТЕР / ДЕМО' : 'ДАННЫЕ / ДЕМО');
    await expect(errorState).not.toContainText(rawApiMessage);

    responseMode = 'empty';
    await page.getByTestId('button-retry').click();
    await expect(page.getByTestId('empty-channels')).toBeVisible();
    await expect(page.getByTestId('status-data-source')).toHaveText(expected.locale === 'en' ? 'DATA / DEMO' : expected.locale === 'kk' ? 'ДЕРЕКТЕР / ДЕМО' : 'ДАННЫЕ / ДЕМО');
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
  await expect(firstAction).toContainText('ДОЗАКАЗАТЬ');
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

test('agency: a brand representative invited to one client sees that client only', async ({ page, browser }) => {
  const stamp = Date.now();
  await page.goto('/register');
  await page.getByTestId('input-email').fill(`limited-owner-${stamp}@example.kz`);
  await page.getByTestId('input-password').fill('password-123');
  await page.getByTestId('button-auth-submit').click();
  await page.getByTestId('workspace-switcher').click();
  await page.getByTestId('workspace-create-agency').click();
  await page.getByTestId('workspace-new-name').fill(`Okori ${stamp}`);
  await page.getByTestId('workspace-create-submit').click();
  await expect(page.getByTestId('workspace-name')).toHaveText(`Okori ${stamp}`);

  // Two clients, one plan each.
  for (const client of ["L'Oréal", 'LG']) {
    await page.getByTestId('media-file').setInputFiles(new URL('./fixtures/media-plan.xlsx', import.meta.url).pathname);
    await page.getByTestId('media-client').fill(client);
    await page.getByTestId('media-save').click();
    await expect(page.getByTestId('media-plan-list')).toContainText(client);
  }

  // The link gives the guest L'Oréal only.
  await page.goto('/settings');
  await page.getByTestId('invite-role').selectOption('VIEWER');
  await page.getByTestId('invite-clients-some').check();
  await page.getByTestId("invite-clients-client-L'Oréal").check();
  await page.getByTestId('invite-create').click();
  const link = await page.getByTestId('invite-url').inputValue();

  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto(link);
  await guest.getByTestId('invite-register').click();
  await guest.getByTestId('input-email').fill(`limited-brand-${stamp}@example.kz`);
  await guest.getByTestId('input-password').fill('password-123');
  await guest.getByTestId('button-auth-submit').click();
  await guest.getByTestId('invite-accept').click();
  await expect(guest.getByTestId('workspace-name')).toHaveText(`Okori ${stamp}`);

  // Workspace-wide pages are closed: the guest lands in media plans, which show their client only.
  await guest.goto('/overview');
  await expect(guest).toHaveURL(/\/media-plans$/);
  await expect(guest.getByTestId('media-plan-list')).toContainText("L'Oréal");
  await expect(guest.getByTestId('media-plan-list')).not.toContainText('LG');
  await expect(guest.getByTestId('link-nav-обзор')).toHaveCount(0);

  // The owner sees what the guest was given, and can change it.
  await page.reload();
  const summary = page.getByTestId(`member-clients-limited-brand-${stamp}@example.kz-summary`);
  await expect(summary).toContainText('1 из 2');
  await page.getByTestId(`member-clients-limited-brand-${stamp}@example.kz-edit`).click();
  await page.getByTestId(`member-clients-limited-brand-${stamp}@example.kz-picker-all`).check();
  await page.getByTestId(`member-clients-limited-brand-${stamp}@example.kz-save`).click();
  await expect(summary).toContainText('Все клиенты');
  await guest.goto('/media-plans');
  await expect(guest.getByTestId('media-plan-list')).toContainText('LG');
  await context.close();
});
