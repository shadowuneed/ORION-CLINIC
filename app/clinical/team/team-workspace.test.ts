import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClinicalTeam } from './team-workspace';
import { directoryFixture } from './test-fixtures';

describe('employee directory UI', () => {
  it('pins its compiled module styles before the client workspace without a loading gate', () => {
    const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^['"]use client['"]/);
    expect(source).toContain("import css from './team.module.css?inline'");
    expect(source).toContain('returnTo="/clinical/team"');
    expect(source.indexOf('<FirstPaintStyles')).toBeLessThan(source.indexOf('<ClinicalTeam />'));
  });
  it('shows an authorization/loading state, not sample staff, before PG responds', () => {
    const html = renderToStaticMarkup(createElement(ClinicalTeam));
    expect(html).toContain('Проверяем доступ администратора');
    expect(html).not.toContain('Добавить сотрудника'); expect(html).not.toContain('Врач для проверки');
  });
  it('renders exact returned employees, current rights and explicit changes', () => {
    const html = renderToStaticMarkup(createElement(ClinicalTeam, { initialSnapshot: directoryFixture() }));
    expect(html).toContain('Команда и доступ'); expect(html).toContain('Врач для проверки'); expect(html).toContain('Регистратор для проверки');
    expect(html).toContain('Изменить назначение'); expect(html).toContain('Отозвать назначение'); expect(html).toContain('Отключить от клиники');
    expect(html).toContain('Явно запрещено:'); expect(html).toContain('Изменение карточки пациента');
    expect(html).not.toContain('type="password"'); expect(html).not.toContain('checked=""');
    expect(html).toContain('Локальный пароль настраивается отдельно.');
  });
  it('does not offer changes for disabled memberships', () => {
    const data = directoryFixture(); data.memberships.forEach(item => { item.status = 'disabled'; });
    const html = renderToStaticMarkup(createElement(ClinicalTeam, { initialSnapshot: data }));
    expect(html).toContain('Участие отключено'); expect(html).not.toContain('Изменить назначение');
    expect(html).not.toContain('Отозвать назначение'); expect(html).not.toContain('Отключить от клиники');
  });
  it('distinguishes a confirmed empty response from access denial', () => {
    const data = directoryFixture(); data.accounts = []; data.memberships = []; data.assignments = [];
    const html = renderToStaticMarkup(createElement(ClinicalTeam, { initialSnapshot: data }));
    expect(html).toContain('В подтверждённом справочнике пока нет сотрудников.');
    expect(html).not.toContain('Управление доступом закрыто');
  });
  it('does not imply that noninteractive imported membership can log in', () => {
    const data = directoryFixture(); data.memberships[0].interactive = false;
    const html = renderToStaticMarkup(createElement(ClinicalTeam, { initialSnapshot: data }));
    expect(html).toContain('Интерактивный вход закрыт');
    expect(html).toContain('Изменение ролей само по себе не включает вход.');
  });
});
