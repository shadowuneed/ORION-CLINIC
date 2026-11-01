'use client';

import { useState } from 'react';
import { ChevronDown, LoaderCircle, RefreshCw, Sparkles, X } from 'lucide-react';
import type { ClinicalSnapshot } from '@/lib/clinical/contracts';
import { useClinicalLiveAnalysis } from '@/lib/clinical/live-analysis-client';
import styles from './encounter-workspace.module.css';

const categories = { clarification: 'Уточнить у пациента', safety: 'Обратить внимание', action: 'Рассмотреть', medication: 'Проверить лекарственную терапию' };
export function LiveAssistant({ snapshot, encounterId, consent, transcript, canEdit, active, enabled, onToggle, onConsent }: {
  snapshot: ClinicalSnapshot; encounterId: string; consent: ClinicalSnapshot['consents'][number] | null;
  transcript: ClinicalSnapshot['transcript']; canEdit: boolean; active: boolean; enabled: boolean;
  onToggle: (enabled: boolean) => void; onConsent: () => void;
}) {
  const analysis = useClinicalLiveAnalysis({ scopeKey: `${snapshot.clinicId}:${snapshot.practitioner.id}`, encounterId, enabled, canEdit, active, consent, transcript });
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const allowed = !!consent?.care && !!consent.transcriptStorage && !!consent.externalAiProcessing;
  const pending = analysis.status === 'analyzing';
  const ready = analysis.data;
  const suggestions = ready?.suggestions.filter(suggestion => !hidden[suggestion.id]) ?? [];
  return <section className={styles.assistant} aria-label="Подсказки ИИ по разговору">
    <header className={styles.assistantHeading}><span className={styles.assistantIcon}><Sparkles size={21} /></span><div><span className={styles.eyebrow}>Помощник врача</span><h2>Подсказки по разговору</h2></div><span className={styles.privateBadge}>Для врача</span></header>
    <div className={styles.assistantStatus} role="status" aria-live="polite">
      {pending ? <LoaderCircle size={15} className={styles.spin} /> : <span className={enabled && allowed ? styles.aiDot : styles.idleDot} />}
      <span>{!active ? 'Приём завершён' : !enabled || !allowed ? 'Подсказки выключены' : pending ? 'Разбираем новые реплики…' : analysis.status === 'waiting' ? 'Собираем контекст разговора' : analysis.status === 'error' ? 'Обновление недоступно' : ready ? 'Подсказки обновлены' : 'Ожидаем первые реплики'}</span>
      {canEdit && active && <button type="button" className={styles.iconButton} aria-label={enabled ? 'Приостановить подсказки ИИ' : 'Включить подсказки ИИ'} onClick={() => allowed ? onToggle(!enabled) : onConsent()}><Sparkles size={15} /></button>}
    </div>
    {ready ? <div className={styles.assistantResults}>
      <div className={styles.analysisSummary}><p>{ready.summary}</p>{analysis.isStale && <small>{analysis.status === 'error' ? 'Разговор дополнился. Эти подсказки относятся к предыдущим репликам.' : 'Разговор дополнился — предыдущие подсказки обновляются.'}</small>}</div>
      {suggestions.map(suggestion => <article key={suggestion.id} className={`${styles.suggestion} ${suggestion.riskLevel === 'urgent' ? styles.suggestionUrgent : ''}`}>
        <div className={styles.suggestionTop}><span>{categories[suggestion.category]}</span><button type="button" className={styles.iconButton} aria-label={`Скрыть подсказку: ${suggestion.title}`} onClick={() => setHidden(current => ({ ...current, [suggestion.id]: true }))}><X size={14} /></button></div>
        <h3>{suggestion.title}</h3><p>{suggestion.content}</p>
        <details className={styles.evidence}><summary>Из разговора <ChevronDown size={13} /></summary>{suggestion.evidence.map((item, i) => <blockquote key={`${item.sourceId}:${i}`}>{item.quote}</blockquote>)}</details>
      </article>)}
      {!suggestions.length && <p className={styles.help}>Все текущие подсказки скрыты. Новые появятся по мере разговора.</p>}
      <small className={styles.assistantFootnote}>ИИ видит {ready.source.analyzedSegments} из {ready.source.totalSegments} сохранённых реплик. Подсказки требуют решения врача.</small>
    </div> : <div className={styles.assistantEmpty}><Sparkles size={31} /><h3>{enabled && allowed ? 'Слушаем вместе с вами' : 'Второй взгляд во время приёма'}</h3><p>{enabled && allowed ? 'Когда в разговоре появится достаточно сведений, здесь будут вопросы для уточнения и рекомендации врачу.' : 'Помощник предлагает, что уточнить у пациента, и обращает внимание на важные детали беседы.'}</p>
      {canEdit && active && (!enabled || !allowed) && <button type="button" onClick={() => allowed ? onToggle(true) : onConsent()}><Sparkles size={16} />{allowed ? 'Включить подсказки' : 'Настроить разрешение на ИИ'}</button>}
    </div>}
    {analysis.error && <div className={styles.analysisError} role="alert"><p>{analysis.error}</p><button type="button" disabled={pending} onClick={() => analysis.refresh()}><RefreshCw size={14} />Повторить</button></div>}
    {enabled && allowed && canEdit && active && ready && <button type="button" className={styles.refreshHints} disabled={pending} onClick={() => analysis.refresh()}><RefreshCw size={14} />Обновить подсказки</button>}
    <p className={styles.aiNote}>{allowed ? 'ИИ не меняет запись врача. Заключение подтверждаете вы.' : 'Для передачи текста ИИ нужно отдельное согласие пациента. Аудио остаётся на этом ПК.'}</p>
  </section>;
}
