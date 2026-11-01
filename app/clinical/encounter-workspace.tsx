'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, ChevronRight, ClipboardCheck, FileText, LoaderCircle, Mic, Pause, Save, Send, ShieldCheck, Sparkles, Stethoscope } from 'lucide-react';
import type { ClinicalCommand, ClinicalNoteContent, ClinicalSnapshot } from '@/lib/clinical/contracts';
import { clinicalJson, loadClinicalSnapshot, sendClinicalCommand } from '@/lib/clinical/encounter-client';
import { canPublishEncounter, completeReviewedEncounter, emptyEncounterNote, encounterSections, hasClinicalNote, noteFingerprint, selectEncounterWorkspace } from '@/lib/clinical/encounter-workflow';
import { useLocalSpeechTranscription } from '@/lib/live-local-speech-client';
import styles from './encounter-workspace.module.css';
import { LiveConversation } from './live-conversation';
import { LiveAssistant } from './live-assistant';

type Decisions = { care: boolean; transcriptStorage: boolean; localAudioProcessing: boolean; externalAiProcessing: boolean };
const noDecisions: Decisions = { care: false, transcriptStorage: false, localAudioProcessing: false, externalAiProcessing: false };
const recordingStatuses = ['requesting', 'connecting', 'streaming', 'stopping'];
type CommandInput = ClinicalCommand extends infer C ? C extends ClinicalCommand ? Omit<C, 'idempotencyKey'> : never : never;
function readable(error: unknown) { return error instanceof Error ? error.message : 'Не удалось завершить действие. Сохранённые записи остаются в базе.'; }
function formatDate(value: string) { return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }

export function ClinicalEncounterWorkspace({ encounterId, initialSnapshot }: { encounterId: string | null; initialSnapshot?: ClinicalSnapshot }) {
  const initial = initialSnapshot && encounterId ? selectEncounterWorkspace(initialSnapshot, encounterId) : null;
  const [snapshot, setSnapshot] = useState<ClinicalSnapshot | null>(initialSnapshot ?? null);
  const [content, setContent] = useState<ClinicalNoteContent>(initial?.currentNote?.content ?? emptyEncounterNote());
  const [decisions, setDecisions] = useState<Decisions>(initial?.consent ?? noDecisions);
  const [phase, setPhase] = useState<'record' | 'review'>('record');
  const [tab, setTab] = useState<'conversation' | 'note'>(initial?.encounter.status === 'completed' ? 'note' : 'conversation');
  const [liveAiEnabled, setLiveAiEnabled] = useState(false);
  const [consentExpanded, setConsentExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const consentPanel = useRef<HTMLDetailsElement>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [autosaveBlocked, setAutosaveBlocked] = useState(false);
  const [savedFingerprint, setSavedFingerprint] = useState(noteFingerprint(initial?.currentNote?.content ?? emptyEncounterNote()));
  const [recipientId, setRecipientId] = useState(''); const [reason, setReason] = useState('');
  const [priority, setPriority] = useState<'routine' | 'urgent'>('routine'); const [referralReviewed, setReferralReviewed] = useState(false);
  const snapshotRef = useRef(snapshot); const contentRef = useRef(content); const decisionsRef = useRef(decisions);
  const decisionsTouched = useRef(false);
  const baselineNoteId = useRef(initial?.currentNote?.id ?? null);
  const patientScope = useRef(initial?.patient.id);
  const initialized = useRef(Boolean(initial)); const operation = useRef(false); const source = useRef<'clinician' | 'ai_assisted'>(initial?.currentNote?.source ?? 'clinician');
  const commandKeys = useRef(new Map<string, string>()); const reviewHeading = useRef<HTMLHeadingElement>(null);
  const selected = useMemo(() => snapshot && encounterId ? selectEncounterWorkspace(snapshot, encounterId) : null, [snapshot, encounterId]);

  const adopt = useCallback((next: ClinicalSnapshot, resetNote = false) => {
    if (!resetNote && snapshotRef.current && snapshotRef.current.generatedAt > next.generatedAt) return;
    snapshotRef.current = next; setSnapshot(next);
    const view = encounterId ? selectEncounterWorkspace(next, encounterId) : null;
    if (view) patientScope.current = view.patient.id;
    if (view && (!initialized.current || resetNote)) {
      if (!initialized.current && !view.canEdit) setTab('note');
      const note = view.currentNote?.content ?? emptyEncounterNote();
      contentRef.current = note; setContent(note); setSavedFingerprint(noteFingerprint(note));
      source.current = view.currentNote?.source ?? 'clinician';
      baselineNoteId.current = view.currentNote?.id ?? null;
      const choices = view.consent ?? noDecisions; decisionsRef.current = choices; setDecisions(choices);
      initialized.current = true;
    } else if (view && !decisionsTouched.current) {
      const choices = view.consent ?? noDecisions;
      decisionsRef.current = choices; setDecisions(choices);
    }
  }, [encounterId, setSnapshot, setContent, setDecisions, setSavedFingerprint, setTab]);
  const refresh = useCallback(async (resetNote = false) => { const next = await loadClinicalSnapshot(undefined, patientScope.current); adopt(next, resetNote); return next; }, [adopt]);
  useEffect(() => {
    const controller = new AbortController();
    void loadClinicalSnapshot(controller.signal).then(async next => {
      const patientId = next.encounters.find(item => item.id === encounterId)?.patientId;
      const scoped = patientId ? await loadClinicalSnapshot(controller.signal, patientId) : next;
      if (!controller.signal.aborted) adopt(scoped);
    }).catch(caught => { if (!controller.signal.aborted) setError(readable(caught)); });
    return () => controller.abort();
  }, [adopt, encounterId]);
  const speech = useLocalSpeechTranscription({ encounterId, apiBase: '/api/clinical/v1/speech',
    onPersistedSegment: () => { void refresh().catch(caught => setError(readable(caught))); },
  });
  const recording = recordingStatuses.includes(speech.status);
  const dirty = noteFingerprint(content) !== savedFingerprint;
  useEffect(() => {
    if (speech.status !== 'streaming') return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [speech.status]);
  useEffect(() => {
    if (!dirty && !recording) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, recording]);

  const run = useCallback(async (label: string, work: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true; setBusy(label); setError(null); setMessage(null);
    try { await work(); } catch (caught) { setError(readable(caught)); setAutosaveBlocked(true); }
    finally { operation.current = false; setBusy(null); }
  }, [setBusy, setError, setMessage, setAutosaveBlocked]);
  const currentView = useCallback(() => {
    const view = snapshotRef.current && encounterId ? selectEncounterWorkspace(snapshotRef.current, encounterId) : null;
    if (!view) throw new Error('Приём не найден. Обновите рабочее место.');
    return view;
  }, [encounterId]);
  const command = useCallback(async (input: CommandInput) => {
    const fingerprint = JSON.stringify(input); const key = commandKeys.current.get(fingerprint) ?? crypto.randomUUID();
    commandKeys.current.set(fingerprint, key);
    const receipt = await sendClinicalCommand({ ...input, idempotencyKey: key } as ClinicalCommand);
    // Keep the receipt key on a failed read; retrying never duplicates the write.
    await refresh(); commandKeys.current.delete(fingerprint); return receipt;
  }, [refresh]);
  const saveDecisions = useCallback(async () => {
    const view = currentView(); const choices = decisionsRef.current;
    if (Object.keys(noDecisions).every(key => choices[key as keyof Decisions] === view.consent?.[key as keyof Decisions])) return;
    if (view.consent && !decisionsTouched.current) throw new Error('Решение пациента изменилось. Проверьте согласия перед продолжением.');
    await command({ type: 'consent.record', encounterId: view.encounter.id, expectedVersion: view.encounter.version, ...choices, patientConfirmed: true });
    decisionsTouched.current = false;
  }, [command, currentView]);
  const saveDraft = useCallback(async () => {
    const before = currentView(); const draft = { ...contentRef.current };
    if (!before.canEdit || !hasClinicalNote(draft)) return;
    if (!decisionsRef.current.care) throw new Error('Сначала зафиксируйте решение пациента о ведении приёма.');
    await saveDecisions();
    const view = currentView();
    if (view.currentNote && noteFingerprint(view.currentNote.content) === noteFingerprint(draft)) {
      baselineNoteId.current = view.currentNote.id; setSavedFingerprint(noteFingerprint(draft)); return;
    }
    if ((view.currentNote?.id ?? null) !== baselineNoteId.current) throw new Error('Запись изменилась в другой вкладке. Ваш текст сохранён на экране; сверьте его с версией из БД перед повторным сохранением.');
    await command({ type: 'note.save', encounterId: view.encounter.id, expectedVersion: view.encounter.version, content: draft, source: source.current });
    baselineNoteId.current = currentView().currentNote?.id ?? null;
    setSavedFingerprint(noteFingerprint(draft));
  }, [command, currentView, saveDecisions]);
  useEffect(() => {
    if (!dirty || busy || autosaveBlocked || !selected?.canEdit || !selected.consent?.care || phase === 'review') return;
    const timer = window.setTimeout(() => { void run('Сохраняем запись', saveDraft); }, 1600);
    return () => window.clearTimeout(timer);
  }, [dirty, busy, autosaveBlocked, selected?.canEdit, selected?.consent?.care, content, phase, run, saveDraft]);

  const startRecording = () => run('Подключаем запись', async () => {
    if (!decisionsRef.current.care || !decisionsRef.current.transcriptStorage || !decisionsRef.current.localAudioProcessing) throw new Error('Для записи нужны решения пациента о ведении приёма, хранении текста и локальной обработке аудио. Можно вести приём вручную.');
    await saveDecisions(); setReviewed(false); setPhase('record'); setTab('conversation'); setElapsed(0);
    await speech.start({ recordAudio: false });
    if (speech.getCaptureStatus() === 'streaming') setLiveAiEnabled(decisionsRef.current.externalAiProcessing);
  });
  const finishForReview = () => run('Сохраняем последнюю реплику', async () => {
    if (recording) await speech.stop();
    if (speech.getCaptureStatus() === 'error') setError('Речевая запись завершилась с ошибкой. Проверьте сохранённую расшифровку; недостающие сведения внесите вручную перед публикацией.');
    await refresh(); await saveDraft(); setReviewed(false); setPhase('review'); setTab('note');
    requestAnimationFrame(() => reviewHeading.current?.focus());
  });
  const publish = () => run('Публикуем проверенное заключение', async () => {
    await completeReviewedEncounter({ reviewed, recording, saveDraft, latest: currentView, command });
    setSavedFingerprint(noteFingerprint(contentRef.current)); setMessage('Приём завершён. Проверенное заключение сохранено в карточке пациента и доступно врачам с назначенным доступом.');
  });
  const analyze = () => run('Готовим черновик по расшифровке', async () => {
    await saveDecisions(); await saveDraft(); const view = currentView();
    if (!view.consent?.externalAiProcessing) throw new Error('Для Groq нужно отдельное решение пациента о внешней обработке текста.');
    await clinicalJson(await fetch('/api/clinical/v1/analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ encounterId: view.encounter.id, expectedVersion: view.encounter.version, idempotencyKey: crypto.randomUUID() }) }));
    await refresh(true); setReviewed(false); setMessage('ИИ-черновик сохранён. Сверьте его с расшифровкой: это не подтверждённые медицинские факты.');
  });
  const refer = () => run('Передаём направление', async () => {
    const view = currentView();
    if (!referralReviewed || !view.publishedNote || !recipientId || !reason.trim()) throw new Error('Выберите врача, укажите причину и подтвердите передачу проверенного заключения.');
    await command({ type: 'referral.create', encounterId: view.encounter.id, expectedVersion: view.encounter.version, recipientPractitionerId: recipientId, reason: reason.trim(), priority, reviewAcknowledged: true });
    setRecipientId(''); setReason(''); setReferralReviewed(false); setMessage('Направление сохранено. Оно появится в рабочем центре выбранного врача.');
  });
  const updateField = (key: keyof ClinicalNoteContent, value: string) => {
    const next = { ...contentRef.current, [key]: value }; contentRef.current = next; setContent(next); setReviewed(false);
    setAutosaveBlocked(false);
  };
  const updateDecision = (key: keyof Decisions, value: boolean) => {
    decisionsTouched.current = true;
    const next = { ...decisionsRef.current, [key]: value }; decisionsRef.current = next; setDecisions(next);
  };

  if (!snapshot) return <main className={styles.state}><LoaderCircle aria-hidden="true" /><h1>Открываем приём</h1><p>Загружаем карточку пациента и запись приёма.</p>{error && <p role="alert">{error}</p>}<Link href="/patients">Пациенты</Link></main>;
  if (!selected) return <main className={styles.state}><Stethoscope aria-hidden="true" /><h1>{encounterId ? 'Приём недоступен' : 'Кого принимаем?'}</h1><p>{encounterId ? 'Нет записи с доступом для текущего врача. Другие карточки не открываются по случайному идентификатору.' : 'Откройте пациента или запись в очереди и нажмите «Начать приём».'}</p><Link className={styles.primary} href="/patients">Выбрать пациента <ChevronRight size={18} /></Link>{error && <p role="alert">{error}</p>}</main>;
  const { encounter, patient, canEdit, transcript, publishedNote, previousNotes } = selected;
  const complete = encounter.status === 'completed';
  const connecting = speech.status === 'requesting' || speech.status === 'connecting';
  const readyToRecord = decisions.care && decisions.transcriptStorage && decisions.localAudioProcessing;
  const aiConsent = decisions.care && decisions.transcriptStorage && decisions.externalAiProcessing ? selected.consent : null;
  const showConsent = () => { setConsentExpanded(true); requestAnimationFrame(() => consentPanel.current?.scrollIntoView({ block: 'center' })); };
  return <main className={styles.workspace}>
    <header className={styles.header}>
      <div><Link className={styles.back} href={`/patients/${encodeURIComponent(patient.id)}`}><ArrowLeft size={16} /> Карточка пациента</Link><div className={styles.patientTitle}><h1>{patient.name}</h1><span className={complete ? styles.complete : styles.badge}>{complete ? 'Приём завершён' : phase === 'review' ? 'Проверка записи' : 'Очный приём'}</span></div><p>{patient.mrn} · {snapshot.practitioner.name} · {snapshot.practitioner.specialty}</p></div>
      <div className={styles.saveState} aria-live="polite"><Save size={16} />{busy ?? (dirty ? 'Есть несохранённый текст' : selected.currentNote ? 'Запись сохранена' : 'Новый приём')}</div>
    </header>
    {error && <div className={styles.error} role="alert">{error}<button type="button" disabled={!!busy} onClick={() => void run('Обновляем запись', async () => { await refresh(); })}>Обновить состояние</button><button type="button" disabled={!!busy || recording} onClick={() => {
      if (dirty && !window.confirm('Заменить несохранённый текст на последнюю версию из базы? Скопируйте нужные изменения перед продолжением.')) return;
      void run('Загружаем сохранённую версию', async () => { await refresh(true); setReviewed(false); setAutosaveBlocked(false); });
    }}>Загрузить версию из БД</button></div>}
    {message && <p className={styles.success} role="status">{message}</p>}
    <div className={styles.layout}>
      <section className={styles.mainColumn}>
        <div className={styles.workspaceTabs} role="tablist" aria-label="Материалы приёма">
          <button type="button" id="conversation-tab" role="tab" aria-selected={tab === 'conversation'} aria-controls="conversation-pane" onClick={() => setTab('conversation')}><Mic size={17} />Разговор {recording && <span className={styles.recordingDot} />}</button>
          <button type="button" id="note-tab" role="tab" aria-selected={tab === 'note'} aria-controls="note-pane" onClick={() => setTab('note')}><FileText size={17} />Запись врача {dirty && <span className={styles.draftDot} />}</button>
          <span>{complete ? 'Завершён' : phase === 'review' ? 'Проверка заключения' : 'Приём идёт'}</span>
        </div>
        <div id="conversation-pane" role="tabpanel" aria-labelledby="conversation-tab" hidden={tab !== 'conversation'} className={styles.conversationPane}>
          <LiveConversation segments={transcript} tokens={canEdit ? speech.finalTokens : []} status={speech.status} activity={speech.activity} elapsed={elapsed} error={speech.error} completed={complete} />
        </div>
        <section id="note-pane" role="tabpanel" aria-labelledby="note-tab" hidden={tab !== 'note'} className={styles.note} aria-label="Клиническая запись">
          <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>{complete ? 'Проверенное заключение' : 'Черновик — до проверки врачом'}</span><h2 ref={reviewHeading} tabIndex={-1}>{phase === 'review' && !complete ? 'Проверьте запись приёма' : 'Запись врача'}</h2></div><FileText size={24} /></div>
          {!complete && <p className={styles.help}>Заполняйте известные сведения. Пустое поле означает «не записано», а не отсутствие симптома. ИИ и речь сами не подтверждают диагноз.</p>}
          {encounterSections.map(section => <div className={styles.noteField} key={section.key}>
            <label htmlFor={`clinical-${section.key}`}>{section.title}</label>
            {canEdit ? <textarea id={`clinical-${section.key}`} value={content[section.key]} maxLength={20000} rows={section.key === 'history' ? 4 : 3} disabled={!!busy} placeholder={section.hint} onChange={e => updateField(section.key, e.target.value)} /> : <p className={styles.publishedText}>{(publishedNote ?? selected.currentNote)?.content[section.key] || 'Не записано'}</p>}
          </div>)}
          {canEdit && phase === 'review' && <div className={styles.reviewBox}>
              <label><input type="checkbox" checked={reviewed} disabled={!!busy || recording || !hasClinicalNote(content)} onChange={e => setReviewed(e.target.checked)} /><span>Я сверил(а) запись с приёмом, проверил(а) распознанный текст и подтверждаю заключение. Черновые предположения не представлены как установленные факты.</span></label>
              <button type="button" className={styles.primary} disabled={!canPublishEncounter({ canEdit, content, reviewed, recording, saving: !!busy })} onClick={() => void publish()}><Check size={18} /> Сохранить заключение и завершить</button>
              <button type="button" disabled={!!busy} onClick={() => { setPhase('record'); setTab('conversation'); setReviewed(false); }}>Вернуться к разговору</button>
          </div>}
          {complete && publishedNote && <p className={styles.publishedMeta}><ShieldCheck size={16} /> Опубликовано {formatDate(publishedNote.publishedAt ?? publishedNote.createdAt)} · версия {publishedNote.version}</p>}
        </section>
        {canEdit && <div className={styles.captureControls} aria-label="Управление разговором">
          <div className={styles.actions}>
            {connecting ? <button type="button" onClick={() => void speech.stop()}><Pause size={17} />Отменить подключение</button> : recording ? <button type="button" className={styles.primary} disabled={!!busy || speech.status === 'stopping'} onClick={() => void finishForReview()}><Pause size={18} />{speech.status === 'stopping' ? 'Сохраняем последние слова…' : 'Завершить и проверить'}</button> : <>
              {tab === 'conversation' && <button type="button" className={styles.primary} disabled={!!busy || !readyToRecord} onClick={() => void startRecording()}><Mic size={18} />{transcript.length ? 'Продолжить запись' : 'Начать запись'}</button>}
              {phase === 'record' && (tab === 'note' || transcript.length > 0) && <button type="button" className={tab === 'note' ? styles.primary : ''} disabled={!!busy || !decisions.care} onClick={() => void finishForReview()}><ClipboardCheck size={17} />Завершить и проверить</button>}
              {tab === 'note' && <button type="button" disabled={!!busy || !decisions.care || !hasClinicalNote(content)} onClick={() => void run('Сохраняем запись', saveDraft)}><Save size={16} />Сохранить черновик</button>}
              {tab === 'note' && <button type="button" disabled={!!busy || !transcript.length || !decisions.externalAiProcessing} onClick={() => void analyze()}><Sparkles size={16} />Заполнить пустые поля с ИИ</button>}
            </>}
            <span>{recording ? 'Реплики появляются после паузы в речи. Последняя реплика сохранится при завершении.' : !readyToRecord ? 'Перед запуском отметьте полученные разрешения пациента ниже.' : liveAiEnabled ? 'Расшифровка в центре · подсказки ИИ справа' : 'Микрофон и расшифровка запускаются одной кнопкой.'}</span>
          </div>
          <details ref={consentPanel} className={styles.consents} open={consentExpanded || !selected.consent?.care} onToggle={event => setConsentExpanded(event.currentTarget.open)}>
            <summary><ShieldCheck size={16} />Разрешения пациента <span>{readyToRecord ? 'Готово к записи' : 'Нужно заполнить'}</span></summary>
            <p>Отметьте полученные решения пациента. Можно вести запись врача вручную. Аудиофайл не сохраняется.</p>
            <div className={styles.consentGrid}>
              <label><input type="checkbox" checked={decisions.care} disabled={recording || !!busy} onChange={e => updateDecision('care', e.target.checked)} /><span>Ведение приёма и медицинской документации</span></label>
              <label><input type="checkbox" checked={decisions.transcriptStorage} disabled={recording || !!busy} onChange={e => updateDecision('transcriptStorage', e.target.checked)} /><span>Сохранение текста разговора</span></label>
              <label><input type="checkbox" checked={decisions.localAudioProcessing} disabled={recording || !!busy} onChange={e => updateDecision('localAudioProcessing', e.target.checked)} /><span>Распознавание речи на этом ПК</span></label>
              <label><input type="checkbox" checked={decisions.externalAiProcessing} disabled={recording || !!busy} onChange={e => { updateDecision('externalAiProcessing', e.target.checked); if (!e.target.checked) setLiveAiEnabled(false); }} /><span>Отдельно, необязательно: передача текста Groq для подсказок ИИ</span></label>
            </div>
            <button type="button" disabled={recording || !!busy} onClick={() => void run('Сохраняем разрешения', async () => { await saveDecisions(); setConsentExpanded(false); setMessage('Решения пациента сохранены. Можно начать разговор.'); })}>Сохранить разрешения</button>
          </details>
        </div>}
      </section>
      <aside className={styles.sideColumn}>
        <LiveAssistant key={encounter.id} snapshot={snapshot} encounterId={encounter.id} consent={aiConsent} transcript={transcript} canEdit={canEdit} active={!complete} enabled={liveAiEnabled} onToggle={setLiveAiEnabled} onConsent={showConsent} />
        <details className={styles.context}><summary>История пациента <span>{previousNotes.length}</span></summary><p className={styles.help}>Предыдущие подтверждённые заключения.</p>
          {previousNotes.length ? previousNotes.slice(0, 5).map(note => <details key={note.id}><summary>{formatDate(note.publishedAt ?? note.createdAt)}</summary><p className={styles.help}>{snapshot.practitioners.find(item => item.id === note.practitionerId)?.name ?? 'Лечащий врач'}</p><strong>Заключение</strong><p>{note.content.assessment || 'Не записано'}</p><strong>План</strong><p>{note.content.plan || 'Не записано'}</p></details>) : <p>Предыдущих опубликованных заключений пока нет.</p>}
        </details>
        <details className={styles.context} open={complete || undefined}><summary>Направить к коллеге</summary>
          {!publishedNote || encounter.practitionerId !== snapshot.practitioner.id ? <p>После проверки и публикации заключения лечащий врач может передать направление коллеге вместе с этой версией записи.</p> : <>
            <label htmlFor="clinical-recipient">Врач и специальность</label><select id="clinical-recipient" value={recipientId} disabled={!!busy} onChange={e => { setRecipientId(e.target.value); setReferralReviewed(false); }}><option value="">Выберите врача</option>{snapshot.practitioners.filter(item => item.id !== snapshot.practitioner.id).map(item => <option key={item.id} value={item.id}>{item.name} · {item.specialty}</option>)}</select>
            <label htmlFor="clinical-referral-reason">Причина направления</label><textarea id="clinical-referral-reason" value={reason} maxLength={4000} rows={3} disabled={!!busy} onChange={e => { setReason(e.target.value); setReferralReviewed(false); }} placeholder="Что нужно уточнить или оценить коллеге" />
            <label htmlFor="clinical-priority">Приоритет</label><select id="clinical-priority" value={priority} disabled={!!busy} onChange={e => { setPriority(e.target.value as 'routine' | 'urgent'); setReferralReviewed(false); }}><option value="routine">Планово</option><option value="urgent">Срочно — по решению врача</option></select>
            <label className={styles.check}><input type="checkbox" checked={referralReviewed} disabled={!!busy} onChange={e => setReferralReviewed(e.target.checked)} /><span>Проверил(а) получателя и причину. Передать опубликованное заключение.</span></label>
            <button type="button" className={styles.primary} disabled={!!busy || !referralReviewed || !recipientId || !reason.trim()} onClick={() => void refer()}><Send size={16} /> Передать направление</button>
          </>}
          {selected.referrals.map(referral => <div className={styles.referral} key={referral.id}><strong>{snapshot.practitioners.find(item => item.id === referral.recipientPractitionerId)?.name ?? 'Назначенный врач'}</strong><p>{referral.reason}</p><span>{referral.status === 'accepted' ? 'Принято врачом' : referral.status === 'declined' ? 'Отклонено' : referral.status === 'revoked' ? 'Отозвано' : 'Ожидает принятия'}</span></div>)}
        </details>
      </aside>
    </div>
  </main>;
}
