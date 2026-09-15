'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { ArrowUpRight, RefreshCw, Search } from 'lucide-react';
import type { AccessibleEncounter } from '@/lib/auth/workspace-access';
import { useWorkspaceCanManage, useWorkspaceFetch, useWorkspaceUrl } from '@/lib/workspace-access-context';
import styles from './clinic-dashboard.module.css';

const labels: Record<AccessibleEncounter['status'], string> = {
  draft: 'Черновик', ready: 'Готов к приёму', in_progress: 'Приём идёт',
  review: 'На проверке', finalized: 'Завершён', amended: 'Исправлен', cancelled: 'Отменён',
};

const encounterSchema = z.object({
  id: z.string(), facilityName: z.string(), updatedAt: z.number().finite(),
  status: z.enum(['draft', 'ready', 'in_progress', 'review', 'finalized', 'amended', 'cancelled']),
  patient: z.object({ displayName: z.string(), medicalRecordNumber: z.string() }),
});
const responseSchema = z.object({
  encounters: z.array(encounterSchema).optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

export function ClinicDashboard({ capabilities }: { capabilities: { patientDirectory: boolean; scheduling: boolean; chronicCare: boolean } }) {
  const workspaceFetch = useWorkspaceFetch();
  const workspaceUrl = useWorkspaceUrl();
  const canManage = useWorkspaceCanManage();
  const [encounters, setEncounters] = useState<z.infer<typeof encounterSchema>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      // Reuse the existing assigned-encounter and audited read boundary.
      const response = await workspaceFetch('/api/workspace', { cache: 'no-store', signal });
      const body = responseSchema.parse(await response.json());
      if (signal?.aborted) return;
      if (response.status === 404 && body.error?.code === 'ENCOUNTER_NOT_FOUND') {
        setEncounters([]);
      } else if (!response.ok || !body.encounters) {
        throw new Error(body.error?.message ?? 'Не удалось загрузить рабочий день.');
      } else {
        setEncounters(body.encounters);
      }
      setUpdatedAt(Date.now());
    } catch (failure) {
      if (signal?.aborted) return;
      setEncounters([]);
      setError(failure instanceof Error ? failure.message : 'Не удалось связаться с сервером.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [workspaceFetch]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load]);
  const active = encounters.filter((item) => ['draft', 'ready', 'in_progress'].includes(item.status));
  const review = encounters.filter((item) => item.status === 'review');
  const completed = encounters.filter((item) => ['finalized', 'amended'].includes(item.status));
  const visible = encounters.filter((item) => {
    const matches = `${item.patient.displayName} ${item.patient.medicalRecordNumber}`.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim());
    return matches && (filter === 'all' || (filter === 'active' && active.includes(item)) ||
      (filter === 'review' && item.status === 'review') || (filter === 'completed' && completed.includes(item)));
  });

  return <main className={styles.dashboard}>
    <header className={styles.heading}>
      <div><p className={styles.eyebrow}>ORION CLINIC · РАБОЧЕЕ МЕСТО ВРАЧА</p><h1>Рабочий день</h1>
        <p>Ваши назначенные приёмы и незавершённая работа. Данные из базы клиники.</p></div>
      <button onClick={() => void load()} disabled={loading}><RefreshCw size={17} />{loading ? 'Загрузка…' : 'Обновить'}</button>
    </header>
    <div className={styles.notice}>Тестовые пациенты · только выбранное рабочее назначение · все даты</div>
    {canManage && <p className={styles.createAction}><Link href={workspaceUrl('/encounters/new')}>+ Новый пациент и приём</Link></p>}
    <section className={styles.metrics} aria-label="Обзор приёмов">
      {[['all', 'Все приёмы', encounters.length], ['active', 'В работе', active.length],
        ['review', 'Ожидают подписания', review.length], ['completed', 'Завершены', completed.length]].map(([id, label, count]) =>
        <button key={id} aria-pressed={filter === id} onClick={() => setFilter(String(id))} disabled={loading || !!error}>
          <span>{label}</span><strong>{loading || error ? '—' : count}</strong><small>Показать приёмы <ArrowUpRight size={15} /></small>
        </button>)}
    </section>
    <section className={styles.worklist} aria-labelledby="dashboard-list">
      <div className={styles.listHeader}><div><h2 id="dashboard-list">Назначенные приёмы</h2><p>Откройте карточку для продолжения приёма или проверки протокола.</p></div>
        <label className={styles.search}><Search size={18}/><input aria-label="Поиск пациента в приёмах" placeholder="Пациент или номер карты" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      </div>
      {error ? <div role="alert" className={styles.empty}><h3>Не удалось загрузить приёмы</h3><p>{error}</p><button onClick={() => void load()}>Повторить загрузку</button></div>
        : loading ? <p role="status" className={styles.empty}>Загружаем данные из БД…</p>
        : visible.length === 0 ? <div className={styles.empty}><h3>{encounters.length ? 'По этому фильтру приёмов нет' : 'Нет назначенных приёмов'}</h3><p>Измените фильтр или откройте реестр пациентов.</p></div>
        : <div className={styles.tableWrap}><table><thead><tr><th>Пациент</th><th>Состояние</th><th>Последнее изменение</th><th><span className={styles.srOnly}>Действие</span></th></tr></thead>
          <tbody>{visible.map((item) => <tr key={item.id}><td><strong>{item.patient.displayName}</strong><small>{item.patient.medicalRecordNumber} · {item.facilityName}</small></td>
            <td><span className={styles.status} data-state={item.status}>{labels[item.status]}</span></td>
            <td>{new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(item.updatedAt)}</td>
            <td><Link href={workspaceUrl(`/?encounterId=${encodeURIComponent(item.id)}`)}>Открыть приём <ArrowUpRight size={16}/></Link></td></tr>)}</tbody></table></div>}
      <footer>{updatedAt && !error ? `Обновлено ${new Date(updatedAt).toLocaleTimeString('ru-RU')}` : 'Серверный реестр приёмов'}</footer>
    </section>
    <nav className={styles.shortcuts} aria-label="Быстрые переходы">
      {capabilities.patientDirectory && <Link href="/patients"><strong>Пациенты</strong><span>Найти пациента, открыть карту или создать приём</span><ArrowUpRight /></Link>}
      {capabilities.scheduling && <Link href="/scheduling"><strong>Запись и очередь</strong><span>Расписание, свободные окна и очередь</span><ArrowUpRight /></Link>}
      {capabilities.chronicCare && <Link href="/care"><strong>Наблюдение</strong><span>Планы и задачи последующего наблюдения</span><ArrowUpRight /></Link>}
    </nav>
  </main>;
}
