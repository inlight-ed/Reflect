import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ExternalLink, HelpCircle, Plus, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Link } from 'wouter';
import { getGetCardAnalysisQueryKey, useCreateCardEvent, useGetCardAnalysis, type CardEventInputKind, type CheckItem } from '@workspace/api-client-react';
import { formatCurrency, formatDate, formatNumber, useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { EmptyState, ErrorState, LoadingState, PageFrame, PageHead, SectionTitle, SourcePill, useText } from '@/components/common';
import { Onboarding } from '@/components/seller';

const eventKinds: CardEventInputKind[] = ['PHOTO', 'TITLE', 'DESCRIPTION', 'PRICE', 'OTHER'];
const marketChecks = new Set(['card.rating', 'card.reviews', 'card.negative', 'card.price', 'card.sellers']);

function CheckCard({ item }: { item: CheckItem }) {
  const { t } = useI18n();
  const text = useText();
  const Icon = item.status === 'PASS' ? CheckCircle2 : item.status === 'WARN' ? AlertTriangle : HelpCircle;
  return (
    <div className={`card check-card ${item.status.toLowerCase()}`} data-testid={`check-${item.key}`}>
      <div className="check-head"><Icon size={16} aria-hidden /><span className="card-title">{t(item.key)}</span></div>
      <p>{item.status === 'UNKNOWN' ? t(marketChecks.has(item.key) ? 'card.unknown.redstat' : 'card.unknown.orders') : text(`${item.key}.desc`, item.params)}</p>
    </div>
  );
}

function AddEvent({ sku }: { sku: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const create = useCreateCardEvent();
  const [kind, setKind] = useState<CardEventInputKind>('PHOTO');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  return (
    <form className="card card-pad event-form" onSubmit={(event) => {
      event.preventDefault();
      create.mutate({ data: { sku, kind, ...(note.trim() ? { note: note.trim() } : {}), happenedAt: `${date}T12:00:00+05:00` } }, { onSuccess: () => { setNote(''); void queryClient.invalidateQueries({ queryKey: getGetCardAnalysisQueryKey().slice(0, 1) }); } });
    }}>
      <div className="field"><label htmlFor="event-kind">{t('card.events.kind')}</label><select id="event-kind" value={kind} onChange={(event) => setKind(event.target.value as CardEventInputKind)}>{eventKinds.map((value) => <option key={value} value={value}>{t(`event.${value}`)}</option>)}</select></div>
      <div className="field"><label htmlFor="event-date">{t('card.events.date')}</label><input id="event-date" type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setDate(event.target.value)} /></div>
      <div className="field grow"><label htmlFor="event-note">{t('card.events.note.label')}</label><input id="event-note" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} /></div>
      <button type="submit" className="btn" disabled={create.isPending} data-testid="button-add-event"><Plus size={14} /> {t('card.events.add')}</button>
    </form>
  );
}

export default function ContentPage() {
  const { locale, sourceT, t } = useI18n();
  const text = useText();
  const { signedIn } = useSession();
  const [sku, setSku] = useState<string>();
  const query = useGetCardAnalysis(sku ? { sku } : undefined);
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} />;
  const data = query.data;
  const head = <PageHead eyebrow={t('card.eyebrow')} title={t('card.title')} subtitle={t('card.subtitle')} source={data.source} />;
  if (data.mode === 'EMPTY') return <PageFrame>{head}<Onboarding /></PageFrame>;
  if (!data.sku) return <PageFrame>{head}<div className="card"><EmptyState label="products" message={t('card.noProducts')} /></div></PageFrame>;

  return (
    <PageFrame>
      {head}
      <div className="card card-pad card-selector">
        <div className="field"><label htmlFor="card-sku">{t('card.select')}</label>
          <select id="card-sku" value={data.sku} onChange={(event) => setSku(event.target.value)} data-testid="select-card-sku">
            {data.products.map((product) => <option key={product.sku} value={product.sku}>{product.name} · {product.sku}</option>)}
          </select>
        </div>
        <div className="card-facts">
          {data.revenue !== undefined && <span>{t('Выручка')} · {t('period.30')} <strong>{formatCurrency(data.revenue, locale)}</strong></span>}
          {data.trendPct !== null && data.trendPct !== undefined && <span className={data.trendPct >= 0 ? 'positive' : 'negative'}>{data.trendPct > 0 ? '+' : ''}{formatNumber(data.trendPct, locale, 1)}%</span>}
          {data.kaspiUrl && <a href={data.kaspiUrl} target="_blank" rel="noreferrer noopener" className="btn secondary"><ExternalLink size={14} /> {t('card.openKaspi')}</a>}
        </div>
      </div>
      {data.detail && <div className="card card-pad competitor-status" role="status"><p>{sourceT(data.detail)}</p>{data.detail === 'connector.redstat.connect_in_settings' && signedIn && <Link href="/settings" className="btn secondary">{t('competitors.openSettings')}</Link>}</div>}
      {!data.kaspiCode && data.mode === 'USER' && <div className="assumption-note"><HelpCircle size={14} aria-hidden /><div><p>{t('card.noKaspiCode')}</p></div><Link href="/data" className="btn secondary">{t('nav.data')}</Link></div>}

      <SectionTitle title={t('card.checklist')} note={t('card.checklist.note')} />
      <div className="grid grid-3">{data.checklist.filter((item) => !(data.detail === 'connector.redstat.connect_in_settings' && item.status === 'UNKNOWN' && marketChecks.has(item.key))).map((item) => <CheckCard key={item.key} item={item} />)}</div>

      {data.themes && (
        <>
          <SectionTitle title={data.reviews ? text('card.reviewsSummary', { count: data.reviews.count, rating: data.reviews.averageRating ?? 0 }) : t('card.themes.praise')} note={t(data.themes.mode === 'AI' ? 'card.themes.ai' : 'card.themes.rules')} />
          <div className="grid grid-2">
            <div className="card card-pad theme-card positive"><div className="check-head"><ThumbsUp size={15} aria-hidden /><span className="card-title">{t('card.themes.praise')}</span></div><div className="chips">{data.themes.praise.length ? data.themes.praise.map((theme) => <span className="chip" key={theme}>{t(theme)}</span>) : '—'}</div></div>
            <div className="card card-pad theme-card negative"><div className="check-head"><ThumbsDown size={15} aria-hidden /><span className="card-title">{t('card.themes.complaints')}</span></div><div className="chips">{data.themes.complaints.length ? data.themes.complaints.map((theme) => <span className="chip" key={theme}>{t(theme)}</span>) : '—'}</div></div>
          </div>
        </>
      )}

      <SectionTitle title={t('card.events')} note={t('card.events.note')} />
      {signedIn && data.mode === 'USER' ? <AddEvent sku={data.sku} /> : <p className="section-note standalone">{t('card.events.signin')}</p>}
      <div className="card table-wrap">
        {data.events.length ? <table className="data-table"><thead><tr><th>{t('Дата')}</th><th>{t('card.events.kind')}</th><th>{t('outcomes.before')}</th><th>{t('outcomes.after')}</th><th>{t('Рост')}</th></tr></thead><tbody>
          {data.events.map((event) => <tr key={event.id}>
            <td>{formatDate(event.happenedAt, locale)}</td>
            <td>{t(`event.${event.kind}`)}{event.note && <span className="table-sub">{event.note}</span>}</td>
            <td>{event.beforePerDay === null || event.beforePerDay === undefined ? '—' : formatCurrency(event.beforePerDay, locale)}</td>
            <td>{event.afterPerDay === null || event.afterPerDay === undefined ? <span className="neutral">{t('outcomes.waiting')}</span> : <>{formatCurrency(event.afterPerDay, locale)}<span className="table-sub">{text('outcomes.days', { days: event.daysAfter ?? 0 })}</span></>}</td>
            <td className={(event.changePct ?? 0) >= 0 ? 'positive' : 'negative'}>{event.changePct === null || event.changePct === undefined ? '—' : `${event.changePct > 0 ? '+' : ''}${formatNumber(event.changePct, locale, 1)}%`}</td>
          </tr>)}
        </tbody></table> : <EmptyState label="events" message={t('card.events.empty')} />}
      </div>
      <div className="section-gap" />
      <SourcePill source={data.source} />
    </PageFrame>
  );
}
