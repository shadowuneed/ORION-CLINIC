'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { ClinicalCommand, ClinicalSnapshot } from '@/lib/clinical/contracts';
import styles from './registry.module.css';

const statuses = { pending: 'Ожидает ответа', accepted: 'Принято', declined: 'Отклонено', revoked: 'Отозвано' };
export type ReferralAction = { id: string; type: 'referral.decline' | 'referral.revoke'; version: number };
export function referralGroups(snapshot: ClinicalSnapshot) {
  const own = snapshot.practitioner.id;
  const referrals = snapshot.referrals.filter(item => item.recipientPractitionerId === own || item.sourcePractitionerId === own)
    .sort((a, b) => Number(b.priority === 'urgent') - Number(a.priority === 'urgent') || b.createdAt.localeCompare(a.createdAt));
  return [
    { id: 'urgent', title: 'Входящие: срочные', items: referrals.filter(item => item.status === 'pending' && item.recipientPractitionerId === own && item.priority === 'urgent') },
    { id: 'routine', title: 'Входящие: плановые', items: referrals.filter(item => item.status === 'pending' && item.recipientPractitionerId === own && item.priority !== 'urgent') },
    { id: 'outgoing', title: 'Исходящие: ожидают ответа', items: referrals.filter(item => item.status === 'pending' && item.recipientPractitionerId !== own) },
    { id: 'history', title: 'История направлений', items: referrals.filter(item => item.status !== 'pending') },
  ].filter(group => group.items.length);
}
export function confirmedReferralAction(action: ReferralAction | null, command?: ClinicalCommand | null) {
  return !!action && command?.type === action.type && 'referralId' in command && command.referralId === action.id && command.expectedVersion === action.version;
}
/** False or rejection must keep the clinician's reason and form intact. */
export async function commitReferralAction(command: ClinicalCommand, onCommand: (command: ClinicalCommand) => Promise<boolean>, onConfirmed: () => void) {
  const confirmed = await onCommand(command);
  if (confirmed) onConfirmed();
  return confirmed;
}
export function ReferralsPanel({ snapshot, blocked, onCommand, confirmedCommand }: {
  snapshot: ClinicalSnapshot; blocked: boolean; onCommand: (command: ClinicalCommand) => Promise<boolean>; confirmedCommand?: ClinicalCommand | null;
}) {
  const [action, setAction] = useState<ReferralAction | null>(null); const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false); const [error, setError] = useState(''); const lock = useRef(false); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const done = confirmedReferralAction(action, confirmedCommand); const activeAction = done ? null : action;
  const groups = referralGroups(snapshot); const disabled = blocked || sending;
  async function submit(command: ClinicalCommand) {
    if (lock.current || blocked) return;
    lock.current = true; setSending(true); setError('');
    try { await commitReferralAction(command, onCommand, () => { if (mounted.current) { setAction(null); setReason(''); } }); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Изменение не подтверждено. Причина сохранена в форме.'); }
    finally { lock.current = false; if (mounted.current) setSending(false); }
  }
  return <section className={styles.panel}><h2>Направления: ко мне и от меня</h2><p className={styles.hint}>Специалист получает только адресованные ему консультации. Подтверждённая запись прикрепляется к направлению; расшифровка и черновики автора не передаются.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {groups.map(group => <section className={styles.referralGroup} key={group.id} aria-label={group.title}><h3>{group.title} <span>{group.items.length}</span></h3><div className={styles.list}>{group.items.map(item => {
      const incoming = item.recipientPractitionerId === snapshot.practitioner.id;
      const person = snapshot.practitioners.find(p => p.id === (incoming ? item.sourcePractitionerId : item.recipientPractitionerId));
      const changed = activeAction?.id === item.id && (activeAction.version !== item.version || item.status !== 'pending');
      return <article className={`${styles.row} ${styles.referralRow}`} key={item.id}><div className={styles.rowBody}>
        <span className={`${styles.badge} ${item.priority === 'urgent' && item.status === 'pending' ? styles.urgent : ''}`}>{incoming ? 'Ко мне' : 'От меня'} · {statuses[item.status]}{item.priority === 'urgent' ? ' · Срочное' : ''}</span>
        <h4><Link href={`/patients/${encodeURIComponent(item.patientId)}`}>{snapshot.patients.find(p => p.id === item.patientId)?.name ?? 'Пациент'}</Link></h4>
        <small>{incoming ? 'Направил' : 'Получатель'}: {person?.name ?? 'Сотрудник'} · {person?.specialty ?? 'Специальность не указана'}</small><p>{item.reason}</p>
        <div className={styles.actions}>{item.status === 'pending' && <>{incoming && <button type="button" className={styles.primary} disabled={disabled || !!activeAction} onClick={() => void submit({ type: 'referral.accept', referralId: item.id, expectedVersion: item.version, idempotencyKey: crypto.randomUUID() })}>Принять и открыть приём</button>}
          <button type="button" className={styles.button} disabled={disabled || !!activeAction} onClick={() => { setReason(''); setError(''); setAction({ id: item.id, type: incoming ? 'referral.decline' : 'referral.revoke', version: item.version }); }}>{incoming ? 'Отклонить с причиной' : 'Отозвать направление'}</button></>}
          {incoming && item.status === 'accepted' && item.resultingEncounterId && <Link className={styles.primary} href={`/clinical?encounterId=${encodeURIComponent(item.resultingEncounterId)}`}>Открыть консультацию</Link>}
        </div>
        {activeAction?.id === item.id && <form className={`${styles.registration} ${styles.referralForm}`} onSubmit={event => { event.preventDefault(); if (!disabled && !changed && reason.trim()) void submit({ type: activeAction.type, referralId: item.id, expectedVersion: activeAction.version, reason: reason.trim(), idempotencyKey: crypto.randomUUID() }); }}>
          <label>Причина изменения<textarea required maxLength={1000} rows={3} disabled={disabled} value={reason} onChange={event => setReason(event.target.value)} /></label>
          {changed && <p className={styles.hint} role="status">Направление уже изменилось. Причина оставлена в форме; это действие не будет отправлено поверх новой версии.</p>}
          <button className={styles.button} type="button" disabled={disabled} onClick={() => setAction(null)}>Оставить направление</button>
          <button className={styles.primary} type="submit" disabled={disabled || changed || !reason.trim()}>Подтвердить {incoming ? 'отклонение' : 'отзыв'}</button>
        </form>}
      </div></article>;
    })}</div></section>)}
    {!groups.length && <p className={styles.empty}>Направлений в вашем доступе пока нет.</p>}
  </section>;
}
