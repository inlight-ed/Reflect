/**
 * The single translation catalog. Each domain file holds [ru, kk, en] triples.
 *
 * Keys follow two conventions: structured keys (`data.title`, `card.events`) and, for older
 * page copy, the source text itself. Templates use {name} placeholders filled by fill() in
 * lib/i18n.ts. `pnpm --filter @workspace/scripts run check:i18n` checks placeholders,
 * duplicate keys and that every literal t('…') key used in the app exists here.
 */
import { account } from './account';
import { analytics } from './analytics';
import { cards } from './cards';
import { data } from './data';
import { integrations } from './integrations';
import { market } from './market';
import { media } from './media';
import { source } from './source';
import type { Catalog } from './types';
import { ui } from './ui';

export type { Catalog, Triple } from './types';
export { source };

export const domains: Record<string, Catalog> = { ui, account, data, analytics, cards, integrations, market, media, source };

export const locales = ['ru', 'kk', 'en'] as const;
export type Locale = (typeof locales)[number];

const merged: Catalog = Object.assign({}, ...Object.values(domains));

function column(index: number): Record<string, string> {
  return Object.fromEntries(Object.entries(merged).map(([key, triple]) => [key, triple[index]]));
}

export const messages: Record<Locale, Record<string, string>> = { ru: column(0), kk: column(1), en: column(2) };
