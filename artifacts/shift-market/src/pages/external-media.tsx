import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Plus, X } from 'lucide-react';
import { getGetExternalMediaQueryKey, useCreateExternalCampaign, useGetExternalMedia } from '@workspace/api-client-react';
import { fill, formatCurrency, formatDate, formatNumber, useI18n } from '@/lib/i18n';
import { ConfidenceDisclosure, EmptyState, ErrorState, Hint, LoadingState, PageFrame, PageHead, SectionTitle, SummaryCard, demoSource, statusLabel } from '@/components/common';
import { Link } from 'wouter';
import { useSession } from '@/lib/session';

type CampaignForm = { name: string; channel: string; startDate: string; endDate: string; budget: string; objective: string };
const emptyForm: CampaignForm = { name: '', channel: '', startDate: '', endDate: '', budget: '', objective: '' };
const statusTone: Record<string, string> = { ACTIVE: 'tag-scale', PLANNED: 'tag-optimize', COMPLETE: 'tag-keep' };

export default function ExternalMediaPage() {
  const { locale, t } = useI18n();
  const { signedIn } = useSession();
  const query = useGetExternalMedia();
  const queryClient = useQueryClient();
  const createCampaign = useCreateExternalCampaign();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<CampaignForm>(emptyForm);
  const [formError, setFormError] = useState('');
  useEffect(() => {
    const first = query.data?.impacts?.[0]?.campaignId ?? query.data?.campaigns?.[0]?.id;
    if (!selectedId && first) setSelectedId(first);
  }, [query.data, selectedId]);
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} source={query.data?.source} />;
  const data = query.data;
  const campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedId);
  const selectedImpact = (data.impacts ?? []).find((impact) => impact.campaignId === selectedId) ?? null;
  const closeModal = () => { setModalOpen(false); setFormError(''); };
  const submitCampaign = () => {
    if (!form.name.trim() || !form.channel.trim() || !form.startDate || !form.endDate || !form.objective.trim() || form.budget === '') { setFormError(t('Заполните все поля перед добавлением кампании.')); return; }
    if (form.endDate < form.startDate) { setFormError(t('Дата окончания не может быть раньше даты начала.')); return; }
    createCampaign.mutate({ data: { ...form, budget: Number(form.budget) } }, {
      onSuccess: (campaign) => {
        setModalOpen(false); setForm(emptyForm); setFormError(''); setSelectedId(campaign.id); setNotice(t('Кампания добавлена в ленту медиа.'));
        void queryClient.invalidateQueries({ queryKey: getGetExternalMediaQueryKey() }); window.setTimeout(() => setNotice(''), 3500);
      },
      onError: () => setFormError(t('Не удалось добавить кампанию. Проверьте подключение и повторите попытку.')),
    });
  };
  return (
    <PageFrame>
      <PageHead eyebrow="Спрос за пределами Kaspi" title="Понимайте, что меняет продажи." subtitle="События кампаний в разрезе до / во время / после." source={data.source ?? demoSource} mode={data.mode} refreshedAt={data.mode === 'DEMO' ? data.refreshedAt : undefined /* for a workspace the API sends the moment of the request, not a data update */} action={signedIn ? <button className="btn" onClick={() => setModalOpen(true)} data-testid="button-add-campaign"><Plus size={14} /> {t('Добавить кампанию')}</button> : <Link href="/register" className="btn secondary" title={t('media.signin')}><Plus size={14} /> {t('Добавить кампанию')}</Link>} />
      <div className="grid split-7-5 media-split">
        <div className="card">
          <div className="card-header"><span className="card-title">{t('Реестр кампаний')}</span><span className="card-kicker">{campaigns.length} {t('событий')}</span></div>
          {campaigns.length ? <div className="table-wrap"><table className="data-table selectable"><thead><tr><th>{t('Кампания')}</th><th>{t('Канал')}</th><th>{t('Даты')}</th><th>{t('Бюджет')}</th><th>{t('Статус')}</th></tr></thead><tbody>{campaigns.map((campaign) => (
            <tr key={campaign.id} onClick={() => setSelectedId(campaign.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(campaign.id); } }} tabIndex={0} aria-selected={campaign.id === selectedId} className={campaign.id === selectedId ? 'selected-row' : ''} data-testid={`row-campaign-${campaign.id}`}>
              <td>{campaign.name}<span className="table-sub">{t(campaign.objective)}</span></td><td>{t(campaign.channel)}</td><td>{formatDate(campaign.startDate, locale)} — {formatDate(campaign.endDate, locale)}</td><td>{formatCurrency(campaign.budget, locale)}</td><td><span className={`status-tag ${statusTone[campaign.status] ?? 'tag-keep'}`}>{t(statusLabel(campaign.status))}</span></td>
            </tr>
          ))}</tbody></table></div> : <EmptyState label="кампаний" />}
        </div>
        {data.insight ? <SummaryCard insight={data.insight} compact /> : <div className="card"><EmptyState label="market signal" /></div>}
      </div>
      <SectionTitle title={<>{t('Разбор эффекта')}{selectedCampaign ? ` / ${selectedCampaign.name}` : ''}</>} note={selectedImpact ? <>{t('оценка влияния · уверенность')} {selectedImpact.confidence}%</> : undefined} />
      <div className="card">
        {selectedImpact ? <>
          <div className="card-header"><span className="card-title">{t('До / во время / после')}</span><span className="card-kicker">{t('GMV и рост заказов')}</span></div>
          {Array.isArray(selectedImpact.periods) ? <div className="table-wrap"><table className="data-table"><thead><tr><th>{t('Период')}</th><th><Hint term="GMV">GMV</Hint></th><th>{t('Заказы')}</th><th>{t('Единицы')}</th><th><Hint term="AOV">{t('Средний чек')}</Hint></th><th>{t('Рост')}</th></tr></thead><tbody>{selectedImpact.periods.map((period, index) => <tr key={`${period.label}-${index}`}><td>{t(period.label)}</td><td>{formatCurrency(period.gmv, locale)}</td><td>{formatNumber(period.orders, locale)}</td><td>{formatNumber(period.units, locale)}</td><td>{formatCurrency(period.aov, locale, 2)}</td><td className={period.growth >= 0 ? 'positive' : 'negative'}>{period.growth > 0 ? '+' : ''}{formatNumber(period.growth, locale, 1)}%</td></tr>)}</tbody></table></div> : <EmptyState label="breakdown" />}
          <div className="card-pad impact-totals"><div><div className="eyebrow">{t('Базовый GMV')}</div><div className="metric-value">{formatCurrency(selectedImpact.baseline, locale)}</div></div><div><div className="eyebrow">{t('Дополнительный GMV')}</div><div className="metric-value positive">{formatCurrency(selectedImpact.incremental, locale)}</div></div><div><div className="eyebrow"><Hint term="confidence">{t('УВЕРЕННОСТЬ')}</Hint></div><div className="metric-value">{selectedImpact.confidence}%</div></div></div>
          <div className="card-pad impact-basis"><ConfidenceDisclosure basis={selectedImpact.confidenceBasis} testId="reveal-impact-confidence" /></div>
        </> : <EmptyState label="impact" message={t(selectedCampaign?.status === 'PLANNED' ? 'media.noImpact' : 'Для этой кампании разбор эффекта ещё не рассчитан. Он появится, когда накопятся данные о продажах до, во время и после кампании.')} />}
      </div>
      {modalOpen && <CampaignModal form={form} setForm={setForm} error={formError} pending={createCampaign.isPending} onClose={closeModal} onSubmit={submitCampaign} />}
      {notice && <div className="toast-note" role="status" data-testid="status-campaign-created"><Check size={14} style={{ verticalAlign: 'middle', marginRight: 7 }} />{notice}</div>}
    </PageFrame>
  );
}

function CampaignModal({ form, setForm, error, pending, onClose, onSubmit }: { form: CampaignForm; setForm: (next: CampaignForm) => void; error: string; pending: boolean; onClose: () => void; onSubmit: () => void }) {
  const { t } = useI18n();
  const firstField = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const update = (key: keyof CampaignForm, value: string) => setForm({ ...form, [key]: value });
  useEffect(() => {
    firstField.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="campaign-modal-title">
    <div className="modal-head"><div><h2 className="modal-title" id="campaign-modal-title">{t('Добавить событие кампании')}</h2><p className="modal-copy">{t('Зафиксируйте момент, когда внешний спрос вошёл в рынок.')}</p></div><button className="modal-close" onClick={onClose} data-testid="button-close-campaign-modal" aria-label={t('Закрыть')}><X size={17} /></button></div>
    <form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <div className="field"><label htmlFor="campaign-name">{t('Название кампании')}</label><input ref={firstField} id="campaign-name" maxLength={120} value={form.name} onChange={(event) => update('name', event.target.value)} placeholder={t('Июньский всплеск продаж')} data-testid="input-campaign-name" /></div>
      <div className="grid grid-2"><div className="field"><label htmlFor="campaign-channel">{t('Канал')}</label><input id="campaign-channel" maxLength={60} value={form.channel} onChange={(event) => update('channel', event.target.value)} placeholder="Telegram" data-testid="input-campaign-channel" /></div><div className="field"><label htmlFor="campaign-objective">{t('Цель')}</label><input id="campaign-objective" maxLength={160} value={form.objective} onChange={(event) => update('objective', event.target.value)} placeholder={t('Захват спроса')} data-testid="input-campaign-objective" /></div></div>
      <div className="grid grid-2"><div className="field"><label htmlFor="campaign-start">{t('Дата начала')}</label><input id="campaign-start" type="date" value={form.startDate} onChange={(event) => update('startDate', event.target.value)} data-testid="input-campaign-start" /></div><div className="field"><label htmlFor="campaign-end">{t('Дата окончания')}</label><input id="campaign-end" type="date" min={form.startDate || undefined} value={form.endDate} onChange={(event) => update('endDate', event.target.value)} data-testid="input-campaign-end" /></div></div>
      <div className="field"><label htmlFor="campaign-budget">{t('Бюджет')}</label><input id="campaign-budget" type="number" inputMode="numeric" min="0" step="1000" value={form.budget} onChange={(event) => update('budget', event.target.value)} placeholder="0" data-testid="input-campaign-budget" /></div>
      {error && <small role="alert">{error}</small>}
      <div className="form-actions"><button type="button" className="btn secondary" onClick={onClose} data-testid="button-cancel-campaign">{t('Отмена')}</button><button type="submit" className="btn" disabled={pending} data-testid="button-submit-campaign">{pending ? t('Добавляем…') : t('Добавить кампанию')}</button></div>
    </form>
  </div></div>;
}
