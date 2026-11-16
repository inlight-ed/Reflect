import { useEffect, useRef, useState } from 'react';
import { BrainCircuit, SendHorizontal } from 'lucide-react';
import { ApiError, useAskAssistant, type AskAnswer } from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { PageFrame, PageHead, SourcePill } from '@/components/common';

const suggestions = [
  'Почему продажи упали?',
  'Какие SKU стоит масштабировать?',
  'Почему ROAS снизился?',
  'Какой конкурент сейчас представляет наибольшую угрозу?',
  'Что произойдёт, если увеличить рекламный бюджет на 20%?',
];

type Turn = { id: number; question: string; answer?: AskAnswer; error?: string };

export default function AssistantPage() {
  const { locale, t } = useI18n();
  const ask = useAskAssistant();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 2 || ask.isPending) return;
    const id = nextId.current++;
    setTurns((current) => [...current, { id, question: trimmed }]);
    setQuestion('');
    ask.mutate({ data: { question: trimmed.slice(0, 500), locale } }, {
      onSuccess: (answer) => setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, answer } : turn))),
      onError: (error) => {
        const message = error instanceof ApiError && error.status === 429
          ? t('Слишком много вопросов подряд. Подождите минуту.')
          : t('Не удалось получить ответ. Повторите попытку.');
        setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, error: message } : turn)));
      },
    });
  };

  return (
    <PageFrame className="assistant-page">
      <PageHead eyebrow="AI-ассистент" title="Спросите о своих данных." subtitle="Ответы строятся только на данных Reflect. Если данных не хватает, ассистент так и скажет." />
      <div className="assistant-layout">
        <div className="card assistant-thread" aria-live="polite" data-testid="assistant-thread">
          {turns.length === 0 && <p className="assistant-empty">{t('Выберите вопрос или задайте свой.')}</p>}
          {turns.map((turn) => (
            <div className="assistant-turn" key={turn.id}>
              <div className="bubble user"><span className="bubble-author">{t('Вы')}</span>{turn.question}</div>
              {turn.answer ? (
                <div className="bubble assistant" data-testid="assistant-answer">
                  <span className="bubble-author"><BrainCircuit size={12} aria-hidden /> Reflect</span>
                  <div className="bubble-body">{turn.answer.answer}</div>
                  <div className="bubble-meta">
                    <span>{t(turn.answer.mode === 'AI' ? 'Ответ ИИ по данным' : 'Ответ по правилам (ИИ не подключён)')}</span>
                    {turn.answer.insufficientData && <span className="status-tag tag-optimize">{t('Мало данных')}</span>}
                    {turn.answer.references.length > 0 && <span>{t('Связанные товары:')} {turn.answer.references.join(', ')}</span>}
                    <SourcePill />
                  </div>
                </div>
              ) : turn.error ? (
                <div className="bubble assistant error" role="alert">{turn.error}</div>
              ) : (
                <div className="bubble assistant pending"><span className="typing" aria-label={t('Думаю…')}><i /><i /><i /></span></div>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <aside className="card card-pad assistant-suggestions">
          <div className="eyebrow">{t('Частые вопросы')}</div>
          {suggestions.map((suggestion) => (
            <button type="button" className="suggestion" key={suggestion} onClick={() => submit(t(suggestion))} disabled={ask.isPending} data-testid="assistant-suggestion">{t(suggestion)}</button>
          ))}
        </aside>
      </div>
      <form className="assistant-form" onSubmit={(event) => { event.preventDefault(); submit(question); }}>
        <label htmlFor="assistant-question" className="sr-only">{t('Ваш вопрос')}</label>
        <input id="assistant-question" value={question} maxLength={500} onChange={(event) => setQuestion(event.target.value)} placeholder={t('Например: какие товары скоро закончатся?')} autoComplete="off" data-testid="input-assistant-question" />
        <button className="btn" type="submit" disabled={ask.isPending || question.trim().length < 2} data-testid="button-assistant-ask">{ask.isPending ? t('Думаю…') : t('Спросить')} <SendHorizontal size={14} /></button>
      </form>
    </PageFrame>
  );
}
