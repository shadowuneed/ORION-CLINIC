'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight, LockKeyhole, LogIn, LogOut, Mail, ShieldCheck, UserRoundCheck } from 'lucide-react';
import { OrionBrand, OrionMark } from '../brand/orion-brand';
import shared from '../auth-access-screen.module.css';
import styles from './cloud-sign-in-screen.module.css';

export function CloudSignInScreen({ authenticated = false, email = null, hasStoredSession = false }: { authenticated?: boolean; email?: string | null; hasStoredSession?: boolean }) {
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // SSR is a snapshot: another tab may open a session before this form submits.
  // Presence only changes recovery controls; the server remains the authority.
  const [sessionDetected, setSessionDetected] = useState(hasStoredSession);
  const inFlight = useRef(false);

  async function authenticate(operation: 'login' | 'logout' | 'refresh') {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError('');
    try {
      const signal = AbortSignal.timeout(20_000);
      const challenge = await fetch('/api/auth/cloud/csrf', { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal });
      const nonce = await challenge.json() as { csrfToken?: unknown };
      if (!challenge.ok || typeof nonce.csrfToken !== 'string') throw new Error('AUTH_UNAVAILABLE');
      const response = await fetch(`/api/auth/cloud/${operation}`, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(operation === 'login' ? { csrfToken: nonce.csrfToken, email: address, password } : { csrfToken: nonce.csrfToken }),
      });
      const result = await response.json() as { error?: { code?: string } };
      if (!response.ok) {
        if (response.headers.get('X-ORION-Local-Session-Cleared') === 'true') {
          window.location.replace('/sign-in'); return;
        }
        const code = result.error?.code;
        if (response.status === 409 && code === 'SIGN_OUT_BEFORE_ACCOUNT_CHANGE') {
          setSessionDetected(true);
        }
        setError(code === 'AUTH_RATE_LIMITED' ? 'Слишком много попыток. Попробуйте позже.' : code === 'AUTH_REJECTED'
          ? 'Не удалось войти. Проверьте email и пароль.' : code === 'SIGN_OUT_BEFORE_ACCOUNT_CHANGE'
            ? 'Найден прежний сеанс. Завершите его кнопкой ниже — затем откроется форма входа.' : 'Не удалось выполнить вход. Попробуйте ещё раз.');
        return;
      }
      // Full navigation unloads the previous component/account material. No JWT
      // is returned to this component or stored in browser-accessible storage.
      window.location.replace(operation === 'logout' ? '/sign-in' : '/access');
    } catch { setError('Сервис входа временно недоступен. Попробуйте ещё раз.'); }
    finally { setPassword(''); setBusy(false); inFlight.current = false; }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void authenticate(authenticated || sessionDetected ? 'logout' : 'login');
  }

  return <main className={shared.page}>
    <header className={shared.brand}><OrionBrand animated size={54} /></header>
    <div className={shared.layout}>
      <section className={shared.card} aria-labelledby="cloud-auth-title">
        <span className={shared.eyebrow}><ShieldCheck size={17} aria-hidden="true" /> Защищённое рабочее место</span>
        <h1 id="cloud-auth-title">{authenticated ? 'Ваш сеанс открыт' : sessionDetected ? 'Сеанс нужно обновить' : 'Вход для сотрудников'}</h1>
        <p className={shared.description}>{authenticated ? 'Личность подтверждена. Разделы платформы открываются только по действующему рабочему назначению.' : sessionDetected ? 'Завершите прежний сеанс, чтобы открыть форму входа. Если хотите остаться в том же аккаунте, можно отдельно попробовать продолжить сеанс.' : 'Введите email и пароль своего аккаунта ORION Clinic.'}</p>
        <form className={styles.form} onSubmit={submit}>
          {authenticated ? <div className={shared.provider}><strong>{email ?? 'Подтверждённый сотрудник'}</strong><p>Чтобы войти под другим аккаунтом, завершите этот сеанс.</p></div> : !sessionDetected && <>
            <label htmlFor="cloud-email"><span><Mail size={15} aria-hidden="true" /> Email</span><input id="cloud-email" type="email" autoComplete="username" maxLength={320} required disabled={busy} value={address} onChange={(event) => setAddress(event.target.value)} /></label>
            <label htmlFor="cloud-password"><span><LockKeyhole size={15} aria-hidden="true" /> Пароль</span><input id="cloud-password" type="password" autoComplete="current-password" maxLength={1024} required disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          </>}
          {error && <p role="alert" className={styles.error}>{error}</p>}
          <button type="submit" className={`${shared.primary} ${styles.submit}`} disabled={busy}>
            {busy ? <OrionMark animated size={20} /> : authenticated || sessionDetected ? <LogOut size={19} aria-hidden="true" /> : <LogIn size={19} aria-hidden="true" />}
            <span>{busy ? 'Проверяем…' : authenticated ? 'Выйти и сменить аккаунт' : sessionDetected ? 'Завершить сеанс и войти снова' : 'Войти в рабочее место'}</span><ArrowRight size={18} aria-hidden="true" />
          </button>
          {!authenticated && sessionDetected && <button type="button" disabled={busy} className={shared.secondary} onClick={() => void authenticate('refresh')}>Попробовать продолжить сеанс</button>}
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
