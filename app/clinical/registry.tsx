'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, ArrowRight, Building2, FileCheck2, RefreshCw, Stethoscope, Users } from 'lucide-react';
import { clinicalSnapshotSchema, type ClinicalCommand, type ClinicalSnapshot } from '@/lib/clinical/contracts';
import { ClinicalRequestError, clinicalJson } from '@/lib/clinical/encounter-client';
import styles from './registry.module.css';
import { ReferralsPanel } from './referrals-panel';
import { clinicalRequestDeadline, createClinicalCommandGate } from './start-encounter-button';

const labels = { complaints: 'Жалобы', history: 'Анамнез', examination: 'Осмотр', assessment: 'Заключение', plan: 'План' };
const time = (value: string) => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
type RegistryProps = { patientId?: string; mode?: 'home' | 'patients' | 'referrals'; initialSnapshot?: ClinicalSnapshot };
export function ClinicalRegistry(props: RegistryProps) { return <RegistryWorkspace key={`${props.patientId ?? 'all'}:${props.mode ?? 'home'}`} {...props} />; }
function RegistryWorkspace({ patientId, mode = 'home', initialSnapshot }: RegistryProps) {
  const [snapshot, setSnapshot] = useState<ClinicalSnapshot | null>(initialSnapshot ?? null);
  const [loading, setLoading] = useState(!initialSnapshot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [registering, setRegistering] = useState(false);
  const [newPatient, setNewPatient] = useState({ name: '', birthDate: '', sex: 'unknown' as 'female' | 'male' | 'unknown' });
  const [pending, setPending] = useState<ClinicalCommand | null>(null);
  const [gate] = useState(() => createClinicalCommandGate());
  const [confirmedCommand, setConfirmedCommand] = useState<ClinicalCommand | null>(null);
  const mounted = useRef(true); const readController = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const router = useRouter();
  const load = useCallback(async (signal?: AbortSignal) => {
    readController.current?.abort(); const controller = new AbortController(); readController.current = controller;
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) controller.abort();
    const request = ++sequence.current;
    setLoading(true); setError('');
    try {
      const url = patientId ? `/api/clinical/v1/patients/${encodeURIComponent(patientId)}` : '/api/clinical/v1/snapshot';
      const data = await clinicalRequestDeadline(async requestSignal => clinicalSnapshotSchema.parse(await clinicalJson(await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal: requestSignal }))), controller.signal);
      if (mounted.current && request === sequence.current && !controller.signal.aborted) setSnapshot(data);
    } catch (cause) {
      if (mounted.current && request === sequence.current && !controller.signal.aborted) { setSnapshot(null); setError(cause instanceof Error ? cause.message : 'Ошибка загрузки.'); }
    } finally { signal?.removeEventListener('abort', abort); if (mounted.current && request === sequence.current && !controller.signal.aborted) setLoading(false); }
  }, [patientId, setLoading, setError, setSnapshot]);
  useEffect(() => { mounted.current = true; const controller = new AbortController(); const requests = sequence; const reads = readController;
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => { mounted.current = false; window.clearTimeout(timer); controller.abort(); reads.current?.abort(); gate.cancel(); ++requests.current; };
  }, [load, gate]);

  async function execute(command: ClinicalCommand): Promise<boolean> {
    setBusy(true); setError(''); ++sequence.current; readController.current?.abort(); setLoading(false);
    const outcome = await gate.run(command);
    if (!mounted.current || outcome.status === 'cancelled' || outcome.status === 'busy') return false;
    setPending(gate.pending());
    if (outcome.status === 'failed') {
      if (outcome.error instanceof ClinicalRequestError && [401, 403].includes(outcome.error.status)) setSnapshot(null);
      setError(outcome.error instanceof Error ? outcome.error.message : 'Изменение не подтверждено. Повторите тот же запрос.'); setBusy(false); return false;
    }
    setConfirmedCommand(outcome.command);
    if (outcome.command.type === 'patient.register') { setRegistering(false); setNewPatient({ name: '', birthDate: '', sex: 'unknown' }); router.push(`/patients/${encodeURIComponent(outcome.result.resourceId)}`); }
    else if (outcome.result.encounterId) router.push(`/clinical?encounterId=${encodeURIComponent(outcome.result.encounterId)}`);
    else await load();
    if (mounted.current) setBusy(false);
    return true;
  }
  const start = (id: string) => void execute({ type: 'encounter.start', patientId: id, idempotencyKey: crypto.randomUUID() });
  const patient = snapshot?.patients.find(item => item.id === patientId);
  const patients = snapshot?.patients.filter(item => `${item.name} ${item.mrn}`.toLocaleLowerCase('ru-RU').includes(query.toLocaleLowerCase('ru-RU'))) ?? [];
  const ownEncounters = snapshot?.encounters.filter(item => item.practitionerId === snapshot.practitioner.id && item.status === 'in_progress') ?? [];
  const incoming = snapshot?.referrals.filter(item => item.recipientPractitionerId === snapshot.practitioner.id && item.status === 'pending') ?? [];
  const published = snapshot?.notes.filter(item => item.status === 'published' && (!patientId || item.patientId === patientId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) ?? [];
  const name = (id: string) => snapshot?.patients.find(item => item.id === id)?.name ?? 'Пациент';
  const doctor = (id: string) => snapshot?.practitioners.find(item => item.id === id)?.name ?? 'Лечащий врач';

  return <main className={styles.page} aria-busy={loading || busy}>
    <header className={styles.header}><div><span className={styles.eyebrow}>ORION · Единая клиническая база</span>{patient ? <div className={styles.patientHeading}><span className={styles.avatar} aria-hidden="true">{patient.name.split(' ').slice(0, 2).map(part => part[0]).join('')}</span><div><h1>{patient.name}</h1><p>{patient.mrn} · {patient.birthDate ?? 'Дата рождения не указана'} · {patient.sex === 'female' ? 'Женский' : patient.sex === 'male' ? 'Мужской' : 'Пол не указан'}</p></div></div> : <><h1>{mode === 'patients' ? 'Мои пациенты' : mode === 'referrals' ? 'Направления и консультации' : 'Рабочий день врача'}</h1><p>{snapshot ? `${snapshot.practitioner.name} · ${snapshot.practitioner.specialty}` : 'Пациенты, приёмы и направления из PostgreSQL'}</p></>}</div><div className={styles.actions}><button className={styles.button} disabled={loading || busy} onClick={() => void load()}><RefreshCw size={16} />Обновить</button>{patient ? <button className={styles.primary} disabled={loading || busy || !!pending} onClick={() => start(patient.id)}><Stethoscope size={17} />Начать приём</button> : <Link className={styles.button} href="/crm"><Building2 size={17} />Карта клиники</Link>}</div></header>
    {(error || pending) && <div className={styles.error} role="alert">{error || 'Результат предыдущего запроса ещё не подтверждён. Повтор использует тот же запрос и не создаёт новую запись.'}{pending && <button className={styles.button} disabled={busy} onClick={() => void execute(pending)}>Повторить сохранение</button>}</div>}
    {snapshot && !patientId && <div><button className={styles.primary} disabled={busy || !!pending} onClick={() => setRegistering(value => !value)}><Users size={17} />{registering ? 'Закрыть регистрацию' : 'Добавить пациента'}</button></div>}
    {snapshot && registering && <form className={styles.panel} onSubmit={event => { event.preventDefault(); void execute({ type: 'patient.register', name: newPatient.name.trim(), birthDate: newPatient.birthDate || null, sex: newPatient.sex, idempotencyKey: crypto.randomUUID() }); }}><h2>Новая карта пациента</h2><p className={styles.hint}>Создаётся одна запись в общей базе. Она сразу доступна для приёма и записи в очередь.</p><fieldset disabled={busy || !!pending} className={styles.registration}><label>Имя пациента<input autoComplete="off" required minLength={2} maxLength={160} value={newPatient.name} onChange={event => setNewPatient(current => ({ ...current, name: event.target.value }))} /></label><label>Дата рождения<input type="date" min="1900-01-01" max={new Date().toISOString().slice(0, 10)} value={newPatient.birthDate} onChange={event => setNewPatient(current => ({ ...current, birthDate: event.target.value }))} /></label><label>Пол<select value={newPatient.sex} onChange={event => setNewPatient(current => ({ ...current, sex: event.target.value as typeof current.sex }))}><option value="unknown">Не указан</option><option value="female">Женский</option><option value="male">Мужской</option></select></label><button className={styles.primary} type="submit">Создать карту</button></fieldset></form>}
    {loading && !snapshot && <div className={styles.empty} role="status">Загружаем записи из базы…</div>}
    {snapshot && <>
      {!patientId && <section className={styles.metrics} aria-label="Мой рабочий список">{[
        { icon: Users, value: snapshot.patients.length, label: 'Пациентов в моём доступе' },
        { icon: Activity, value: ownEncounters.length, label: 'Незавершённых приёмов' },
        { icon: FileCheck2, value: incoming.length, label: 'Направлений ко мне' },
      ].map(item => <article className={styles.metric} key={item.label}><item.icon size={25} /><div><strong>{item.value}</strong><span>{item.label}</span></div></article>)}</section>}
      {mode === 'referrals' && <ReferralsPanel snapshot={snapshot} blocked={busy || !!pending} onCommand={execute} confirmedCommand={confirmedCommand} />}
      <div className={styles.columns}><section className={styles.panel}>
        {patientId ? <><h2>Подтверждённые записи приёмов</h2><p className={styles.hint}>Только проверенные врачом записи. Расшифровка и черновики не становятся клиническими фактами автоматически.</p>{published.length ? published.map(note => <article key={note.id} className={styles.note}><header><strong>{doctor(note.practitionerId)}</strong><span>{time(note.publishedAt ?? note.createdAt)}</span></header><dl>{Object.entries(labels).map(([key, label]) => note.content[key as keyof typeof note.content] ? <div key={key} style={{ display: 'contents' }}><dt>{label}</dt><dd>{note.content[key as keyof typeof note.content]}</dd></div> : null)}</dl></article>) : <div className={styles.empty}>Подтверждённых записей пока нет.</div>}</> : <><h2>Пациенты</h2><input className={styles.search} aria-label="Поиск пациента по имени или номеру карты" placeholder="Имя или номер карты…" value={query} onChange={event => setQuery(event.target.value)} /><div className={styles.list}>{patients.map(item => <article key={item.id} className={styles.row}><div className={styles.rowBody}><Link href={`/patients/${encodeURIComponent(item.id)}`}><strong>{item.name}</strong></Link><small>{item.mrn} · {item.birthDate ?? 'Дата рождения не указана'}</small></div><button className={styles.primary} disabled={busy || !!pending} onClick={() => start(item.id)}><Stethoscope size={16} />Начать приём</button></article>)}{!patients.length && <div className={styles.empty}>Нет пациентов по текущему доступу или запросу. Направленные к вам пациенты появятся во входящих.</div>}</div></>}
      </section><div className={styles.list}>
        <section className={styles.panel}><h2>Сейчас в работе</h2><div className={styles.list}>{ownEncounters.filter(item => !patientId || item.patientId === patientId).map(item => <Link key={item.id} href={`/clinical?encounterId=${encodeURIComponent(item.id)}`} className={styles.row}><div className={styles.rowBody}><strong>{name(item.patientId)}</strong><small>Продолжить приём · {time(item.updatedAt)}</small></div><ArrowRight size={18} /></Link>)}{!ownEncounters.some(item => !patientId || item.patientId === patientId) && <p className={styles.empty}>Нет незавершённых приёмов.</p>}</div></section>
        <section className={styles.panel}><h2>Направлены ко мне</h2><div className={styles.list}>{incoming.filter(item => !patientId || item.patientId === patientId).map(item => <article key={item.id} className={styles.row}><div className={styles.rowBody}><span className={`${styles.badge} ${item.priority === 'urgent' ? styles.urgent : ''}`}>{item.priority === 'urgent' ? 'Срочное направление' : 'Консультация'}</span><strong>{name(item.patientId)}</strong><small>От {doctor(item.sourcePractitionerId)}</small><p>{item.reason}</p><button className={styles.primary} disabled={busy || !!pending} onClick={() => void execute({ type: 'referral.accept', referralId: item.id, expectedVersion: item.version, idempotencyKey: crypto.randomUUID() })}>Принять и открыть приём</button></div></article>)}{!incoming.some(item => !patientId || item.patientId === patientId) && <p className={styles.empty}>Новых направлений нет.</p>}</div></section>
        {patientId && <Link className={styles.button} href="/patients">Все мои пациенты</Link>}
      </div></div><footer className={styles.footer}>Доступ ограничен вашими назначениями и направленными к вам консультациями. Обновлено {time(snapshot.generatedAt)}. Локальная учебная база: записи сохраняются в PostgreSQL.</footer>
    </>}
  </main>;
}
