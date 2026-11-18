import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileUp } from 'lucide-react';
import { Link, useRoute } from 'wouter';
import {
  ApiError,
  getGetMediaPlanQueryKey,
  getGetMediaPlansQueryKey,
  useCreateMediaPlan,
  getGetClientsQueryKey,
  useGetClients,
  useGetMediaPlan,
  useGetMediaPlans,
  useSaveMediaFact,
  type MediaBenchmark,
  type MediaCheck,
  type MediaPlacement,
  type MediaPlan,
} from '@workspace/api-client-react';
import { fill, formatCurrency, formatNumber, useI18n } from '@/lib/i18n';
import { parseMatrices } from '@/lib/import-parse';
import { parseMediaPlan, toNumber, type ParsedMediaPlan } from '@/lib/media-plan';
import { useSession } from '@/lib/session';
import { EmptyState, ErrorState, LoadingState, PageFrame, PageHead, SectionTitle } from '@/components/common';

const pct = (value: number | null | undefined, locale: Parameters<typeof formatNumber>[1]) => (value == null ? '—' : `${formatNumber(value * 100, locale, 1)}%`);
const num = (value: number | null | undefined, locale: Parameters<typeof formatNumber>[1]) => (value == null ? '—' : formatNumber(value, locale));
const money = (value: number | null | undefined, locale: Parameters<typeof formatNumber>[1]) => (value == null ? '—' : formatCurrency(value, locale));

export default function MediaPlansPage() {
  const { t } = useI18n();
  const { signedIn } = useSession();
  const [, params] = useRoute('/media-plans/:planId');
  const head = <PageHead eyebrow="media.eyebrow" title="media.title" subtitle="media.subtitle" />;
  if (!signedIn) {
    return <PageFrame>{head}<div className="card"><EmptyState label="media" message={t('media.plansSignin')} /><div className="center-actions"><Link href="/login" className="btn">{t('landing.cta.login')}</Link></div></div></PageFrame>;
  }
  return params?.planId ? <PlanView planId={params.planId} /> : <PlansList head={head} />;
}

function PlansList({ head }: { head: ReactNode }) {
  const { locale, t } = useI18n();
  const { canEdit } = useSession();
  // The client filter lives in the address so a link to "L'Oréal's plans" can be shared.
  const [clientId, setClientId] = useState(() => new URLSearchParams(window.location.search).get('client') ?? '');
  const clientsQuery = useGetClients({ query: { queryKey: getGetClientsQueryKey() } });
  const query = useGetMediaPlans(clientId ? { clientId } : undefined);
  const pick = (id: string) => {
    setClientId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('client', id); else url.searchParams.delete('client');
    window.history.replaceState(null, '', url);
  };
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} />;
  const { plans, benchmarks } = query.data;
  const clients = clientsQuery.data ?? [];
  return (
    <PageFrame>
      {head}
      {canEdit && <Upload clients={clients.map((client) => client.name)} />}
      {clients.length > 1 && (
        <div className="segmented media-clients" role="group" aria-label={t('media.client')} data-testid="media-client-filter">
          <button type="button" className={clientId ? '' : 'active'} aria-pressed={!clientId} onClick={() => pick('')}>{t('media.allClients')}</button>
          {clients.map((client) => <button type="button" key={client.id} className={clientId === client.id ? 'active' : ''} aria-pressed={clientId === client.id} onClick={() => pick(client.id)} data-testid={`media-client-${client.name}`}>{client.name} <span className="dim">{client.plans}</span></button>)}
        </div>
      )}
      {plans.length > 0 && <>
        <SectionTitle title={t('media.plans')} note={String(plans.length)} />
        <ul className="media-plans" data-testid="media-plan-list">
          {plans.map((plan) => (
            <li key={plan.id}>
              <Link href={`/media-plans/${plan.id}`} className="media-plan-link" data-testid={`media-plan-${plan.id}`}>
                <span className="media-client">{plan.client}</span>
                <strong>{plan.title}</strong>
                <span className="media-meta">
                  {fill(t('media.summary'), { variants: plan.variants.length, placements: plan.placements })}
                  {plan.checks > 0 && <em> · {fill(t('media.checksCount'), { count: plan.checks })}</em>}
                  {plan.withFact > 0 && <> · {fill(t('media.factCount'), { count: plan.withFact, total: plan.placements })}</>}
                </span>
                <span className="media-cost">{plan.variants.map((v) => money(v.cost, locale)).join(' / ')}</span>
              </Link>
            </li>
          ))}
        </ul>
      </>}
      {benchmarks.length > 0 && <Benchmarks rows={benchmarks} />}
    </PageFrame>
  );
}

function Upload({ clients }: { clients: string[] }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const create = useCreateMediaPlan();
  const input = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<(ParsedMediaPlan & { fileName: string }) | null>(null);
  const [client, setClient] = useState('');
  const [error, setError] = useState('');

  const read = async (file: File) => {
    setError('');
    setParsed(null);
    try {
      const plan = parseMediaPlan(await parseMatrices(file));
      if (!plan) { setError(t('media.notAPlan')); return; }
      setParsed({ ...plan, fileName: file.name });
    } catch (err) {
      setError(err instanceof Error && err.message.startsWith('import.') ? t(err.message) : t('media.readError'));
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!parsed || !client.trim()) return;
    try {
      await create.mutateAsync({ data: { client: client.trim(), title: parsed.title || parsed.fileName, fileName: parsed.fileName, placements: parsed.placements, declaredTotals: parsed.declaredTotals } });
      await queryClient.invalidateQueries({ queryKey: getGetMediaPlansQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getGetClientsQueryKey() });
      setParsed(null);
      if (input.current) input.current.value = '';
    } catch (err) {
      setError(err instanceof ApiError && (err.data as { error?: string } | undefined)?.error === 'LIMITED_ACCESS' ? t('media.limitedError') : t('media.saveError'));
    }
  };

  const variants = parsed ? [...new Set(parsed.placements.map((p) => p.variant))] : [];
  return (
    <section className="card card-pad media-upload" data-testid="media-upload">
      <label className="media-file">
        <FileUp size={18} aria-hidden />
        <span>{t('media.upload')}</span>
        <input ref={input} type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void read(file); }} data-testid="media-file" />
      </label>
      {parsed && (
        <form className="media-preview" onSubmit={save}>
          <p data-testid="media-preview">{fill(t('media.preview'), { title: parsed.title || parsed.fileName, sheet: parsed.sheet, placements: parsed.placements.length, variants: variants.length })}</p>
          <label>
            <span>{t('media.client')}</span>
            <input value={client} onChange={(event) => setClient(event.target.value)} list="media-clients" required placeholder="L'Oréal" data-testid="media-client" />
            <datalist id="media-clients">{clients.map((name) => <option value={name} key={name} />)}</datalist>
          </label>
          <button type="submit" className="btn" disabled={create.isPending || !client.trim()} data-testid="media-save">{t(create.isPending ? 'media.saving' : 'media.save')}</button>
        </form>
      )}
      {error && <p className="negative" role="alert">{error}</p>}
    </section>
  );
}

function PlanView({ planId }: { planId: string }) {
  const { locale, t } = useI18n();
  const query = useGetMediaPlan(planId);
  const [variant, setVariant] = useState<string>();
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} />;
  const plan = query.data;
  const current = variant && plan.variants.some((v) => v.variant === variant) ? variant : plan.variants[0]?.variant;
  const summary = plan.variants.find((v) => v.variant === current);
  const rows = plan.placements.filter((p) => p.variant === current);
  const checks = plan.checks.filter((c) => c.variant === current);
  return (
    <PageFrame>
      <Link href="/media-plans" className="media-back"><ArrowLeft size={14} aria-hidden />{t('media.back')}</Link>
      <PageHead eyebrow={plan.client} title={plan.title} subtitle={plan.fileName ?? ''} />
      {plan.variants.length > 1 && (
        <div className="segmented media-variants" role="tablist">
          {plan.variants.map((v) => <button type="button" role="tab" aria-selected={v.variant === current} className={v.variant === current ? 'active' : ''} key={v.variant} onClick={() => setVariant(v.variant)}>{v.variant}</button>)}
        </div>
      )}
      {summary && (
        <dl className="media-totals" data-testid="media-totals">
          <div><dt>{t('media.cost')}</dt><dd>{money(summary.cost, locale)}</dd></div>
          <div><dt>{t('media.planImpressions')}</dt><dd>{num(summary.planImpressions, locale)}</dd></div>
          <div><dt>{t('media.planCpm')}</dt><dd>{money(summary.planCpm, locale)}</dd></div>
          <div><dt>{t('media.delivery')}</dt><dd>{summary.withFact ? pct(summary.delivery, locale) : <small>{t('media.noFact')}</small>}</dd></div>
          <div><dt>{t('media.effectiveCpm')}</dt><dd>{summary.withFact ? money(summary.effectiveCpm, locale) : '—'}</dd></div>
        </dl>
      )}
      {checks.length > 0 && <Checks checks={checks} />}
      <SectionTitle title={t('media.placements')} note={t('media.factHint')} />
      <div className="card table-wrap">
        <table className="data-table media-table" data-testid="media-placements">
          <thead><tr>
            <th>{t('media.placement')}</th><th>{t('media.cost')}</th><th>{t('media.planShort')}</th><th>{t('media.planCpm')}</th>
            <th>{t('media.factShort')}</th><th>{t('media.delivery')}</th><th>{t('media.effectiveCpm')}</th>
          </tr></thead>
          <tbody>{rows.map((placement) => <PlacementRow key={placement.id} planId={plan.id} placement={placement} />)}</tbody>
        </table>
      </div>
    </PageFrame>
  );
}

function Checks({ checks }: { checks: MediaCheck[] }) {
  const { locale, t } = useI18n();
  return (
    <section className="media-checks" data-testid="media-checks">
      <SectionTitle title={t('media.checks')} note={String(checks.length)} />
      <ul>
        {checks.map((check, index) => (
          <li key={`${check.type}-${check.placementId ?? check.field}-${index}`} data-testid={`media-check-${check.type}`}>
            {fill(t(`media.check.${check.type}${check.field ? `.${check.field}` : ''}`), {
              label: check.label ?? '',
              declared: check.field === 'cost' ? money(check.declared, locale) : num(check.declared, locale),
              computed: check.field === 'cost' ? money(check.computed, locale) : num(check.computed, locale),
            })}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PlacementRow({ planId, placement }: { planId: string; placement: MediaPlacement }) {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const save = useSaveMediaFact();
  const { canEdit } = useSession();
  const [impressions, setImpressions] = useState(placement.factImpressions == null ? '' : String(placement.factImpressions));
  const [clicks, setClicks] = useState(placement.factClicks == null ? '' : String(placement.factClicks));
  const [error, setError] = useState(false);
  // "900 000" and 900000 are the same fact: compare numbers, not text.
  const same = (input: string, saved: number | null | undefined) => (input.trim() ? toNumber(input) === saved : saved == null);
  const changed = !same(impressions, placement.factImpressions) || !same(clicks, placement.factClicks);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const factImpressions = impressions.trim() ? toNumber(impressions) : null;
    const factClicks = clicks.trim() ? toNumber(clicks) : null;
    if ((impressions.trim() && factImpressions === null) || (clicks.trim() && factClicks === null)) { setError(true); return; }
    try {
      const plan: MediaPlan = await save.mutateAsync({ planId, placementId: placement.id, data: { factImpressions, factClicks } });
      queryClient.setQueryData(getGetMediaPlanQueryKey(planId), plan);
      await queryClient.invalidateQueries({ queryKey: getGetMediaPlansQueryKey() });
      setError(false);
    } catch {
      setError(true);
    }
  };

  const delivery = placement.delivery;
  return (
    <tr data-testid={`media-row-${placement.position}`}>
      <td><strong className="media-platform">{placement.platform}</strong>{placement.format}<span className="table-sub">{[placement.buyType, placement.period].filter(Boolean).join(' · ')}</span></td>
      <td>{money(placement.cost, locale)}</td>
      <td>{num(placement.planImpressions, locale)}<span className="table-sub">{placement.planClicks != null ? fill(t('media.clicksCtr'), { clicks: num(placement.planClicks, locale), ctr: pct(placement.planCtr, locale) }) : ''}</span></td>
      <td>{money(placement.planCpm, locale)}</td>
      <td>
        {!canEdit ? <span data-testid={`media-fact-readonly-${placement.position}`}>{num(placement.factImpressions, locale)}<span className="table-sub">{placement.factClicks != null ? fill(t('media.clicksOnly'), { clicks: num(placement.factClicks, locale) }) : ''}</span></span> :
        <form className="media-fact" onSubmit={submit}>
          <input aria-label={t('media.factImpressions')} inputMode="numeric" placeholder={t('media.factImpressions')} value={impressions} onChange={(event) => setImpressions(event.target.value)} data-testid={`media-fact-impressions-${placement.position}`} />
          <input aria-label={t('media.factClicks')} inputMode="numeric" placeholder={t('media.factClicks')} value={clicks} onChange={(event) => setClicks(event.target.value)} data-testid={`media-fact-clicks-${placement.position}`} />
          {changed && <button type="submit" className="btn btn-small" disabled={save.isPending} data-testid={`media-fact-save-${placement.position}`}>{t('media.saveFact')}</button>}
          {error && <span className="negative" role="alert">{t('media.factError')}</span>}
        </form>}
      </td>
      <td className={delivery == null ? '' : delivery < 0.95 ? 'negative' : 'positive'} data-testid={`media-delivery-${placement.position}`}>{pct(delivery, locale)}</td>
      <td>{money(placement.effectiveCpm, locale)}</td>
    </tr>
  );
}

function Benchmarks({ rows }: { rows: MediaBenchmark[] }) {
  const { locale, t } = useI18n();
  const shown = useMemo(() => rows.slice(0, 30), [rows]);
  return (
    <>
      <SectionTitle title={t('media.benchmarks')} note={t('media.benchmarksNote')} />
      <div className="card table-wrap">
        <table className="data-table" data-testid="media-benchmarks">
          <thead><tr><th>{t('media.placement')}</th><th>{t('media.used')}</th><th>{t('media.planCpm')}</th><th>{t('media.effectiveCpm')}</th><th>{t('media.delivery')}</th></tr></thead>
          <tbody>
            {shown.map((row) => (
              <tr key={`${row.platform}|${row.format}`}>
                <td><strong className="media-platform">{row.platform}</strong>{row.format}{row.buyType && <span className="table-sub">{row.buyType}</span>}</td>
                <td>{fill(t('media.usedValue'), { placements: row.placements, clients: row.clients })}</td>
                <td>{money(row.planCpm, locale)}</td>
                <td>{money(row.effectiveCpm, locale)}</td>
                <td>{pct(row.delivery, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
