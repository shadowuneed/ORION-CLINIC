'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';
import styles from './route-error.module.css';

export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className={styles.error} role="alert">
    <AlertCircle size={28} aria-hidden="true" />
    <h1>Раздел не удалось открыть</h1>
    <p>Попробуйте загрузить его ещё раз. Сохранённые в системе записи не удалены.</p>
    <p className={styles.note}>Повторная загрузка может сбросить несохранённые изменения. Если исходный текст ещё доступен, скопируйте его перед повтором.</p>
    <button type="button" onClick={reset}><RefreshCw size={18} aria-hidden="true" /> Повторить загрузку</button>
    <p className={styles.note}>Если ошибка повторяется, обратитесь к администратору. Текст ошибки не отправляется внешним сервисам.</p>
  </main>;
}
