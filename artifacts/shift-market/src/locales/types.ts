/** One string per locale, always in this order. A missing translation is a type error. */
export type Triple = readonly [ru: string, kk: string, en: string];
export type Catalog = Record<string, Triple>;
