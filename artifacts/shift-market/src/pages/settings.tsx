import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleDot, Database, LogOut, MonitorSmartphone, RefreshCw, Unplug, UploadCloud } from 'lucide-react';
import { Link } from 'wouter';
import { getGetIntegrationsQueryKey, getGetSyncRunsQueryKey, useDeleteConnection, useGetIntegrations, useGetSyncRuns, useLogoutEverywhere, useSaveConnection, useSyncConnection, type Connection, type ConnectionKind, type IntegrationStatus, type SyncRun } from '@workspace/api-client-react';
import { formatDate, formatNumber, formatTime, useI18n } from '@/lib/i18n';
import { useShownError } from '@/lib/query-state';
import { useSession } from '@/lib/session';
import { EmptyState, ErrorState, LoadingState, PageFrame, PageHead, SectionTitle, demoSource, statusLabel, useText, BlockError } from '@/components/common';
import { TeamSection } from '@/components/workspace';
import { HoldButton } from '@/components/motion';

const needsUrl = (kind: ConnectionKind) => kind === 'REDSTAT_MCP' || kind === 'CUSTOM_MCP';
const canSync = (kind: ConnectionKind) => kind === 'KASPI_API' || kind === 'MOYSKLAD';

function ConnectionCard({ connection }: { connection: Connection }) {
  const { locale, sourceT, t } = useI18n();
  const text = useText();
  const { refresh } = useSession();
  const queryClient = useQueryClient();
  const save = useSaveConnection();
  const sync = useSyncConnection();
  const remove = useDeleteConnection();
  const [url, setUrl] = useState(connection.url ?? '');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const kind = connection.kind;
  const after = async () => { await queryClient.invalidateQueries({ queryKey: getGetIntegrationsQueryKey() }); await refresh(); };
  const submit = () => {
    setError('');
    if ((needsUrl(kind) && !url.trim()) || (!connection.secretHint && !secret.trim() && !needsUrl(kind))) { setError(t('conn.error.input')); return; }
    save.mutate({ kind, data: { ...(url.trim() ? { url: url.trim() } : {}), ...(secret.trim() ? { secret: secret.trim() } : {}) } }, { onSuccess: () => { setSecret(''); void after(); }, onError: () => setError(t('conn.error.input')) });
  };
  const status = connection.status;
  const syncing = status === 'SYNCING';
  const busy = save.isPending || sync.isPending || remove.isPending || syncing;
  return (
    <section className={`card connection-card ${status.toLowerCase()}`} data-testid={`connection-${kind.toLowerCase()}`}>
      <div className="connection-head">
        <div><h3>{t(`conn.${kind}.title`)}</h3><p>{t(`conn.${kind}.body`)}</p></div>
        <span className={`connection-status ${status === 'CONNECTED' ? '' : status === 'ERROR' ? 'error' : 'idle'}`}>
          {status === 'CONNECTED' ? <CheckCircle2 size={13} /> : status === 'ERROR' ? <AlertTriangle size={13} /> : <CircleDot size={13} />} {t(`conn.status.${status}`)}
        </span>
      </div>
      {connection.detail && status !== 'NOT_CONNECTED' && <p className={`connection-detail ${status === 'ERROR' ? 'negative' : ''}`} role="status">{sourceT(connection.detail)}</p>}
      <form className="connection-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        {needsUrl(kind) && <div className="field"><label htmlFor={`url-${kind}`}>{t('conn.url')}</label><input id={`url-${kind}`} type="url" inputMode="url" placeholder="https://" value={url} maxLength={500} onChange={(event) => setUrl(event.target.value)} data-testid={`input-url-${kind.toLowerCase()}`} /></div>}
        <div className="field"><label htmlFor={`secret-${kind}`}>{t('conn.secret')}</label><input id={`secret-${kind}`} type="password" autoComplete="off" value={secret} maxLength={4096} onChange={(event) => setSecret(event.target.value)} placeholder={connection.secretHint ?? ''} data-testid={`input-secret-${kind.toLowerCase()}`} />{connection.secretHint && <small className="hint-text">{text('conn.secret.saved', { hint: connection.secretHint })}</small>}</div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="connection-actions">
          <button type="submit" className="btn" disabled={busy} data-testid={`button-save-${kind.toLowerCase()}`}>{save.isPending ? t('conn.saving') : t('conn.save')}</button>
          {(status === 'CONNECTED' || syncing) && canSync(kind) && <button type="button" className="btn secondary" disabled={busy} onClick={() => sync.mutate({ kind }, { onSuccess: () => void queryClient.invalidateQueries({ queryKey: getGetIntegrationsQueryKey() }) })} data-testid={`button-sync-${kind.toLowerCase()}`}><RefreshCw size={14} className={syncing ? 'spin' : undefined} /> {syncing || sync.isPending ? t('conn.syncing') : t('conn.sync')}</button>}
          {status !== 'NOT_CONNECTED' && <HoldButton className="secondary danger" disabled={busy} description={t('conn.remove.confirm')} onConfirm={() => remove.mutate({ kind }, { onSuccess: () => { setSecret(''); void after(); } })} testId={`button-remove-${kind.toLowerCase()}`}><Unplug size={14} /> {t('conn.remove')}</HoldButton>}
        </div>
      </form>
      <div className="connection-meta">
        {connection.lastSyncAt && <span>{text('conn.lastSync', { time: `${formatDate(connection.lastSyncAt, locale)} ${formatTime(connection.lastSyncAt, locale)}` })}</span>}
        {connection.imported !== undefined && <span>{text('conn.imported', { count: formatNumber(connection.imported, locale) })}</span>}
        {connection.tools && connection.tools.length > 0 && <span>{text('conn.tools', { tools: connection.tools.slice(0, 8).map((tool) => tool.name).join(', ') })}</span>}
      </div>
    </section>
  );
}

function SyncRunLog({ runs }: { runs: SyncRun[] }) {
  const { locale, sourceT, t } = useI18n();
  const seconds = (run: SyncRun) => (run.finishedAt ? Math.max(1, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000)) : null);
  return <>
    <SectionTitle title={t('conn.runs.title')} note={t('conn.runs.note')} />
    <div className="card table-wrap" data-testid="sync-runs"><table className="data-table">
      <thead><tr><th>{t('Дата')}</th><th>{t('conn.runs.source')}</th><th>{t('conn.runs.result')}</th><th>{t('conn.runs.rows')}</th><th>{t('conn.runs.duration')}</th></tr></thead>
      <tbody>{runs.map((run) => <tr key={run.id}>
        <td>{formatDate(run.startedAt, locale)} {formatTime(run.startedAt, locale)}</td>
        <td>{t(`conn.${run.kind}.title`)}</td>
        <td className={run.status === 'FAILED' ? 'negative' : run.status === 'DONE' ? 'positive' : 'neutral'}>{t(`conn.runs.${run.status}`)}{run.detail && <span className="table-sub">{sourceT(run.detail)}</span>}</td>
        <td>{run.rows === null || run.rows === undefined ? '—' : formatNumber(run.rows, locale)}</td>
        <td>{seconds(run) === null ? '—' : `${formatNumber(seconds(run)!, locale)} ${t('conn.runs.sec')}`}</td>
      </tr>)}</tbody>
    </table></div>
  </>;
}

export default function SettingsPage() {
  const { locale, sourceT, safeT, t } = useI18n();
  const text = useText();
  const { signedIn, session, signOut, refresh } = useSession();
  // While a sync runs in the background, poll until every connection settles.
  const query = useGetIntegrations({ query: { queryKey: getGetIntegrationsQueryKey(), refetchInterval: (current) => (current.state.data?.connections?.some((connection) => connection.status === 'SYNCING') ? 2000 : false) } });
  const runs = useGetSyncRuns({ query: { queryKey: getGetSyncRunsQueryKey(), enabled: signedIn } });
  const runsError = useShownError(runs);
  const logoutAll = useLogoutEverywhere();
  const syncingCount = (query.data?.connections ?? []).filter((connection) => connection.status === 'SYNCING').length;
  const previousSyncing = useRef(syncingCount);
  useEffect(() => {
    // A sync just finished: new orders or stock change every page, so refresh everything.
    if (previousSyncing.current > syncingCount) void refresh();
    else if (syncingCount > previousSyncing.current) void runs.refetch();
    previousSyncing.current = syncingCount;
  }, [syncingCount, refresh, runs]);
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={query.refetch} />;
  const data = query.data;
  const demoIntegrations = [data.kaspi, data.redstat, ...(Array.isArray(data.media) ? data.media : [])].filter(Boolean) as IntegrationStatus[];
  return <PageFrame>
    <PageHead eyebrow="Workspace controls" title="Connect the signal, keep the edge." subtitle="Every connector is explicit about whether the view is live or a demo snapshot." source={signedIn ? undefined : demoSource} />
    {signedIn ? (
      <>
        <div className="card card-pad account-row">
          <span>{text('settings.account.email', { email: session?.user?.email ?? '' })}</span>
          <div className="account-actions">
            <Link href="/data" className="btn secondary"><UploadCloud size={14} /> {t('nav.data')}</Link>
            <button type="button" className="btn secondary" onClick={() => void signOut()} data-testid="button-logout"><LogOut size={14} /> {t('auth.logout')}</button>
            <HoldButton className="secondary danger" disabled={logoutAll.isPending} description={t('settings.logoutAll.confirm')} onConfirm={() => logoutAll.mutate(undefined, { onSuccess: () => void signOut().catch(() => window.location.assign('/')) })} testId="button-logout-all"><MonitorSmartphone size={14} /> {t('settings.logoutAll')}</HoldButton>
          </div>
        </div>
        <TeamSection />
        <SectionTitle title={t('settings.connections')} note={t('settings.connections.note')} />
        <div className="connection-grid">{(data.connections ?? []).map((connection) => <ConnectionCard key={connection.kind} connection={connection} />)}</div>
        {runsError ? <BlockError error={runsError} onRetry={runs.refetch} what={t('conn.runs.title')} testId="sync-log-error" /> : runs.data && runs.data.length > 0 && <SyncRunLog runs={runs.data} />}
      </>
    ) : (
      <>
        <div className="card summary settings-policy"><div className="summary-top"><span className="signal-mark"><Database size={14} /></span><span className="eyebrow">{t('Source policy')}</span></div><h2 className="summary-title">{t('Demo data is never disguised as live.')}</h2><p className="summary-body">{t('settings.signinForConnections')}</p><div className="summary-foot"><Link href="/register" className="btn">{t('landing.cta.start')}</Link><Link href="/login" className="btn secondary">{t('landing.cta.login')}</Link><span>{t('last connector audit')} {formatTime(new Date().toISOString(), locale)}</span></div></div>
        <SectionTitle title={t('Connector status')} note={<>{formatNumber(demoIntegrations.length, locale)} {t('configured sources')}</>} />
        <div className="integration-list">{demoIntegrations.length ? demoIntegrations.map((integration, index) => (
          <div className="integration-row" key={`${integration.name}-${index}`} data-testid={`row-integration-${integration.name}`}>
            <div className="integration-left"><span className="integration-icon">{integration.name[0]}</span><div><div className="integration-name">{integration.name}</div><div className="integration-detail">{sourceT(integration.detail)}</div></div></div>
            <div className={`connection-status ${integration.status === 'DEMO' ? 'demo' : integration.status === 'ERROR' ? 'error' : 'idle'}`}>{integration.status === 'DEMO' ? <CircleDot size={13} /> : <AlertTriangle size={13} />} {t(statusLabel(integration.status))} <span className="dim">·</span> {safeT(integration.source)}</div>
          </div>
        )) : <div className="card"><EmptyState label="integrations" /></div>}</div>
      </>
    )}
  </PageFrame>;
}
