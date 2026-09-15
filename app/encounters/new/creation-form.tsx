'use client';

import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { useWorkspaceCanManage, useWorkspaceFetch, useWorkspaceUrl } from '@/lib/workspace-access-context';
import styles from './creation-form.module.css';

const resultSchema = z.object({ created: z.object({ encounter: z.object({ id: z.string().min(1) }) }) });

export function EncounterCreationForm() {
  const canManage = useWorkspaceCanManage();
  const request = useWorkspaceFetch();
  const url = useWorkspaceUrl();
  const router = useRouter();
  // Keep the exact command on ambiguous failure: retry must not create a second patient.
  const command = useRef<string | null>(null);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || inFlight.current) return;
    const data = new FormData(event.currentTarget);
    if (!command.current) command.current = JSON.stringify({
      patient: { displayName: String(data.get('name')).trim(), birthDate: data.get('birthDate') || null,
        sexAtBirth: data.get('sex') },
      reasonForVisit: String(data.get('reason') || '').trim() || null,
      syntheticDataAcknowledged: data.get('synthetic') === 'on', idempotencyKey: crypto.randomUUID(),
    });
    inFlight.current = true; setPending(true); setError('');
    try {
      const response = await request('/api/workspace/encounters/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: command.current,
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status < 500) { command.current = null; setUncertain(false); }
        else setUncertain(true);
        const failure = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
        setError(failure.success ? failure.data.error.message : 'Не удалось создать приём.');
        return;
      }
      const result = resultSchema.parse(body);
      router.push(url(`/?encounterId=${encodeURIComponent(result.created.encounter.id)}`));
    } catch {
      setUncertain(true);
      setError('Ответ сервера не получен. Повторите тот же запрос — повторная карточка не будет создана.');
    } finally { inFlight.current = false; setPending(false); }
  }
  return <main className={styles.page}>
    <Link href={url('/')}>← Рабочий день</Link>
    <h1>Новый пациент и приём</h1>
    <p>Карточка и черновик приёма сохранятся в базе выбранной клиники. Для существующего пациента используйте реестр пациентов.</p>
    {!canManage ? <p role="alert">В выбранном рабочем назначении нет права создавать приёмы.</p> :
      <form onSubmit={submit}>
        <fieldset disabled={pending || uncertain}>
          <label>Имя тестового пациента<input name="name" required minLength={2} maxLength={120} autoComplete="off" /></label>
          <label>Дата рождения<input name="birthDate" type="date" max={new Date().toISOString().slice(0, 10)} /></label>
          <label>Пол<select name="sex" defaultValue="not_recorded"><option value="not_recorded">Не указан</option><option value="female">Женский</option><option value="male">Мужской</option><option value="unknown">Неизвестно</option></select></label>
          <label>Причина обращения<textarea name="reason" maxLength={500} rows={3} /></label>
          <label className={styles.confirm}><input type="checkbox" name="synthetic" required />Использую только вымышленные тестовые данные</label>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={pending}>{pending ? 'Сохраняем…' : uncertain ? 'Повторить тот же запрос' : 'Создать и открыть приём'}</button>
      </form>}
  </main>;
}
