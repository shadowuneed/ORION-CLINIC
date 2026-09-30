import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const location = vi.hoisted(() => ({ pathname: '/', query: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => location.pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(location.query),
}));
vi.mock('next/link', () => ({ default: 'a' }));
import { ClinicShell } from './clinic-shell';

function render(clinician = true, full = false) {
  const props = {
    children: 'Рабочая область', user: { displayName: 'Тест', email: null },
    capabilities: { clinician, patientDirectory: true, orders: true,
      scheduling: true, chronicCare: true, observations: true,
      communications: true, pathway: true, accessOverview: true, accessAdministration: false },
  };
  const html = renderToStaticMarkup(createElement(ClinicShell, props));
  if (full) return html;
  return html.match(/<header[^>]*>[\s\S]*?<\/header>/)?.[0] ?? '';
}

describe('shared workspace shell', () => {
  it('shows encounter context without a distracting dashboard breadcrumb', () => {
    location.pathname = '/';
    location.query = 'encounterId=enc-a&accessAssignmentId=assignment-a&facilityId=fac-a';
    const nav = render();
    expect(nav).toContain('href="/?accessAssignmentId=assignment-a&amp;facilityId=fac-a"');
    expect(nav).not.toContain('encounterId=');
    expect(nav).not.toContain('Рабочий день');
    expect(nav).not.toContain('contextDot');
    expect(nav).not.toContain('Сменить рабочий доступ');
    expect(render(true, true)).toContain('Открыть профиль: Тест');
  });
  it('does not offer clinician dashboard to a non-clinician', () => {
    location.pathname = '/patients'; location.query = '';
    const nav = render(false);
    expect(nav).not.toContain('Рабочий день');
    expect(render(false, true)).toContain('href="/access" aria-label="ORION Clinic — моя роль и права"');
  });
  it('does not add a redundant dashboard link on dashboard', () => {
    location.pathname = '/'; location.query = '';
    const nav = render();
    expect(nav).not.toContain('Рабочий день');
    expect(nav).not.toContain('aria-label="Текущий раздел"');
  });
  it('shows compact destinations with one patient pathway instead of separate clinical links', () => {
    location.pathname = '/'; location.query = '';
    const html = render(true, true);
    expect(html).toContain('aria-label="Основная навигация"');
    expect(html).toContain('>Обзор</span>');
    expect(html).toContain('>Пациенты</span>');
    expect(html).toContain('>Приём и запись</span>');
    expect(html).toContain('>Расписание и очередь</span>');
    expect(html).toContain('>Маршрут пациента</span>');
    expect(html).not.toContain('>Направления и анализы</span>');
    expect(html).not.toContain('>План наблюдения</span>');
    expect(html).not.toContain('href="/access" aria-label="Моя роль и права"');
    expect(html).toContain('aria-label="Маршрут пациента" title="Маршрут пациента"');
    expect(html).not.toContain('Свернуть');
  });
  it('marks the patient pathway as a distinct working area', () => {
    location.pathname = '/pathway'; location.query = '';
    const html = render(true, true);
    expect(html).toContain('data-pathway-page="true"');
    expect(html).toContain('aria-current="page"');
  });
});
