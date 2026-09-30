import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceAccessProvider } from '@/lib/workspace-access-context';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { EncounterCreationForm } from './creation-form';

function renderForm(canManage: boolean, assignment = 'assignment-doctor-a', facility = 'facility-a') {
  const props = { selection: { accessAssignmentId: assignment, facilityId: facility, canManage } };
  return renderToStaticMarkup(createElement(WorkspaceAccessProvider,
    props as Parameters<typeof WorkspaceAccessProvider>[0], createElement(EncounterCreationForm)));
}

function links(html: string) {
  return Array.from(html.matchAll(/href="([^"]+)"/g), match => new URL(match[1].replaceAll('&amp;', '&'), 'https://clinic.example.test'));
}

describe('new encounter form navigation', () => {
  it.each([true, false])('preserves exact scope on both back links with canManage=%s', canManage => {
    const html = renderForm(canManage, 'assignment-other', 'facility-other');
    const destinations = links(html);
    expect(destinations.map(url => url.pathname)).toEqual(['/', '/patients']);
    for (const url of destinations) {
      expect(url.searchParams.getAll('accessAssignmentId')).toEqual(['assignment-other']);
      expect(url.searchParams.getAll('facilityId')).toEqual(['facility-other']);
      expect(Array.from(url.searchParams.keys()).sort()).toEqual(['accessAssignmentId', 'facilityId']);
      expect(url.searchParams.has('encounterId')).toBe(false);
      expect(url.searchParams.has('patientId')).toBe(false);
    }
  });

  it('keeps the creation form absent for read-only assignments', () => {
    const html = renderForm(false);
    expect(html).toContain('нет права создавать приёмы');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('type="submit"');
  });

  it('uses the synthetic-only runtime without a redundant per-form checkbox', () => {
    const html = renderForm(true);
    expect(html).toContain('<form');
    expect(html).toContain('Имя пациента');
    expect(html).not.toContain('name="synthetic"');
    expect(html).not.toContain('Использую только вымышленные тестовые данные');
  });
});
