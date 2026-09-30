'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ArrowRight, LockKeyhole, LogIn, LogOut, Mail, ShieldCheck, UserRoundCheck } from 'lucide-react';
import { OrionBrand, OrionMark } from '../brand/orion-brand';
import shared from '../auth-access-screen.module.css';
import styles from './cloud-sign-in-screen.module.css';

export function CloudSignInScreen({ authenticated = false, email = null, hasStoredSession = false }: { authenticated?: boolean; email?: string | null; hasStoredSession?: boolean }) {
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function authenticate(operation: 'login' | 'logout' | 'refresh') {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const challenge = await fetch('/api/auth/cloud/csrf', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
      const nonce = await challenge.json() as { csrfToken?: unknown };
      if (!challenge.ok || typeof nonce.csrfToken !== 'string') throw new Error('AUTH_UNAVAILABLE');
      const response = await fetch(`/api/auth/cloud/${operation}`, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(operation === 'login' ? { csrfToken: nonce.csrfToken, email: address, password } : { csrfToken: nonce.csrfToken }),
      });
      const result = await response.json() as { error?: { code?: string } };
      if (!response.ok) {
        if (response.headers.get('X-ORION-Local-Session-Cleared') === 'true') {
          window.location.replace('/sign-in'); return;
        }
        const code = result.error?.code;
        setError(code === 'AUTH_RATE_LIMITED' ? 'Слишком много попыток. Попробуйте позже.' : code === 'AUTH_REJECTED'
          ? 'Не удалось войти. Проверьте email и пароль.' : code === 'SIGN_OUT_BEFORE_ACCOUNT_CHANGE'
            ? 'Сначала завершите текущий сеанс, затем войдите в другой аккаунт.' : 'Не удалось выполнить вход. Попробуйте ещё раз.');
        return;
      }
      // Full navigation unloads the previous component/account material. No JWT
      // is returned to this component or stored in browser-accessible storage.
      window.location.replace(operation === 'logout' ? '/sign-in' : '/access');
    } catch { setError('Сервис входа временно недоступен. Попробуйте ещё раз.'); }
    finally { setPassword(''); setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void authenticate(authenticated ? 'logout' : hasStoredSession ? 'refresh' : 'login');
  }

  return <main className={shared.page}>
    <header className={shared.brand}><OrionBrand animated size={54} /></header>
    <div className={shared.layout}>
      <section className={shared.card} aria-labelledby="cloud-auth-title">
        <span className={shared.eyebrow}><ShieldCheck size={17} aria-hidden="true" /> Защищённое рабочее место</span>
        <h1 id="cloud-auth-title">{authenticated ? 'Ваш сеанс открыт' : hasStoredSession ? 'Сеанс нужно обновить' : 'Вход для сотрудников'}</h1>
        <p className={shared.description}>{authenticated ? 'Личность подтверждена. Разделы платформы открываются только по действующему рабочему назначению.' : hasStoredSession ? 'Продолжите ранее открытый сеанс или завершите его, чтобы войти под другим аккаунтом. Доступ будет проверен заново.' : 'Введите email и пароль своего аккаунта ORION Clinic.'}</p>
        <form className={styles.form} onSubmit={submit}>
          {authenticated ? <div className={shared.provider}><strong>{email ?? 'Подтверждённый сотрудник'}</strong><p>Чтобы войти под другим аккаунтом, завершите этот сеанс.</p></div> : !hasStoredSession && <>
            <label htmlFor="cloud-email"><span><Mail size={15} aria-hidden="true" /> Email</span><input id="cloud-email" type="email" autoComplete="username" maxLength={320} required disabled={busy} value={address} onChange={(event) => setAddress(event.target.value)} /></label>
            <label htmlFor="cloud-password"><span><LockKeyhole size={15} aria-hidden="true" /> Пароль</span><input id="cloud-password" type="password" autoComplete="current-password" maxLength={1024} required disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          </>}
          {error && <p role="alert" className={styles.error}>{error}</p>}
          <button type="submit" className={`${shared.primary} ${styles.submit}`} disabled={busy}>
            {busy ? <OrionMark animated size={20} /> : authenticated ? <LogOut size={19} aria-hidden="true" /> : <LogIn size={19} aria-hidden="true" />}
            <span>{busy ? 'Проверяем…' : authenticated ? 'Выйти и сменить аккаунт' : hasStoredSession ? 'Продолжить сеанс' : 'Войти в рабочее место'}</span><ArrowRight size={18} aria-hidden="true" />
          </button>
          {!authenticated && hasStoredSession && <button type="button" disabled={busy} className={shared.secondary} onClick={() => void authenticate('logout')}>Завершить сеанс и войти снова</button>}
        </form>
        {authenticated && <Link className={shared.secondary} href="/access">Открыть рабочий доступ</Link>}
        <p className={shared.footnote}>Если аккаунта ещё нет, обратитесь к администратору клиники. Самостоятельная регистрация закрыта.</p>
      </section>
      <aside className={shared.roles} aria-labelledby="cloud-access-title">
        <h2 id="cloud-access-title">Один аккаунт. Ваши рабочие разделы.</h2>
        <p>Врач, медсестра и администратор используют отдельные аккаунты. Права назначаются в клинике, а не выбираются на экране входа.</p>
        <ul><li><UserRoundCheck size={21} aria-hidden="true" /><div><strong>Персональный вход</strong><span>Сеанс проверяется сервером. Общего технического профиля здесь нет.</span></div></li>
          <li><LockKeyhole size={21} aria-hidden="true" /><div><strong>Медицинские данные защищены</strong><span>Успешный вход сам по себе не даёт доступа к пациентам или полномочий администратора.</span></div></li></ul>
      </aside>
    </div>
  </main>;
}
