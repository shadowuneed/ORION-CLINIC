import { ArrowRight, CheckCircle2, LogIn, LogOut, ShieldCheck, UserRoundCheck, LockKeyhole } from 'lucide-react';
import Link from 'next/link';
import { chatGPTProviderSignInPath, chatGPTSignInPath, chatGPTSignOutPath } from '@/lib/auth/chatgpt-navigation';
import styles from './auth-access-screen.module.css';
import { OrionBrand } from './brand/orion-brand';

type Mode = 'signin' | 'signedout' | 'active' | 'recognized';

/** Public entry/exit UI. Authentication is performed by the configured provider, not this screen. */
export function AuthAccessScreen({ mode, returnTo = '/', localDevelopment = false, currentProfile }: {
  mode: Mode;
  returnTo?: string;
  localDevelopment?: boolean;
  currentProfile?: { staffName: string; roles: string[]; providerName: string };
}) {
  const signingIn = mode === 'signin';
  const active = mode === 'active';
  const recognized = mode === 'recognized';
  const title = signingIn ? 'Вход для сотрудников' : recognized ? 'Вы уже вошли' : active ? 'Сеанс ещё открыт' : 'Вы вышли из рабочего места';
  const description = signingIn
    ? 'ORION Clinic открывает рабочее место врача и других сотрудников. Карточка пациента — медицинская запись, а не аккаунт для входа.'
    : recognized
      ? 'Ваша текущая личность уже подтверждена. Проверьте рабочий профиль и выберите подразделение перед продолжением.'
    : active
      ? 'Открытие страницы выхода само по себе не завершает сеанс. Нажмите кнопку ниже, чтобы выйти.'
      : 'Чтобы снова открыть пациентов и приёмы, выполните вход. Сохранённые записи остаются в системе.';
  const action = signingIn ? chatGPTProviderSignInPath(localDevelopment ? '/access' : returnTo) : recognized ? '/access' : active ? chatGPTSignOutPath() : chatGPTSignInPath('/');
  const ActionIcon = active ? LogOut : LogIn;

  return <main className={styles.page}>
    <header className={styles.brand} aria-label="ORION Clinic">
      <OrionBrand animated size={54} />
    </header>
    <div className={styles.layout}>
      <section className={styles.card} aria-labelledby="auth-title">
        <span className={styles.eyebrow}><ShieldCheck size={17} aria-hidden="true" /> ORION Clinic · рабочее место</span>
        {!signingIn && !active && <span className={styles.status}><CheckCircle2 size={17} aria-hidden="true" /> Сеанс завершён</span>}
        <h1 id="auth-title">{title}</h1>
        <p className={styles.description}>{description}</p>
        {recognized && <div className={styles.provider}>
          <strong>{currentProfile?.staffName ?? 'Сотрудник без назначения'}</strong>
          <p>{currentProfile?.roles.length ? currentProfile.roles.join(' · ') : 'Действующее рабочее назначение не найдено'}</p>
          {localDevelopment && <span className={styles.limitation}>Техническая личность окружения: {currentProfile?.providerName ?? 'не определена'}. Это не персональный вход по логину и паролю.</span>}
        </div>}
        {signingIn && <div className={styles.provider}>
          <strong>{localDevelopment ? 'Сейчас: технический вход для разработки' : 'Вход через подключённый провайдер'}</strong>
          <p>{localDevelopment
            ? 'Кнопка ниже откроет тестовый профиль среды. Личный логин сотрудника здесь пока не подключён; выбрать другого сотрудника на этой странице нельзя.'
            : 'Личность проверяет настроенный провайдер. Доступ к разделам определяется текущими назначениями сотрудника на сервере.'}</p>
          {localDevelopment && <span className={styles.limitation}>Технический профиль нельзя использовать как общий вход для клиники.</span>}
        </div>}
        <a className={styles.primary} href={action} target="_top">
          <ActionIcon size={19} aria-hidden="true" />
          <span>{signingIn ? localDevelopment ? 'Проверить рабочий профиль' : 'Продолжить вход сотрудника' : recognized ? 'Выбрать рабочий доступ' : active ? 'Завершить сеанс' : 'Перейти ко входу'}</span>
          <ArrowRight size={18} aria-hidden="true" />
        </a>
        {active && <Link className={styles.secondary} href="/">Вернуться в рабочее место</Link>}
        {recognized && <a className={styles.secondary} href={chatGPTSignOutPath()} target="_top">Выйти из текущего сеанса</a>}
        <p className={styles.footnote}>{signingIn
          ? 'После входа вы увидите имя и права в рабочем профиле. Действия без назначенного доступа останутся закрыты.'
          : 'Вход выполняется только по вашему нажатию — автоматического возврата в приём нет.'}</p>
      </section>
      <aside className={styles.roles} aria-labelledby="roles-title">
        <h2 id="roles-title">Как работает доступ</h2>
        <p>Вход и медицинские данные — разные вещи. Доступ зависит от действующего назначения сотрудника.</p>
        <ul>
          <li><UserRoundCheck aria-hidden="true" size={21} /><div><strong>Сотрудник входит</strong><span>Профиль и доступные разделы показываются после проверки личности.</span></div></li>
          <li><LockKeyhole aria-hidden="true" size={21} /><div><strong>Права проверяются сервером</strong><span>Выбор роли на экране входа не даёт полномочий.</span></div></li>
        </ul>
      </aside>
    </div>
  </main>;
}
