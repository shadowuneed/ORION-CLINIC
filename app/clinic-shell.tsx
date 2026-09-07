'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { workspaceNavigationUrl } from '@/lib/workspace-access-url';
import { useEffect, useMemo, useState } from 'react';
import { chatGPTSignOutPath } from '@/lib/auth/chatgpt-navigation';
import {
  CalendarClock,
  Activity,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Stethoscope,
  Sun,
  Users,
  HeartPulse,
  MessageSquareText,
  ShieldCheck,
  KeyRound,
} from 'lucide-react';
import styles from './clinic-shell.module.css';

type Theme = 'light' | 'dark';

const navigation = [
  { href: '/', label: 'Рабочий день', icon: LayoutDashboard, capability: 'clinician' },
  { href: '/patients', label: 'Пациенты', icon: Users, capability: 'patientDirectory' },
  { href: '/live', label: 'Очный приём', icon: Stethoscope, badge: 'LIVE', capability: 'clinician' },
  { href: '/orders', label: 'Направления', icon: ClipboardList, capability: 'orders' },
  { href: '/scheduling', label: 'Запись и очередь', icon: CalendarClock, badge: 'D1', capability: 'scheduling' },
  { href: '/care', label: 'Наблюдение', icon: HeartPulse, badge: 'D1', capability: 'chronicCare' },
  { href: '/observations', label: 'Показатели', icon: Activity, badge: 'D1', capability: 'observations' },
  { href: '/communications', label: 'Связь с пациентом', icon: MessageSquareText, badge: 'D1', capability: 'communications' },
  { href: '/access/manage', label: 'Управление доступом', icon: KeyRound, badge: 'D1', capability: 'accessAdministration' },
  { href: '/access', label: 'Мой доступ', icon: ShieldCheck, badge: 'D1', capability: 'accessOverview' },
] as const;

function isActivePath(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
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
}: {
  children: React.ReactNode;
  capabilities: {
    clinician: boolean;
    patientDirectory: boolean;
    orders: boolean;
    scheduling: boolean;
    chronicCare: boolean;
    observations: boolean;
    communications: boolean;
    accessOverview: boolean;
    accessAdministration: boolean;
  };
  user: { displayName: string; email: string | null };
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const workspaceLink = (target: string) => workspaceNavigationUrl(target, pathname, searchParams.toString());
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const nextTheme = readTheme();
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    const timer = window.setTimeout(() => {
      setTheme(nextTheme);
      try {
        setCollapsed(
          window.localStorage.getItem('orion-navigation-collapsed') === 'true',
        );
      } catch {
        // A usable expanded navigation is the safe fallback.
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const permittedNavigation = navigation.filter(
    (item) => capabilities[item.capability],
  );
  const activeLabel =
    permittedNavigation.find((item) => isActivePath(pathname, item.href))?.label ??
    'Рабочее место';
  const initials = useMemo(
    () =>
      user.displayName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase() || 'В',
    [user.displayName],
  );

  function toggleNavigation() {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem('orion-navigation-collapsed', String(next));
      } catch {
        // The current session still updates even when persistence is blocked.
      }
      return next;
    });
  }

  function toggleTheme() {
    const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    persistTheme(nextTheme);
    setTheme(nextTheme);
  }

  return (
    <div className={`${styles.shell} ${collapsed ? styles.collapsed : ''}`}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href={workspaceLink('/')} aria-label="ORION Clinic — рабочий день">
          <span className={styles.brandMark} aria-hidden="true">O</span>
          <span className={styles.brandCopy}>
            <strong>ORION</strong>
            <small>Clinic</small>
          </span>
        </Link>

        <div className={styles.context} aria-label="Текущий раздел">
          <span className={styles.contextDot} aria-hidden="true" />
          <span>{activeLabel}</span>
          <small>Локальный защищённый контур</small>
        </div>

        <div className={styles.actions}>
          <button
            className={styles.iconButton}
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
            type="button"
          >
            {theme === 'dark' ? <Sun aria-hidden="true" size={18} /> : <Moon aria-hidden="true" size={18} />}
            <span className={styles.actionLabel}>{theme === 'dark' ? 'Светлая' : 'Тёмная'}</span>
          </button>

          <div className={styles.identity}>
            <span className={styles.avatar} aria-hidden="true">{initials}</span>
            <span className={styles.identityCopy}>
              <strong>{user.displayName}</strong>
              <small>{user.email ?? 'Sites identity'}</small>
            </span>
          </div>

          <a
            aria-label="Выйти из ORION Clinic"
            className={styles.signOut}
            href={chatGPTSignOutPath('/')}
            target="_top"
            title="Выйти из ORION Clinic"
          >
            <LogOut aria-hidden="true" size={18} />
            <span className={styles.actionLabel}>Выйти</span>
          </a>
        </div>
      </header>

      <aside className={styles.sidebar}>
        <nav aria-label="Основная навигация">
          {permittedNavigation.map((item) => {
            const Icon = item.icon;
            const active = isActivePath(pathname, item.href);
            return (
              <Link
                aria-current={active ? 'page' : undefined}
                className={`${styles.navItem} ${active ? styles.navActive : ''}`}
                href={workspaceLink(item.href)}
                key={item.href}
                aria-label={item.label}
                title={collapsed ? item.label : undefined}
              >
                <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
                <span>{item.label}</span>
                {'badge' in item ? <small>{item.badge}</small> : null}
              </Link>
            );
          })}
        </nav>

        <button
          aria-label={collapsed ? 'Развернуть навигацию' : 'Свернуть навигацию'}
          className={styles.collapseButton}
          onClick={toggleNavigation}
          type="button"
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" size={19} /> : <PanelLeftClose aria-hidden="true" size={19} />}
          <span>Свернуть</span>
        </button>
      </aside>

      <div className={styles.content}>{children}</div>
    </div>
  );
}
