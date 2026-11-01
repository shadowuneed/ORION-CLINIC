'use client';

import { useEffect, useRef, useState } from 'react';
import { AudioLines, ChevronDown, LoaderCircle, Mic, Stethoscope, UserRound } from 'lucide-react';
import type { ClinicalSnapshot } from '@/lib/clinical/contracts';
import type { LocalSpeechToken, SpeechActivity, TranscriptionStatus } from '@/lib/live-local-speech-client';
import { conversationClock, conversationLines } from '@/lib/clinical/live-conversation';
import styles from './encounter-workspace.module.css';

type SavedSegment = ClinicalSnapshot['transcript'][number];
function activityText(status: TranscriptionStatus, activity: SpeechActivity) {
  if (status === 'requesting') return 'Разрешите доступ к микрофону';
  if (status === 'connecting') return 'Подключаем расшифровку';
  if (status === 'stopping') return 'Сохраняем последние слова';
  if (status === 'error') return 'Запись остановлена';
  if (status !== 'streaming') return 'Готовы к разговору';
  return activity === 'speaking' ? 'Слышу речь' : activity === 'recognizing' ? 'Распознаём реплику' : 'Микрофон включён · ожидаем речь';
}

export function LiveConversation({ segments, tokens, status, activity, elapsed, error, completed }: {
  segments: SavedSegment[]; tokens: LocalSpeechToken[]; status: TranscriptionStatus; activity: SpeechActivity; elapsed: number; error: string | null; completed: boolean;
}) {
  const lines = conversationLines(segments, tokens);
  const feed = useRef<HTMLDivElement>(null);
  const bottom = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [seen, setSeen] = useState(segments.length);
  const last = lines.at(-1)?.id;
  const streaming = status === 'streaming';
  useEffect(() => {
    if (!bottom.current || !feed.current) return;
    const frame = requestAnimationFrame(() => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: reduced ? 'instant' : 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [last]);
  const jump = () => { bottom.current = true; setAtBottom(true); setSeen(lines.length); feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: 'instant' }); };
  return <section className={styles.conversation} aria-label="Разговор с пациентом">
    <div className={styles.conversationHeading}><div><span className={styles.eyebrow}>{completed ? 'Материалы приёма' : 'Разговор с пациентом'}</span><h2>Живая расшифровка</h2></div><span className={styles.transcriptCount}>{lines.length} реплик</span></div>
    <div className={`${styles.recordingStrip} ${streaming ? styles.recordingStripActive : ''}`} role="status">
      <span className={streaming ? styles.recordingDot : styles.idleDot} />
      <strong>{completed ? 'Разговор сохранён' : activityText(status, activity)}</strong>
      <time aria-label="Длительность текущей записи">{conversationClock(elapsed)}</time>
    </div>
    {error && <div className={styles.speechError} role="alert"><strong>Не удалось продолжить запись</strong><p>{error}</p><small>Сохранённый разговор остаётся доступным. Можно продолжить после исправления подключения.</small></div>}
    <div ref={feed} className={styles.conversationFeed} onScroll={() => {
      const el = feed.current; if (!el) return;
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      bottom.current = near; setAtBottom(near); if (near) setSeen(lines.length);
    }}>
      {lines.length ? <ol className={styles.conversationLines} aria-label="Сохранённые реплики разговора">{lines.map(line => <li key={line.id} className={`${styles.conversationTurn} ${line.role === 'doctor' ? styles.doctorTurn : line.role === 'patient' ? styles.patientTurn : styles.unknownTurn}`}>
        <span className={styles.speakerAvatar} aria-hidden="true">{line.role === 'doctor' ? <Stethoscope size={18} /> : line.role === 'patient' ? <UserRound size={18} /> : <Mic size={18} />}</span>
        <article><header><strong>{line.role === 'doctor' ? 'Врач' : line.role === 'patient' ? 'Пациент' : 'Говорящий не определён'}</strong><span>{line.language === 'ru' ? 'RU' : line.language === 'kk' ? 'KZ' : 'Речь'}</span>{line.createdAt && <time>{new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(line.createdAt))}</time>}</header><p>{line.text}</p></article>
      </li>)}</ol> : <div className={styles.conversationEmpty}>
        <div className={`${styles.voiceOrb} ${streaming && activity === 'speaking' ? styles.voiceOrbSpeaking : ''}`} aria-hidden="true">{status === 'connecting' || status === 'requesting' ? <LoaderCircle className={styles.spin} size={38} /> : <AudioLines size={42} />}</div>
        <span className={styles.eyebrow}>{streaming ? 'Микрофон включён' : completed ? 'Нет сохранённой расшифровки' : 'Очный приём'}</span>
        <h3>{streaming ? 'Разговор остаётся главным' : completed ? 'Приём велся без записи' : 'Начните разговор'}</h3>
        <p>{streaming ? 'Говорите как обычно. Реплики появятся здесь после распознавания.' : completed ? 'Заключение доступно во вкладке «Запись врача».' : 'Текст беседы появится в центре, а подсказки помощника — справа.'}</p>
      </div>}
      {streaming && <div className={styles.listeningRow} aria-live="polite"><span className={`${styles.voiceBars} ${activity === 'speaking' ? styles.voiceBarsSpeaking : ''}`} aria-hidden="true">{[0, 1, 2, 3, 4].map(bar => <i key={bar} />)}</span><span>{activityText(status, activity)}</span></div>}
    </div>
    {!atBottom && lines.length > seen && <button className={styles.newMessages} type="button" onClick={jump}><ChevronDown size={15} />К новым репликам · {lines.length - seen}</button>}
    <div className={styles.speakerLegend}><span><i className={styles.doctorDot} />Врач</span><span><i className={styles.patientDot} />Пациент</span><small>{streaming && !lines.length ? 'Начните с голоса врача' : 'Роли определяются автоматически; возможны ошибки'}</small></div>
  </section>;
}
