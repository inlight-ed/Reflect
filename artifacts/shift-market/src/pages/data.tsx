import { useMemo, useRef, useState, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileSpreadsheet, Loader2, UploadCloud } from 'lucide-react';
import { Link } from 'wouter';
import { ApiError, importData, useGetDataStatus } from '@workspace/api-client-react';
import { formatDate, formatNumber, formatTime, useI18n } from '@/lib/i18n';
import { buildRows, FIELDS, missingRequired, readFile, remap, type Dataset, type SheetCandidate } from '@/lib/importer';
import { useSession } from '@/lib/session';
import { downloadTemplate } from '@/lib/template';
import { BlockError, EmptyState, PageFrame, PageHead, SectionTitle, useText } from '@/components/common';
import { SkeletonMetric } from '@/components/ui';
import { useShownError } from '@/lib/query-state';
import { ProgressBar } from '@/components/motion';

type Item = { id: string; order: number; fileName: string; candidate: SheetCandidate; state: 'ready' | 'importing' | 'done' | 'error'; message?: string; progress?: { done: number; total: number } };
const CHUNK = 5000;

export default function DataPage() {
  const { locale, t } = useI18n();
  const text = useText();
  const { signedIn, refresh } = useSession();
  const queryClient = useQueryClient();
  const status = useGetDataStatus({ query: { enabled: signedIn, queryKey: ['/api/data/status'] } });
  // Hooks stay above the sign-in check below: signing in re-renders this same component.
  const statusError = useShownError(status);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState<Array<{ id: string; name: string }>>([]);
  const input = useRef<HTMLInputElement>(null);
  const nextOrder = useRef(0);

  if (!signedIn) {
    return <PageFrame><PageHead eyebrow={t('data.eyebrow')} title={t('data.title')} subtitle={t('data.subtitle')} /><div className="card"><EmptyState label="data" message={t('data.signin')} /><div className="center-actions"><Link href="/login" className="btn">{t('landing.cta.login')}</Link></div></div></PageFrame>;
  }

  const update = (id: string, patch: Partial<Item>) => setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const addFiles = async (files: FileList | File[]) => {
    setError('');
    // Files are parsed in a Web Worker, so the page stays responsive; show which ones are still being read.
    // Cards keep the order the files were chosen in, whichever finishes parsing first.
    await Promise.all(Array.from(files).map(async (file) => {
      const order = nextOrder.current++;
      const id = `${file.name}-${order}`;
      setReading((current) => [...current, { id, name: file.name }]);
      try {
        const candidates = await readFile(file);
        setItems((current) => [...current, ...candidates.map((candidate, index) => ({ id: `${id}-${candidate.sheet}-${index}`, order: order + index / 1000, fileName: file.name, candidate, state: 'ready' as const }))].sort((a, b) => a.order - b.order));
      } catch (err) {
        setError(t(err instanceof Error ? err.message : 'import.error.generic'));
      } finally {
        setReading((current) => current.filter((entry) => entry.id !== id));
      }
    }));
  };

  const runImport = async (item: Item) => {
    const dataset = item.candidate.dataset;
    if (!dataset) return;
    const built = buildRows(item.candidate);
    const rows = built.orders ?? built.products ?? built.ads ?? [];
    if (!rows.length) {
      update(item.id, { state: 'error', message: t('import.error.NO_VALID_ROWS') });
      return;
    }
    update(item.id, { state: 'importing', progress: { done: 0, total: rows.length } });
    let accepted = 0;
    let skipped = built.valid < item.candidate.rows.length ? item.candidate.rows.length - built.valid : 0;
    try {
      for (let start = 0; start < rows.length; start += CHUNK) {
        const part = rows.slice(start, start + CHUNK);
        const body = dataset === 'ORDERS' ? { kind: dataset, fileName: item.fileName.slice(0, 200), orders: part as never } : dataset === 'PRODUCTS' ? { kind: dataset, fileName: item.fileName.slice(0, 200), products: part as never } : { kind: dataset, fileName: item.fileName.slice(0, 200), ads: part as never };
        const result = await importData(body);
        accepted += result.accepted;
        skipped += result.skipped;
        update(item.id, { progress: { done: Math.min(rows.length, start + CHUNK), total: rows.length } });
      }
      update(item.id, { state: 'done', message: text('data.imported', { accepted, skipped }) });
      await refresh();
    } catch (err) {
      const code = err instanceof ApiError && (err.data as { error?: string } | undefined)?.error;
      update(item.id, { state: 'error', message: t(code === 'NO_VALID_ROWS' ? 'import.error.NO_VALID_ROWS' : 'import.error.generic') });
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files);
  };


  const summary = status.data;
  return (
    <PageFrame>
      <PageHead eyebrow={t('data.eyebrow')} title={t('data.title')} subtitle={t('data.subtitle')} action={<button type="button" className="btn secondary" onClick={() => void downloadTemplate(locale)} data-testid="button-template"><FileSpreadsheet size={14} /> {t('data.template')}</button>} />
      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-testid="dropzone"
      >
        <UploadCloud size={28} aria-hidden />
        <p className="dropzone-title">{t('data.drop')}</p>
        <p className="dropzone-hint">{t('data.drop.hint')}</p>
        <button type="button" className="btn" onClick={() => input.current?.click()}>{t('data.choose')}</button>
        <input ref={input} type="file" multiple accept=".csv,.xlsx,.xls,.txt" className="visually-hidden-input" onChange={(event) => { if (event.target.files) void addFiles(event.target.files); event.currentTarget.value = ''; }} data-testid="input-data-file" />
        <p className="dropzone-hint">{t('data.template.hint')}</p>
      </div>
      {error && <div className="report-notice error" role="alert">{error}</div>}
      {reading.map((entry) => <div className="card card-pad import-reading" role="status" key={entry.id} data-testid="import-reading"><Loader2 size={16} className="spin" aria-hidden /><span>{text('data.reading', { name: entry.name })}</span></div>)}

      {items.filter((item) => item.state === 'ready' && item.candidate.dataset && !missingRequired(item.candidate).length).length > 1 && (
        <div className="import-all"><button type="button" className="btn" onClick={() => { void (async () => { for (const item of items.filter((entry) => entry.state === 'ready' && entry.candidate.dataset && !missingRequired(entry.candidate).length)) await runImport(item); })(); }} data-testid="button-import-all">{t('data.importAll')}</button></div>
      )}
      {items.map((item) => <ImportCard key={item.id} item={item} onChange={(candidate) => update(item.id, { candidate, state: 'ready', message: undefined })} onImport={() => void runImport(item)} onRemove={() => setItems((current) => current.filter((other) => other.id !== item.id))} />)}

      <SectionTitle title={t('data.summary')} />
      {/* Loading shows the cards' outline and a failure says so: never a made-up 0. A failed update over
          figures already on screen keeps them, marked as older. */}
      {statusError ? <BlockError error={statusError} onRetry={status.refetch} what={t('data.summary')} stale={Boolean(summary)} refreshing={status.isFetching} testId="data-summary-error" /> : null}
      {!summary ? !statusError && <div className="grid grid-3" aria-busy="true" data-testid="data-summary-loading"><SkeletonMetric /><SkeletonMetric /><SkeletonMetric /></div>
        : <>
      <div className="grid grid-3">
        <div className="card metric-card"><div className="eyebrow">{t('data.kind.ORDERS')}</div><div className="metric-value">{formatNumber(summary.orders, locale)}</div><div className="neutral small-note">{t('data.summary.orders')}</div></div>
        <div className="card metric-card"><div className="eyebrow">{t('data.kind.PRODUCTS')}</div><div className="metric-value">{formatNumber(summary.products, locale)}</div><div className="neutral small-note">{t('data.summary.products')}</div></div>
        <div className="card metric-card"><div className="eyebrow">{t('data.kind.ADS')}</div><div className="metric-value">{formatNumber(summary.ads, locale)}</div><div className="neutral small-note">{t('data.summary.ads')}</div></div>
      </div>
      {summary.firstOrderAt && summary.lastOrderAt && <p className="section-note standalone">{text('data.summary.range', { from: summary.firstOrderAt.slice(0, 10), to: summary.lastOrderAt.slice(0, 10) })}</p>}

      <SectionTitle title={t('data.history')} />
      <div className="card table-wrap">
        {summary.imports.length ? <table className="data-table"><thead><tr><th>{t('Дата')}</th><th>{t('data.col.what')}</th><th>{t('data.col.source')}</th><th>{t('data.col.rows')}</th></tr></thead><tbody>
          {summary.imports.map((row) => <tr key={row.id}><td>{formatDate(row.createdAt, locale)} {formatTime(row.createdAt, locale)}</td><td>{t(`data.kind.${row.kind}`)}<span className="table-sub">{row.fileName ?? ''}</span></td><td>{t(`data.source.${row.source}`)}</td><td>{formatNumber(row.rows, locale)}</td></tr>)}
        </tbody></table> : <EmptyState label="imports" message={t('onboarding.step1.body')} />}
      </div>
      </>}
    </PageFrame>
  );
}

function ImportCard({ item, onChange, onImport, onRemove }: { item: Item; onChange: (candidate: SheetCandidate) => void; onImport: () => void; onRemove: () => void }) {
  const { t } = useI18n();
  const text = useText();
  const { candidate } = item;
  const missing = missingRequired(candidate);
  // Rebuilding rows is O(rows); do it only when the mapping changes, not on every progress update.
  const built = useMemo(() => (candidate.dataset ? buildRows(candidate) : { valid: 0 }), [candidate]);
  const fields = candidate.dataset ? FIELDS[candidate.dataset] : [];
  const busy = item.state === 'importing';
  return (
    <section className={`card import-card ${item.state}`} data-testid="import-card">
      <div className="import-head">
        <div>
          <strong>{item.fileName}</strong>
          <span className="table-sub">{t('data.sheet')}: {candidate.sheet} · {text('data.rows', { count: candidate.rows.length })}</span>
        </div>
        <div className="import-kind">
          <label htmlFor={`kind-${item.id}`}>{candidate.dataset ? t('data.detected') : t('data.unrecognised')}{candidate.isKaspi ? ` · ${t('data.kaspi')}` : ''}</label>
          <select id={`kind-${item.id}`} value={candidate.dataset ?? ''} disabled={busy || item.state === 'done'} onChange={(event) => onChange(event.target.value ? remap(candidate, event.target.value as Dataset) : { ...candidate, dataset: undefined })} data-testid="select-dataset">
            <option value="">{t('data.skip')}</option>
            {(['ORDERS', 'PRODUCTS', 'ADS'] as Dataset[]).map((dataset) => <option key={dataset} value={dataset}>{t(`data.kind.${dataset}`)}</option>)}
          </select>
        </div>
      </div>
      {candidate.dataset && item.state !== 'done' && (
        <details className="mapping" open={missing.length > 0}>
          <summary>{t('data.mapping')}</summary>
          <div className="mapping-grid">
            {fields.map((field) => (
              <label key={field.key} className="mapping-row">
                <span>{t(`field.${field.key}`)}{field.required && <em> · {t('data.required')}</em>}</span>
                <select value={candidate.mapping[field.key] ?? ''} onChange={(event) => onChange({ ...candidate, mapping: { ...candidate.mapping, [field.key]: event.target.value || undefined } })} disabled={busy} data-testid={`map-${field.key}`}>
                  <option value="">{t('data.mapping.none')}</option>
                  {candidate.headers.map((header) => <option key={header} value={header}>{header}</option>)}
                </select>
              </label>
            ))}
          </div>
        </details>
      )}
      <div className="import-foot">
        {item.state === 'done' ? <span className="positive"><span className="success-pop"><CheckCircle2 size={14} /></span> {item.message}</span>
          : item.state === 'error' ? <span className="negative" role="alert">{item.message}</span>
          : busy && item.progress ? <span>{text('data.importing', { done: item.progress.done, total: item.progress.total })}</span>
          : missing.length ? <span className="negative">{text('data.missing', { fields: missing.map((key) => t(`field.${key}`)).join(', ') })}</span>
          : candidate.dataset ? <span>{text('data.preview', { count: built.valid })}</span> : <span className="neutral">{t('data.unrecognised')}</span>}
        <div className="import-buttons">
          {item.state !== 'done' && <button type="button" className="btn secondary" onClick={onRemove} disabled={busy}>{t('Отмена')}</button>}
          {item.state !== 'done' && candidate.dataset && <button type="button" className="btn" onClick={onImport} disabled={busy || missing.length > 0 || built.valid === 0} data-testid="button-import">{t('data.import')}</button>}
        </div>
      </div>
      {busy && item.progress && <ProgressBar value={item.progress.done / Math.max(1, item.progress.total)} label={text('data.importing', { done: item.progress.done, total: item.progress.total })} />}
    </section>
  );
}
