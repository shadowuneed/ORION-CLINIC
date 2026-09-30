import styles from './clinical-workspace.module.css';

export function ResumeReviewAction({ busy, disabled, message, onResume }: {
  busy: boolean; disabled: boolean; message: string | null; onResume: () => void;
}) {
  return <div className={`${styles.sectionNotice} ${styles.resumeAction}`} role="status">
    <strong>Запись открыта для просмотра — подтвердите продолжение работы</strong>
    <p>Кнопка загрузит сохранённую версию для работы: не включает микрофон и не одобряет текст ИИ.</p>
    <button type="button" className={styles.primaryButton} disabled={disabled || busy} onClick={onResume}>
      {busy ? 'Проверяем сохранённую запись…' : 'Продолжить работу с этим приёмом'}
    </button>
    {message && <p>{message}</p>}
  </div>;
}

export function EncounterReviewGuide({ reviewed, accepted, unresolvedTranscript, status, blocked,
  onNext, onBuild, onTranscript, onSign, onHistory, message }: {
  reviewed: number; accepted: number; unresolvedTranscript: number; status?: string;
  blocked: string | null; onNext: () => void; onBuild: () => void; onTranscript: () => void; onSign: () => void; onHistory: () => void;
  message?: string | null;
}) {
  const ready = reviewed === 8 && unresolvedTranscript === 0 && !blocked;
  return <div className={styles.reviewWorkflow} aria-label="Путь к готовому протоколу">
    <div className={styles.reviewSummary}><strong>{status === 'review' ? 'Протокол собран — проверьте документ' : status === 'finalized' || status === 'amended' ? 'Протокол подписан' : `Проверено ${reviewed}/8 разделов`}</strong>
      <button type="button" onClick={onHistory}>Открыть историю пациента</button>
    </div>
    <details><summary>Что входит в протокол и где он хранится</summary>
    <ol>
      <li><b>Проверить запись — {reviewed}/8.</b> В каждом разделе сверить текст и нажать «Проверить раздел». Пустой раздел заполнить либо обоснованно подтвердить отсутствие сведений.</li>
      <li><b>Выбрать подсказки — принято {accepted}.</b> Принятое справа войдёт отдельным списком в протокол. Это не подтверждает восемь разделов и не создаёт назначения или направления автоматически.</li>
      <li><b>Собрать → проверить → подписать.</b> После проверки восьми разделов создаётся версия протокола. После отдельной подписи доступны Word, PDF и ZIP в этом приёме и его истории. Приём также доступен из карточки пациента.</li>
    </ol>
    <p>Сохранённые разделы уже являются данными этого приёма в карточке пациента — отдельный перенос «из базы» не нужен. Черновик ещё не подписанный протокол.</p>
    </details>
    {unresolvedTranscript > 0 && <p>В расшифровке осталось {unresolvedTranscript} реплик с неподтверждённой ролью или незавершённым текстом. Их нужно исправить перед сборкой.</p>}
    {blocked && <p role="status">{blocked}</p>}
    {message && <p role="status">{message}</p>}
    {status === 'in_progress' && <div className={styles.noticeActions}>
      {reviewed < 8 && <button type="button" onClick={onNext}>Открыть непроверенный раздел</button>}
      {unresolvedTranscript > 0 && <button type="button" onClick={onTranscript}>Перейти к расшифровке</button>}
      <button type="button" className={styles.primaryButton} disabled={!ready} onClick={onBuild}>Собрать протокол для проверки</button>
    </div>}
    {status === 'in_progress' && reviewed < 8 && <small>Сборка откроется после проверки всех разделов. Принимать все подсказки ИИ не требуется.</small>}
    {status === 'review' && <button type="button" onClick={onSign}>Открыть проверку и подпись протокола</button>}
    {(status === 'finalized' || status === 'amended') && <a href="#protocol-exports">Открыть готовые документы</a>}
  </div>;
}
