import { useCallback, useEffect, useMemo, useState, createContext, createElement, useContext, type ReactNode } from "react";
import { SourceMessageKey } from "@workspace/api-client-react";
import { messages, source, type Locale } from "../locales";

export type { Locale };

export const localeOptions: Array<{ value: Locale; label: string }> = [
  { value: "ru", label: "Русский" },
  { value: "kk", label: "Қазақша" },
  { value: "en", label: "English" },
];

export type GlossaryTerm = "ROAS" | "CTR" | "CPC" | "CVR" | "CPO" | "GMV" | "SKU" | "AOV" | "stock" | "confidence";

const localeIndex: Record<Locale, number> = { ru: 0, kk: 1, en: 2 };

export const sourceMessageKeys = Object.values(SourceMessageKey) as SourceMessageKey[];

export const sourceMessageCatalog = Object.fromEntries(
  (Object.keys(localeIndex) as Locale[]).map((locale) => [locale, Object.fromEntries(sourceMessageKeys.map((key) => [key, source[key][localeIndex[locale]]]))]),
) as Record<Locale, Record<SourceMessageKey, string>>;

const fallbackMessages: Record<Locale, string> = {
  ru: "Информация недоступна",
  kk: "Ақпарат қолжетімсіз",
  en: "Information unavailable",
};

const I18nContext = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
  safeT: (key: string) => string;
  sourceT: (key: SourceMessageKey) => string;
}>({
  locale: "ru",
  setLocale: () => undefined,
  t: (key) => key,
  safeT: (key) => key,
  sourceT: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const saved = window.localStorage.getItem("shift-market-locale");
    return saved === "kk" || saved === "en" ? saved : "ru";
  });
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem("shift-market-locale", next);
  }, []);
  const t = useCallback((key: string) => messages[locale][key] ?? key, [locale]);
  const safeT = useCallback((key: string) => messages[locale][key] ?? fallbackMessages[locale], [locale]);
  const sourceT = useCallback((key: SourceMessageKey) => sourceMessageCatalog[locale][key] ?? fallbackMessages[locale], [locale]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const value = useMemo(() => ({ locale, setLocale, t, safeT, sourceT }), [locale, setLocale, safeT, sourceT, t]);
  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n() {
  return useContext(I18nContext);
}

// Kazakh uses the same digit grouping as Russian (space, decimal comma). Browsers without
// kk-KZ locale data fall back to English formatting, so numbers are formatted with ru-RU for kk.
const numberTag = (locale: Locale) => (locale === "en" ? "en-US" : "ru-RU");

export function formatNumber(value: number, locale: Locale, maximumFractionDigits = 0) {
  return new Intl.NumberFormat(numberTag(locale), { maximumFractionDigits }).format(value);
}

export function formatCurrency(value: number, locale: Locale, maximumFractionDigits = 0) {
  const formatted = new Intl.NumberFormat(numberTag(locale), {
    style: "currency",
    currency: "KZT",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits,
  }).format(value);
  if (locale !== "kk") return formatted;

  const numericValue = formatted
    .replace(/^₸\s*/, "")
    .replace(".", ",")
    .replace(/\s*₸$/, "");
  return `${numericValue} ₸`;
}

export function formatDate(value: string, locale: Locale) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  if (locale === "en") {
    return new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "short", timeZone: "Asia/Almaty" }).format(parsed);
  }
  const parts = new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "2-digit", timeZone: "Asia/Almaty" }).formatToParts(parsed);
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "0");
  const months = locale === "kk"
    ? ["қаң.", "ақп.", "нау.", "сәу.", "мам.", "мау.", "шіл.", "там.", "қыр.", "қаз.", "қар.", "жел."]
    : ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."];
  return `${day} ${months[month - 1]}`;
}

export function formatTime(value: string, locale: Locale) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" }).format(parsed);
}

/** Fill {placeholders} in a translated template. */
export function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

export function formatPercent(fraction: number, locale: Locale, maximumFractionDigits = 1) {
  return `${formatNumber(fraction * 100, locale, maximumFractionDigits)}%`;
}

const kkWeekdays = ["Жексенбі", "Дүйсенбі", "Сейсенбі", "Сәрсенбі", "Бейсенбі", "Жұма", "Сенбі"];
const kkMonths = ["қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым", "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан"];

/** Long weekday and date for page eyebrows, e.g. "Пятница / 16 октября 2026 г.". */
export function formatLongDate(value: Date, locale: Locale) {
  if (locale === "kk") {
    const parts = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "numeric", year: "numeric", timeZone: "Asia/Almaty" }).formatToParts(value);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday"));
    return `${kkWeekdays[weekday] ?? ""} / ${part("day")} ${kkMonths[Number(part("month")) - 1] ?? ""} ${part("year")}`;
  }
  const tag = locale === "en" ? "en-US" : "ru-RU";
  const weekday = new Intl.DateTimeFormat(tag, { weekday: "long", timeZone: "Asia/Almaty" }).format(value);
  const date = new Intl.DateTimeFormat(tag, { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Almaty" }).format(value);
  return `${weekday.charAt(0).toLocaleUpperCase(tag)}${weekday.slice(1)} / ${date}`;
}

/** Short money for KPI tiles: "144,2 млн ₸" / "₸144.2M". */
export function formatCompactCurrency(value: number, locale: Locale) {
  return new Intl.NumberFormat(numberTag(locale), { style: "currency", currency: "KZT", currencyDisplay: "narrowSymbol", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** "окт. 2026" / "қаз. 2026" / "Oct 2026" for chart axes. */
export function formatMonthYear(value: string, locale: Locale) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.valueOf())) return value;
  if (locale === "kk") {
    const months = ["қаң.", "ақп.", "нау.", "сәу.", "мам.", "мау.", "шіл.", "там.", "қыр.", "қаз.", "қар.", "жел."];
    return `${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  }
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "ru-RU", { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

/** Test helper: raw catalog lookup without the key fallback. */
export function __lookup(locale: Locale, key: string): string | undefined {
  return messages[locale][key];
}
