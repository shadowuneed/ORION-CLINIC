'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, AlertCircle, X } from 'lucide-react';
import { listenForModuleLoadFailure } from '@/lib/module-load-recovery';
import styles from './client-navigation-recovery.module.css';

export function ClientNavigationRecovery() {
  const [failed, setFailed] = useState(false);
  useEffect(() => listenForModuleLoadFailure(window, () => setFailed(true)), []);
  if (!failed) return null;
  return <section role="alert" className={styles.banner} aria-labelledby="navigation-recovery-title">
    <AlertCircle size={21} aria-hidden="true" />
    <div className={styles.copy}>
      <strong id="navigation-recovery-title">Не удалось загрузить страницу</strong>
      <p>Обновилась версия интерфейса или прервалась загрузка. Скопируйте несохранённый текст перед обновлением. Сохранённые в системе записи не удаляются.</p>
    </div>
    <button className={styles.reload} type="button" onClick={() => window.location.reload()}><RefreshCw size={17} aria-hidden="true" /> Обновить страницу</button>
    <button className={styles.dismiss} type="button" aria-label="Закрыть сообщение и пока не обновлять" onClick={() => setFailed(false)}><X size={19} aria-hidden="true" /></button>
  </section>;
}
