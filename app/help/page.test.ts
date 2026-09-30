import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../authenticated-clinic-page', () => ({
  getAuthenticatedClinicContext: vi.fn(async () => ({ user: {}, capabilities: {} })),
  AuthenticatedClinicPage: ({ children }: { children: ReactNode }) => children,
}));
import HelpPage from './page';
import { getAuthenticatedClinicContext } from '../authenticated-clinic-page';

describe('integrated user handbook', () => {
  it('explains explicit accepted-recommendation transfer without claiming automatic dispatch', async () => {
    const html = renderToStaticMarkup(await HelpPage());
    expect(html).toContain('Из принятой подсказки в направление');
    expect(html).toContain('Создать черновик направления');
    expect(html).toContain('Сам переход ничего не создаёт');
    expect(html).toContain('Источник направления');
    expect(html).toContain('внешняя отправка не подключена');
  });

  it('requires the shared login and exposes an isolated accessible reader and download', async () => {
    const html = renderToStaticMarkup(await HelpPage());
    expect(getAuthenticatedClinicContext).toHaveBeenCalledWith('/help');
    expect(html).toContain('title="Иллюстрированная инструкция ORION Clinic"');
    expect(html).toContain('src="/user-guide.html"');
    expect(html).toContain('sandbox="allow-scripts allow-modals allow-downloads"');
    expect(html).not.toContain('allow-same-origin');
    expect(html).toContain('download="ORION-CLINIC-GUIDE.html"');
    expect(html).toContain('Из задачи наблюдения к измерениям');
    expect(html).toContain('Измерение не закрывает задачу автоматически');
  });

  it('ships the exact offline handbook without missing anchors or external image dependencies', () => {
    const html = readFileSync('public/user-guide.html', 'utf8');
    expect(html).toBe(readFileSync('docs/user-guide/ORION-CLINIC-GUIDE.html', 'utf8'));
    expect([...html.matchAll(/<article id=/g)]).toHaveLength(19);
    expect([...html.matchAll(/<circle /g)]).toHaveLength(75);
    expect(html).toContain('План наблюдения — будущие задачи');
    expect(html).toContain('Измерения пациента — зафиксированные факты');
    expect(html).toContain('Ведение протокола запрещено');
    expect(html).toContain('Управление доступом запрещено');
    expect(html).toContain('id="access-current"');
    expect(html).toContain('id="access-revoked-current"');
    expect(html).toContain('Из задачи наблюдения к измерениям');
    expect(html).toContain('Вернуться к задаче');
    expect(html).not.toMatch(/(?:src|href)="https?:\/\//);
    const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
    for (const match of html.matchAll(/href="#([^"]+)"/g)) expect(ids.has(match[1])).toBe(true);
  });

  it('shows current entry and Live instructions without claiming historical captures or staff passwords are current', async () => {
    const html = renderToStaticMarkup(await HelpPage());
    expect(html).toContain('Локальный вход и явный выход');
    expect(html).toContain('одну учётную запись разработки');
    expect(html).toContain('Отдельные логины и пароли сотрудников ещё не подключены');
    expect(html).toContain('Перейти ко входу');
    expect(html).toContain('Live: новый разговор или продолжение приёма');
    expect(html).toContain('Микрофон выключен');
    expect(html).toContain('не подставляет старый диалог');
    expect(html).toContain('Снимки прежних экранов входа и Live — исторические');
    expect(html).toContain('новые экраны ещё не пересняты');
  });
});
