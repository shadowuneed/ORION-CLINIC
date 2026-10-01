'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { workspaceNavigationUrl } from '@/lib/workspace-access-url';
import { useEffect, useMemo, useRef, useState } from 'react';
import { localAccountModeEnabled } from '@/lib/local-account-mode';
import {
  CalendarClock,
  Route,
  LayoutDashboard,
  LogOut,
  Moon,
  Stethoscope,
  Sun,
  Users,
  ShieldCheck,
  KeyRound,
  BookOpen,
  ChevronDown,
} from 'lucide-react';
import styles from './clinic-shell.module.css';
import { OrionBrand } from './brand/orion-brand';
import { requestPathwayMotion } from './pathway-link';

type Theme = 'light' | 'dark';

const navigation = [
  { href: '/', label: 'Обзор', icon: LayoutDashboard, capability: 'clinician' },
  { href: '/patients', label: 'Пациенты', icon: Users, capability: 'patientDirectory' },
  { href: '/live', label: 'Приём и запись', icon: Stethoscope, capability: 'clinician' },
  { href: '/scheduling', label: 'Расписание и очередь', icon: CalendarClock, capability: 'scheduling' },
  { href: '/pathway', label: 'Маршрут пациента', icon: Route, capability: 'pathway' },
] as const;

const cloudNavigation = [
  { href: '/dashboard', label: 'Обзор', icon: LayoutDashboard, capability: 'dashboard' },
  { href: '/patients', label: 'Пациенты', icon: Users, capability: 'patientDirectory' },
] as const;
const compactLabels: Record<string, string> = { '/': 'Обзор', '/dashboard': 'Обзор', '/patients': 'Пациенты', '/live': 'Приём', '/scheduling': 'Очередь', '/pathway': 'Маршрут' };

function isActivePath(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  if (href === '/pathway') return ['/pathway', '/orders', '/care', '/observations', '/communications'].includes(pathname);
  if (href === '/access') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function readTheme(): Theme {
  try {
    const saved = window.localStorage.getItem('orion-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Continue with the browser preference when storage is unavailable.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function persistTheme(theme: Theme) {
  try {
    window.localStorage.setItem('orion-theme', theme);
  } catch {
    // The cookie still preserves the preference when localStorage is blocked.
  }
  document.cookie = `orion-theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function ClinicShell({
  children,
  capabilities,
  user,
  profile,
  cloudMode = false,
}: {
  children: React.ReactNode;
  capabilities: {
    dashboard?: boolean;
    clinician: boolean;
    patientDirectory: boolean;
    orders: boolean;
    scheduling: boolean;
    chronicCare: boolean;
    observations: boolean;
    communications: boolean;
    pathway: boolean;
    accessOverview: boolean;
    accessAdministration: boolean;
  };
  user: { displayName: string; email: string | null };
  profile?: { staffName: string; roles: string[]; workplace: string | null };
  cloudMode?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceLink = (target: string) => {
    if (cloudMode && ['/dashboard', '/patients'].includes(target)) {
      const scoped = new URL(target, 'https://orion.invalid');
      for (const key of ['accessAssignmentId', 'facilityId']) {
        for (const value of searchParams.getAll(key)) scoped.searchParams.append(key, value);
      }
      return `${scoped.pathname}${scoped.search}`;
    }
    const url = workspaceNavigationUrl(target, pathname, searchParams.toString());
    if (target !== '/') return url;
    const dashboard = new URL(url, 'https://orion.invalid');
    dashboard.searchParams.delete('encounterId');
    return `${dashboard.pathname}${dashboard.search}`;
  };
  const [theme, setTheme] = useState<Theme>('light');
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  function navigateWithPathwayMotion(event: React.MouseEvent<HTMLAnchorElement>, target: string, label: string) {
    const targetPath = new URL(target, window.location.href).pathname;
    if (pathname === '/pathway' && targetPath === '/pathway' && new URL(target, window.location.href).href !== window.location.href &&
      event.button === 0 &&
      !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      window.history.pushState(null, '', target);
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    // The persistent layout owns motion across the unmount/mount of page shells.
    requestPathwayMotion(event, target, pathname, label);
  }

  useEffect(() => {
    if (!profileOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [profileOpen]);

  useEffect(() => {
    const nextTheme = readTheme();
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    const timer = window.setTimeout(() => {
      setTheme(nextTheme);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  // Feature availability is presentation, not permission. The server still
  // authorizes every request against the exact selected assignment.
  const permittedNavigation = (cloudMode ? cloudNavigation : navigation).filter(
    (item) => capabilities[item.capability] === true,
  );
  const homeTarget = cloudMode ? (capabilities.dashboard === true ? workspaceLink('/dashboard') : capabilities.patientDirectory ? workspaceLink('/patients') : '/access')
    : capabilities.clinician ? workspaceLink('/') : '/access';
  const homeLabel = cloudMode && capabilities.dashboard === true ? 'ORION Clinic — рабочий центр'
    : cloudMode && capabilities.patientDirectory ? 'ORION Clinic — пациенты'
    : !cloudMode && capabilities.clinician ? 'ORION Clinic — обзор' : 'ORION Clinic — моя роль и права';
  const initials = useMemo(
    () =>
      (profile?.staffName || user.displayName)
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase() || 'В',
    [profile?.staffName, user.displayName],
  );

  function toggleTheme() {
    const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    persistTheme(nextTheme);
    setTheme(nextTheme);
  }

  return (
    <div className={styles.shell} data-orion-route-path={pathname}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href={homeTarget} aria-label={homeLabel}
          onClick={(event) => navigateWithPathwayMotion(event, homeTarget, cloudMode && capabilities.dashboard !== true ? 'Пациенты' : 'Обзор')}>
          <OrionBrand animated size={44} wordmarkClassName={styles.brandCopy} />
        </Link>

        <div className={styles.actions}>
          <div className={styles.profile} ref={profileRef}>
            <button aria-expanded={profileOpen} aria-controls="orion-profile-panel" aria-label={`Открыть профиль: ${profile?.staffName || user.displayName}`}
              className={styles.profileTrigger} onClick={() => setProfileOpen((open) => !open)} type="button">
              <span className={styles.avatar} aria-hidden="true">{initials}</span>
              <span className={styles.identityCopy}><strong>{profile?.staffName || user.displayName}</strong><small>{profile?.roles.join(' · ') || (cloudMode || localAccountModeEnabled() ? 'Доступ не назначен' : 'Технический вход')}</small></span>
              <ChevronDown aria-hidden="true" size={16} />
            </button>
            {profileOpen && <div className={styles.profileMenu} id="orion-profile-panel" aria-label="Профиль и настройки">
              <div className={styles.profileSummary}>
                <span className={styles.profileEyebrow}>Рабочий профиль</span>
                <strong>{profile?.staffName || user.displayName}</strong>
                <span>{profile?.roles.join(' · ') || (cloudMode || localAccountModeEnabled() ? 'Активное назначение не найдено' : 'Персональный доступ сотрудника не подключён')}</span>
                {profile?.workplace && <span>{profile.workplace}</span>}
                <small>{cloudMode ? 'Персональный вход Supabase' : localAccountModeEnabled() ? 'Личный вход сотрудника' : 'Вход среды разработки'}: {user.displayName}{user.email ? ` · ${user.email}` : ''}</small>
              </div>
              <Link href={workspaceLink('/access')} onClick={(event) => { setProfileOpen(false); navigateWithPathwayMotion(event, workspaceLink('/access'), 'Моя роль и права'); }}><ShieldCheck aria-hidden="true" size={18} />Моя роль и права</Link>
              {!cloudMode && capabilities.accessAdministration && <Link href={workspaceLink('/access/manage')} onClick={(event) => { setProfileOpen(false); navigateWithPathwayMotion(event, workspaceLink('/access/manage'), 'Сотрудники и доступ'); }}><KeyRound aria-hidden="true" size={18} />Сотрудники и доступ</Link>}
              {(searchParams.has('accessAssignmentId') || searchParams.has('facilityId')) &&
                <a href={cloudMode ? '/access' : pathname}><KeyRound aria-hidden="true" size={18} />Сменить рабочий доступ</a>}
              {!cloudMode && <Link href="/help" onClick={(event) => { setProfileOpen(false); navigateWithPathwayMotion(event, '/help', 'Инструкция'); }}><BookOpen aria-hidden="true" size={18} />Инструкция</Link>}
              <button onClick={toggleTheme} type="button">
                {theme === 'dark' ? <Sun aria-hidden="true" size={18} /> : <Moon aria-hidden="true" size={18} />}
                {theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
              </button>
              {!cloudMode && localAccountModeEnabled() && <>
                <a href="/account/password"><KeyRound aria-hidden="true" size={18} />Сменить пароль</a>
                <a href="/sign-in"><Users aria-hidden="true" size={18} />Другой аккаунт</a>
              </>}
              <a className={styles.profileSignOut} href="/sign-in" target="_top"><LogOut aria-hidden="true" size={18} />Выйти и сменить аккаунт</a>
            </div>}
          </div>
        </div>
      </header>

      <aside className={styles.sidebar}>
        <nav aria-label="Основная навигация">
          <span className={styles.navCaption}>Рабочее пространство</span>
          {permittedNavigation.map((item) => {
            const Icon = item.icon;
            const active = isActivePath(pathname, item.href);
            return (
              <Link
                aria-current={active ? 'page' : undefined}
                className={`${styles.navItem} ${active ? styles.navActive : ''} ${item.href === '/pathway' ? styles.pathwayItem : ''}`}
                href={workspaceLink(item.href)}
                key={item.href}
                aria-label={item.label}
                title={item.label}
                onPointerEnter={() => router.prefetch(workspaceLink(item.href))}
                onFocus={() => router.prefetch(workspaceLink(item.href))}
                onClick={(event) => navigateWithPathwayMotion(event, workspaceLink(item.href), item.label)}
              >
                <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
                <span>{item.label}</span>
                <span className={styles.mobileLabel}>{compactLabels[item.href]}</span>
              </Link>
            );
          })}
          {cloudMode && capabilities.accessOverview && <Link className={`${styles.navItem} ${pathname === '/access' ? styles.navActive : ''}`}
            href="/access" aria-label="Мой доступ" title="Мой доступ" aria-current={pathname === '/access' ? 'page' : undefined}>
            <ShieldCheck aria-hidden="true" size={20} strokeWidth={1.8} />
            <span>Мой доступ</span><span className={styles.mobileLabel}>Доступ</span>
          </Link>}
        </nav>

      </aside>

      <div className={styles.content} data-pathway-page={pathname === '/pathway' ? 'true' : undefined}
        data-orion-page-content tabIndex={-1}>
        {cloudMode && <div className={styles.cloudNotice} aria-label="Возможности облачной версии">
          <strong>ORION Cloud</strong><span>Доступны карточки пациентов и проверка прав; рабочий центр показывает последние сохранённые состояния карт. Это не полная клиническая лента. Приём, маршрут, измерения и срочные клинические уведомления ещё не перенесены в облако.</span>
        </div>}
        {children}
      </div>
    </div>
  );
}
