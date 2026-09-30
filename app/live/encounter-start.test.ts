import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { WorkspaceAccessProvider } from '@/lib/workspace-access-context';
import { EncounterStart } from './encounter-start';

function renderStart(canManage = true, assignment = 'assignment-doctor-a', facility = 'facility-a') {
  const props = { selection: { accessAssignmentId: assignment, facilityId: facility, canManage } };
  return renderToStaticMarkup(createElement(WorkspaceAccessProvider,
    props as Parameters<typeof WorkspaceAccessProvider>[0], createElement(EncounterStart)));
}

function links(html: string) {
  return Array.from(html.matchAll(/href="([^"]+)"/g), match => new URL(match[1].replaceAll('&amp;', '&'), 'https://clinic.example.test'));
}

describe('compact live encounter start', () => {
  it('offers distinct existing-patient, new-patient and server-history paths without selecting an encounter', () => {
    const html = renderStart();
    expect(links(html).map(url => url.pathname)).toEqual(['/patients', '/encounters/new', '/']);
    expect(html).toContain('Найти пациента');
    expect(html).toContain('Создать пациента и приём');
    expect(html).toContain('Продолжить прежний приём');
    expect(html).not.toContain('encounterId=');
    expect(html).not.toContain('patientId=');
  });

  it('preserves the exact resolved assignment and facility on all three routes, including the registry', () => {
    for (const url of links(renderStart(true, 'assignment-other', 'facility-other'))) {
      expect(url.origin).toBe('https://clinic.example.test');
      expect(url.searchParams.getAll('accessAssignmentId')).toEqual(['assignment-other']);
      expect(url.searchParams.getAll('facilityId')).toEqual(['facility-other']);
      expect(Array.from(url.searchParams.keys()).sort()).toEqual(['accessAssignmentId', 'facilityId']);
    }
  });

  it('does not offer creation or recording from a read-only assignment', () => {
    const html = renderStart(false);
    expect(links(html).map(url => url.pathname)).toEqual(['/patients', '/']);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('нет права создавать приём');
    expect(html).toContain('Запись в этом назначении недоступна');
    expect(html).not.toContain('Начать новый приём');
  });

  it('defaults to read-only navigation when an assignment provider is absent', () => {
    const html = renderToStaticMarkup(createElement(EncounterStart));
    expect(links(html).map(url => url.pathname)).toEqual(['/patients', '/']);
    expect(html).not.toContain('/encounters/new');
  });

  it('explains consent and isolated new context without restoring legacy recordings or claiming active capture', () => {
    const html = renderStart();
    expect(html).toContain('Микрофон выключен');
    expect(html).toContain('Без них запись не начнётся');
    expect(html).toContain('не станут контекстом нового приёма');
    expect(html).toContain('Старые локальные записи здесь не открываются');
    expect(html).toContain('Пауза микрофона не завершает медицинский приём');
    expect(html).toContain('привязаны только к выбранному приёму');
    expect(html).not.toContain('orion-shell');
    expect(html).not.toContain('<audio');
  });

  it('uses its own shell-themed controls and semantic headings instead of legacy recorder button classes', () => {
    const html = renderStart();
    expect(html).toContain('<main class="live-start" aria-labelledby="live-start-title"');
    expect(html).toContain('id="live-start-title"');
    expect(html).toContain('aria-labelledby="live-start-patient-title"');
    expect(html).toContain('aria-labelledby="live-start-guidance-title"');
    expect(html).not.toContain('class="primary-action"');
    expect(html).not.toContain('class="secondary-action"');
  });
});
