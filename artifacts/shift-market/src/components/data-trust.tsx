import type { ReactNode } from 'react';
import { AlertTriangle, CircleHelp, CloudOff, Database, FlaskConical, Radar, Store } from 'lucide-react';
import { fill, formatDate, formatTime, useI18n } from '@/lib/i18n';
import { Badge, type BadgeTone } from '@/components/ui';

/*
 * Where a number comes from, how fresh it is and how sure we are.
 * Only what the API actually returns is shown: no "live" label the source does not confirm, no
 * timestamp invented when the response has none.
 */

/** Values of DataSource in the API contract, plus the status RedStat answers with. */
export type SourceStatus = 'READY' | 'PARTIAL' | 'NO_DATA' | 'NOT_CONFIGURED' | 'UNAVAILABLE';

type SourceView = { tone: BadgeTone; label: string; description: string; icon: ReactNode };

function sourceView(source: string | undefined, status: SourceStatus | undefined): SourceView {
  if (source === 'DEMO DATA' || source === 'MOCK') {
    return { tone: 'warning', label: 'source.demo', description: 'source.demo.hint', icon: <FlaskConical /> };
  }
  if (source === 'USER DATA') return { tone: 'neutral', label: 'source.yours', description: 'source.yours.hint', icon: <Store /> };
  if (source === 'REDSTAT') {
    if (status === 'PARTIAL') return { tone: 'warning', label: 'source.redstat.partial', description: 'source.redstat.partial.hint', icon: <Radar /> };
    if (status === 'NO_DATA') return { tone: 'neutral', label: 'source.redstat.noData', description: 'source.redstat.noData.hint', icon: <Radar /> };
    if (status === 'NOT_CONFIGURED') return { tone: 'neutral', label: 'source.redstat.notConfigured', description: 'source.redstat.notConfigured.hint', icon: <CloudOff /> };
    if (status === 'UNAVAILABLE') return { tone: 'danger', label: 'source.redstat.unavailable', description: 'source.redstat.unavailable.hint', icon: <AlertTriangle /> };
    return { tone: 'neutral', label: 'source.redstat', description: 'source.redstat.hint', icon: <Radar /> };
  }
  // In the contract but not sent by the API today; named honestly rather than called unavailable.
  if (source === 'KASPI API') return { tone: 'neutral', label: 'source.kaspiApi', description: 'source.external.hint', icon: <Database /> };
  if (source === 'KASPI ADS') return { tone: 'neutral', label: 'source.kaspiAds', description: 'source.external.hint', icon: <Database /> };
  if (source === 'META') return { tone: 'neutral', label: 'source.meta', description: 'source.external.hint', icon: <Database /> };
  return { tone: 'neutral', label: 'source.unknown', description: 'source.unknown.hint', icon: <CircleHelp /> };
}

/**
 * The data source in words, with its own tone and icon. Unknown and unavailable sources are never
 * shown in the "connected" colour. `status` is RedStat's answer (ready, partial, no data…).
 */
export function DataSourceBadge({ source, status, testId = 'status-data-source' }: { source?: string; status?: SourceStatus; testId?: string }) {
  const { t } = useI18n();
  const view = sourceView(source, status);
  return <Badge tone={view.tone} icon={view.icon} description={t(view.description)} testId={testId}>{t(view.label)}</Badge>;
}

const almatyYear = (value: Date) => new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'Asia/Almaty' }).format(value);

/**
 * From the API's own timestamp: when the data was updated ("updated"), when a source was last asked
 * ("checked", e.g. RedStat, whose timestamp is the time of the request), or which day the data reaches
 * ("asOf"). Renders nothing when there is no valid timestamp: the current time is never shown instead.
 */
export function DataFreshness({ at, kind = 'updated', testId }: { at?: string | null; kind?: 'updated' | 'checked' | 'asOf'; testId?: string }) {
  const { locale, t } = useI18n();
  if (!at) return null;
  const parsed = new Date(at);
  if (Number.isNaN(parsed.valueOf())) return null;
  const now = new Date();
  const otherYear = almatyYear(parsed) !== almatyYear(now);
  const date = `${formatDate(at, locale)}${otherYear ? ` ${almatyYear(parsed)}` : ''}`;
  let text: string;
  if (kind === 'asOf') text = fill(t('freshness.asOf'), { date });
  else if (!otherYear && formatDate(at, locale) === formatDate(now.toISOString(), locale)) text = fill(t(kind === 'checked' ? 'freshness.checkedToday' : 'freshness.updatedToday'), { time: formatTime(at, locale) });
  else text = fill(t(kind === 'checked' ? 'freshness.checked' : 'freshness.updated'), { date, time: formatTime(at, locale) });
  return <time className="rf-freshness" dateTime={at} data-testid={testId}>{text}</time>;
}
