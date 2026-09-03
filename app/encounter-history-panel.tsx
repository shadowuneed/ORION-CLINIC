'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  acceptedDecisions,
  downloadAudio,
  downloadAudit,
  downloadEncounterArchive,
  downloadProtocol,
  downloadTranscript,
} from '../lib/encounter-export';
import type { OrionEncounterRecord } from '../lib/encounter-history';

type EncounterHistoryPanelProps = {
  records: OrionEncounterRecord[];
  preferredEncounterId: string | null;
  onRename: (recordId: string, patientName: string) => Promise<void>;
  onClose: () => void;
};

function formatVisitDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function transcriptRoleLabel(role: OrionEncounterRecord['transcript'][number]['role']) {
  if (role === 'doctor') return 'Врач';
  if (role === 'patient') return 'Пациент';
  return 'Голос не определён';
}

function decisionStatusLabel(
  status: OrionEncounterRecord['decisions'][number]['status'],
) {
  if (status === 'accepted') return 'В протоколе';
  if (status === 'discarded') return 'В корзине';
  return 'Не решено';
}

function EncounterAudio({ audio }: { audio: Blob }) {
  const [url] = useState(() => URL.createObjectURL(audio));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <audio controls preload="metadata" src={url} />;
}

export function EncounterHistoryPanel({
  records,
  preferredEncounterId,
  onRename,
  onClose,
}: EncounterHistoryPanelProps) {
  const initialSelectedId = preferredEncounterId ?? records[0]?.id ?? '';
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [nameDraft, setNameDraft] = useState(
    () =>
      records.find((record) => record.id === initialSelectedId)?.patientName ??
      records[0]?.patientName ??
      '',
  );
  const [archiveDownloading, setArchiveDownloading] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [renameStatus, setRenameStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const selected = useMemo(
    () => records.find((record) => record.id === selectedId) ?? records[0] ?? null,
    [records, selectedId],
  );
  const normalizedNameDraft = nameDraft.trim();
  const nameChanged = normalizedNameDraft !== (selected?.patientName?.trim() ?? '');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const submitPatientName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !nameChanged || renameStatus === 'saving') return;
    setRenameStatus('saving');
    try {
      await onRename(selected.id, normalizedNameDraft);
      setRenameStatus('saved');
    } catch {
      setRenameStatus('error');
    }
  };

  return (
    <div className="history-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="history-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="history-panel__header">
          <div>
            <p className="eyebrow">Хранится только в этом браузере</p>
            <h2 id="history-title">История приёмов</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть историю">
            Закрыть
          </button>
        </header>

        {records.length === 0 ? (
          <div className="history-empty">
            <strong>История пока пуста</strong>
            <p>После начала первого приёма расшифровка и решения будут сохраняться автоматически.</p>
          </div>
        ) : (
          <div className="history-layout">
            <nav className="history-list" aria-label="Сохранённые приёмы">
              {records.map((record) => (
                <button
                  className={record.id === selected?.id ? 'is-selected' : ''}
                  type="button"
                  key={record.id}
                  onClick={() => {
                    setSelectedId(record.id);
                    setNameDraft(record.patientName ?? '');
                    setRenameStatus('idle');
                  }}
                >
                  <strong>{record.patientName?.trim() || 'Приём без названия'}</strong>
                  <span>{formatVisitDate(record.startedAt)}</span>
                  <span>{formatDuration(record.durationSeconds)} · {record.transcript.length} реплик</span>
                  <small>
                    {record.status === 'completed'
                      ? 'Завершён'
                      : record.status === 'interrupted'
                        ? 'Прерван'
                        : 'Идёт сейчас'}
                  </small>
                </button>
              ))}
            </nav>

            {selected && (
              <article className="history-detail">
                <form className="history-name-editor" onSubmit={submitPatientName}>
                  <label htmlFor="history-patient-name">
                    <span>Пациент / название приёма</span>
                    <small>Можно указать имя или нейтральную метку</small>
                  </label>
                  <div>
                    <input
                      id="history-patient-name"
                      type="text"
                      value={nameDraft}
                      maxLength={100}
                      autoComplete="off"
                      placeholder="Например, Айдос К."
                      onChange={(event) => {
                        setNameDraft(event.target.value);
                        setRenameStatus('idle');
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!nameChanged || renameStatus === 'saving'}
                    >
                      {renameStatus === 'saving' ? 'Сохраняем…' : 'Сохранить'}
                    </button>
                  </div>
                  {renameStatus === 'saved' && <p role="status">Название сохранено локально.</p>}
                  {renameStatus === 'error' && <p className="is-error" role="alert">Не удалось сохранить название.</p>}
                </form>

                <div className="history-detail__summary">
                  <div><span>Дата</span><strong>{formatVisitDate(selected.startedAt)}</strong></div>
                  <div><span>Расшифровка</span><strong>{selected.transcript.length} реплик</strong></div>
                  <div><span>Принято</span><strong>{acceptedDecisions(selected).length}</strong></div>
                  <div><span>Корзина</span><strong>{selected.decisions.filter((item) => item.status === 'discarded').length}</strong></div>
                </div>

                {selected.audio && (
                  <div className="history-audio">
                    <strong>Локальная аудиозапись</strong>
                    <EncounterAudio
                      audio={selected.audio}
                      key={`${selected.id}-${selected.audio.size}`}
                    />
                  </div>
                )}

                <div className="history-content">
                  <section className="history-transcript">
                    <div><h3>Расшифровка</h3><span>{selected.transcript.length}</span></div>
                    {selected.transcript.length > 0 ? (
                      selected.transcript.map((turn) => (
                        <article className={`history-transcript__turn role-${turn.role}`} key={turn.id}>
                          <strong>{transcriptRoleLabel(turn.role)}</strong>
                          <small>{turn.language.toUpperCase()}</small>
                          <p>{turn.text}</p>
                        </article>
                      ))
                    ) : (
                      <p>Подтверждённого текста нет.</p>
                    )}
                  </section>

                  <section className="history-decisions">
                    <div><h3>Журнал решений</h3><span>{selected.decisions.length}</span></div>
                    {selected.decisions.length > 0 ? (
                      selected.decisions.map((entry) => (
                        <article className={`status-${entry.status}`} key={entry.id}>
                          <div>
                            <strong>{entry.draftTitle}</strong>
                            <small>{decisionStatusLabel(entry.status)}</small>
                          </div>
                          <p>{entry.draftPrompt}</p>
                        </article>
                      ))
                    ) : (
                      <p>Решений пока нет.</p>
                    )}
                  </section>
                </div>

                <div className="history-downloads" aria-label="Скачать материалы приёма">
                  <button
                    className="download-all"
                    type="button"
                    disabled={archiveDownloading}
                    onClick={() => {
                      setArchiveDownloading(true);
                      setArchiveError(null);
                      void downloadEncounterArchive(selected)
                        .catch((error) => {
                          setArchiveError(
                            error instanceof Error
                              ? error.message
                              : 'Не удалось собрать архив приёма.',
                          );
                        })
                        .finally(() => setArchiveDownloading(false));
                    }}
                  >
                    {archiveDownloading
                      ? 'Собираем архив…'
                      : 'Скачать всё одним ZIP'}
                  </button>
                  <button
                    type="button"
                    disabled={
                      acceptedDecisions(selected).length === 0 &&
                      selected.transcript.length === 0
                    }
                    onClick={() => downloadProtocol(selected)}
                  >
                    Word: протокол + текст
                  </button>
                  <button
                    type="button"
                    disabled={selected.transcript.length === 0}
                    onClick={() => downloadTranscript(selected)}
                  >
                    Расшифровка TXT
                  </button>
                  <button
                    type="button"
                    disabled={!selected.audio}
                    onClick={() => downloadAudio(selected)}
                  >
                    Аудио
                  </button>
                  <button type="button" onClick={() => downloadAudit(selected)}>
                    Полный аудит JSON
                  </button>
                </div>
                {archiveError && (
                  <p className="history-error" role="alert">{archiveError}</p>
                )}

                <div className="history-notice">
                  Протокол содержит только пункты, которые врач явно добавил. Корзина и остальные решения остаются в полном аудите.
                </div>
              </article>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
