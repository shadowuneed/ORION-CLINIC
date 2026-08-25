'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  type SonioxToken,
  useSonioxTranscription,
} from '../lib/soniox-client';

type WorkspaceProps = {
  clinicianName: string;
};

type SessionState = 'ready' | 'listening' | 'review';
type SpeakerRole = 'doctor' | 'patient' | 'unknown';

type TranscriptTurn = {
  id: string;
  speaker: string | null;
  language: 'ru' | 'kk' | 'unknown';
  text: string;
  startMs: number | null;
  provisional: boolean;
};

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function groupTokens(tokens: SonioxToken[], provisional: boolean) {
  const turns: TranscriptTurn[] = [];

  for (const token of tokens) {
    const previous = turns.at(-1);
    const sameTurn =
      previous &&
      previous.speaker === token.speaker &&
      previous.language === token.language;

    if (sameTurn) {
      previous.text += token.text;
      continue;
    }

    turns.push({
      id: `${token.startMs ?? 'live'}-${token.speaker ?? 'unknown'}-${turns.length}`,
      speaker: token.speaker,
      language: token.language,
      text: token.text,
      startMs: token.startMs,
      provisional,
    });
  }

  return turns.filter((turn) => turn.text.trim().length > 0);
}

function formatTranscriptTime(milliseconds: number | null) {
  if (milliseconds === null) return 'сейчас';
  return formatDuration(Math.floor(milliseconds / 1_000));
}

function languageLabel(language: TranscriptTurn['language']) {
  if (language === 'ru') return 'RU';
  if (language === 'kk') return 'KZ';
  return '—';
}

export function OrionWorkspace({ clinicianName }: WorkspaceProps) {
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState>('ready');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [rolesSwapped, setRolesSwapped] = useState(false);
  const speech = useSonioxTranscription();

  useEffect(() => {
    if (sessionState !== 'listening') return;
    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [sessionState]);

  const statusLabel = useMemo(() => {
    if (sessionState === 'listening') return 'Приём идёт';
    if (sessionState === 'review') return 'Проверка решений';
    return 'Готов к приёму';
  }, [sessionState]);

  const transcriptTurns = useMemo(
    () => [
      ...groupTokens(speech.finalTokens, false),
      ...groupTokens(speech.provisionalTokens, true),
    ],
    [speech.finalTokens, speech.provisionalTokens],
  );

  const detectedSpeakers = useMemo(
    () =>
      Array.from(
        new Set(
          [...speech.finalTokens, ...speech.provisionalTokens]
            .map((token) => token.speaker)
            .filter((speaker): speaker is string => Boolean(speaker)),
        ),
      ),
    [speech.finalTokens, speech.provisionalTokens],
  );

  const roleForSpeaker = (speaker: string | null): SpeakerRole => {
    if (!speaker) return 'unknown';
    const position = detectedSpeakers.indexOf(speaker);
    if (position === 0) return rolesSwapped ? 'patient' : 'doctor';
    if (position === 1) return rolesSwapped ? 'doctor' : 'patient';
    return 'unknown';
  };

  const speechStatusLabel = useMemo(() => {
    if (speech.status === 'requesting') return 'Получаем временный доступ';
    if (speech.status === 'connecting') return 'Соединяем речевой контур';
    if (speech.status === 'streaming') return 'RU/KZ поток активен';
    if (speech.status === 'stopping') return 'Завершаем расшифровку';
    if (speech.status === 'finished') return 'Расшифровка завершена';
    if (speech.status === 'error') return 'Речевой контур не запущен';
    return 'Микрофон ожидает запуска';
  }, [speech.status]);

  const startSession = () => {
    if (!consentConfirmed) return;
    setElapsedSeconds(0);
    setRolesSwapped(false);
    setSessionState('listening');
    void speech.start();
  };

  const stopSession = () => {
    if (
      speech.status === 'streaming' ||
      speech.status === 'connecting' ||
      speech.status === 'requesting'
    ) {
      speech.stop();
    }
    setSessionState('review');
  };

  const resetSession = () => {
    speech.reset();
    setConsentConfirmed(false);
    setElapsedSeconds(0);
    setRolesSwapped(false);
    setSessionState('ready');
  };

  return (
    <main className={`orion-shell is-${sessionState}`}>
      <header className="orion-header">
        <a className="orion-brand" href="#workspace" aria-label="ORION — клинический ассистент">
          <span className="orion-mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>ORION</strong><small>клинический ассистент</small></span>
        </a>

        <div className="orion-header__context" aria-label="Текущий режим">
          <span className="context-dot" />
          <span>Очный приём</span>
          <span className="context-separator" />
          <strong>{statusLabel}</strong>
        </div>

        <div className="clinician-chip">
          <span className="clinician-avatar" aria-hidden="true">В</span>
          <span><small>Рабочее место</small><strong>{clinicianName}</strong></span>
        </div>
      </header>

      <section className="orion-workspace" id="workspace">
        <aside className="visit-rail" aria-label="Параметры приёма">
          <div className="rail-section">
            <p className="eyebrow">Новый приём</p>
            <h1>Консультация<br />в кабинете</h1>
            <p className="rail-copy">Один общий микрофон. ORION разделяет голоса и показывает подсказки только врачу.</p>
          </div>

          <div className="visit-details">
            <div className="detail-row"><span>Пациент</span><strong>Не выбран</strong></div>
            <div className="detail-row"><span>Языки</span><strong>Русский · Қазақша</strong></div>
            <div className="detail-row"><span>Говорящие</span><strong>Врач · Пациент</strong></div>
          </div>

          <div className="privacy-note">
            <span className="privacy-icon" aria-hidden="true">◎</span>
            <div>
              <strong>ORION не создаёт аудиофайл</strong>
              <p>
                {sessionState === 'listening' && speech.status === 'streaming'
                  ? `Живой поток передаётся в Soniox (${speech.region?.toUpperCase() ?? 'регион проекта'}) только для STT.`
                  : 'До запуска микрофона аудио не захватывается и не передаётся.'}
              </p>
            </div>
          </div>
        </aside>

        <section className="conversation-stage" aria-label="Рабочая область приёма">
          <div className="stage-topline">
            <div><span className={`live-indicator is-${sessionState}`} /><strong>{statusLabel}</strong></div>
            <time dateTime={`PT${elapsedSeconds}S`}>{formatDuration(elapsedSeconds)}</time>
          </div>

          {sessionState === 'ready' && (
            <div className="session-ready">
              <div className="listening-orbit" aria-hidden="true">
                <span className="orbit orbit-one" />
                <span className="orbit orbit-two" />
                <span className="orbit-core">O</span>
              </div>
              <p className="eyebrow">Перед началом</p>
              <h2>Спокойный разговор.<br />Точная поддержка.</h2>
              <p className="stage-description">Ассистент не вмешивается в беседу. Он фиксирует контекст и готовит варианты для решения врача.</p>

              <label className="consent-control">
                <input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} />
                <span className="consent-box" aria-hidden="true">✓</span>
                <span><strong>Согласие пациента получено</strong><small>Пациент уведомлён о расшифровке и работе ИИ-ассистента</small></span>
              </label>

              <button className="primary-action" type="button" disabled={!consentConfirmed} onClick={startSession}>
                <span className="action-icon" aria-hidden="true" /> Начать приём
              </button>
              {!consentConfirmed && <small className="action-hint">Сначала подтвердите согласие пациента</small>}
            </div>
          )}

          {sessionState === 'listening' && (
            <div
              className={`session-listening${transcriptTurns.length ? ' has-transcript' : ''}`}
              aria-live="polite"
            >
              <div className="sound-field" aria-hidden="true">
                {Array.from({ length: 24 }, (_, index) => <i key={index} style={{ '--bar': index } as React.CSSProperties} />)}
              </div>
              <p className="eyebrow">{speechStatusLabel}</p>

              {transcriptTurns.length === 0 ? (
                <>
                  <h2>Разговор остаётся главным</h2>
                  <p className="stage-description">
                    {speech.error
                      ? 'Микрофон не передаёт аудио. Исправьте настройку и повторите запуск.'
                      : 'Врач говорит первым для калибровки. Затем ORION размечает русский и казахский текст по голосам.'}
                  </p>
                  {speech.error && (
                    <div className="speech-error" role="alert">
                      <strong>Что нужно проверить</strong>
                      <p>{speech.error}</p>
                      <button type="button" onClick={() => void speech.start()}>
                        Повторить подключение
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="live-transcript">
                  <div className="live-transcript__heading">
                    <div>
                      <h2>Живая расшифровка</h2>
                      <p>Черновой текст видит только врач</p>
                    </div>
                    <span>{speech.finalTokens.length} подтверждённых токенов</span>
                  </div>

                  <div className="transcript-feed" aria-label="Живая расшифровка разговора">
                    {transcriptTurns.map((turn) => {
                      const role = roleForSpeaker(turn.speaker);
                      const roleLabel =
                        role === 'doctor'
                          ? 'Врач'
                          : role === 'patient'
                            ? 'Пациент'
                            : `Голос ${turn.speaker ?? '—'}`;

                      return (
                        <article
                          className={`transcript-turn role-${role}${turn.provisional ? ' is-provisional' : ''}`}
                          key={`${turn.provisional ? 'live' : 'final'}-${turn.id}`}
                        >
                          <div className="transcript-meta">
                            <strong><i />{roleLabel}</strong>
                            <span>{languageLabel(turn.language)}</span>
                            <time>{formatTranscriptTime(turn.startMs)}</time>
                          </div>
                          <p>{turn.text.trim()}</p>
                          {turn.provisional && <small>уточняется…</small>}
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="speaker-calibration">
                <span><i className="speaker-dot doctor" /> Врач</span>
                <span><i className="speaker-dot patient" /> Пациент</span>
                <small>
                  {detectedSpeakers.length
                    ? 'Первый распознанный голос назначен врачу'
                    : 'Калибровка голосов ожидается'}
                </small>
                {detectedSpeakers.length >= 2 && (
                  <button type="button" onClick={() => setRolesSwapped((value) => !value)}>
                    Поменять роли
                  </button>
                )}
              </div>
              <button
                className="stop-action"
                type="button"
                disabled={speech.status === 'requesting' || speech.status === 'connecting'}
                onClick={stopSession}
              >
                <span aria-hidden="true" /> Завершить приём
              </button>
            </div>
          )}

          {sessionState === 'review' && (
            <div className="session-review">
              <span className="review-symbol" aria-hidden="true">✓</span>
              <p className="eyebrow">Приём завершён</p>
              <h2>Сначала решения.<br />Затем протокол.</h2>
              <p className="stage-description">
                Врач проверяет факты, меняет или отклоняет рекомендации и только после этого создаёт документ.
              </p>
              <div className="review-evidence">
                <div>
                  <span>Расшифровка</span>
                  <strong>
                    {speech.finalTokens.length
                      ? `${speech.finalTokens.length} подтверждённых токенов`
                      : 'Нет подтверждённого текста'}
                  </strong>
                </div>
                <div>
                  <span>Голоса</span>
                  <strong>
                    {detectedSpeakers.length
                      ? `${detectedSpeakers.length} распознано`
                      : 'Не определены'}
                  </strong>
                </div>
                <div>
                  <span>Аудиофайл</span>
                  <strong>Не создавался</strong>
                </div>
              </div>
              <div className="review-steps" aria-label="Этапы проверки">
                <span><b>1</b> Проверить расшифровку</span>
                <span><b>2</b> Принять решения</span>
                <span><b>3</b> Создать протокол</span>
              </div>
              <button className="secondary-action" type="button" onClick={resetSession}>Новый приём</button>
            </div>
          )}
        </section>

        <aside className="assistant-panel" aria-label="Подсказки ORION">
          <div className="panel-heading">
            <div><p className="eyebrow">Только для врача</p><h2>Подсказки</h2></div>
            <span className="private-pill">Приватно</span>
          </div>

          <div className="assistant-empty">
            <span className="assistant-glyph" aria-hidden="true">✦</span>
            <h3>
              {sessionState === 'listening' && speech.status === 'streaming'
                ? 'Расшифровка идёт отдельно от анализа'
                : sessionState === 'listening' && speech.status === 'error'
                  ? 'Речевой контур не запущен'
                  : 'Здесь будет только важное'}
            </h3>
            <p>
              Клинический анализ будет получать только подтверждённый текст. ORION не перебивает разговор и не показывает пациенту внутренние рекомендации.
            </p>
          </div>

          <div className="insight-types" aria-label="Типы подсказок">
            <div><span className="insight-icon question">?</span><p><strong>Что уточнить</strong><small>Недостающие сведения</small></p></div>
            <div><span className="insight-icon safety">!</span><p><strong>Безопасность</strong><small>Красные флаги и риски</small></p></div>
            <div><span className="insight-icon plan">+</span><p><strong>Варианты действий</strong><small>Обследования и лечение</small></p></div>
          </div>

          <div className="decision-rule">
            <span aria-hidden="true">01</span>
            <p><strong>Решение принимает врач</strong><small>Ничего не попадёт в протокол без подтверждения.</small></p>
          </div>
        </aside>
      </section>

      <footer className="orion-footer">
        <span>ORION clinical workspace</span>
        <div>
          <span><i className="footer-dot" /> Локальный предварительный режим</span>
          <span>RU + KZ</span>
          <span>Один микрофон · два голоса</span>
        </div>
      </footer>
    </main>
  );
}
