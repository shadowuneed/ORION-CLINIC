import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AccessAssignmentSummary } from '@/lib/auth/access-governance';
import { AccessWorkspace, AccessWorkspaceState } from './access-workspace';

function assignment(): AccessAssignmentSummary {
  return {
    assignmentId: 'hidden-assignment-id',
    assignmentVersionId: 'hidden-version-id',
    assignmentVersion: 3,
    status: 'active',
    source: 'administrator',
    effectiveFrom: Date.UTC(2026, 8, 1, 7, 0),
    effectiveUntil: null,
    organization: { id: 'hidden-org', name: 'ORION Clinic', status: 'active' },
    facility: { id: 'hidden-facility', name: 'Главный филиал', status: 'active' },
    department: {
      id: 'hidden-department',
      code: 'GENERAL',
      name: 'Общая практика',
      kind: 'clinical',
      status: 'active',
    },
    membership: {
      id: 'hidden-membership',
      legacyRole: 'clinician',
      status: 'active',
    },
    user: {
      id: 'hidden-user',
      displayName: 'Не выводить имя',
      status: 'active',
    },
    roles: ['doctor'],
    allowPermissions: [],
    denyPermissions: [],
    effectivePermissions: [
      'clinic.dashboard.read',
      'patient.directory.read',
      'encounter.read',
      'access.self.read',
    ],
  };
}

describe('self-access workspace', () => {
  it('renders one server-selected D1 scope without employee identifiers or mutation controls', () => {
    const selected = assignment();
    const html = renderToStaticMarkup(
      createElement(AccessWorkspace, {
        assignments: [selected],
        selected,
      }),
    );

    expect(html).toContain('Мой доступ');
    expect(html).toContain('ORION Clinic');
    expect(html).toContain('Главный филиал');
    expect(html).toContain('Общая практика');
    expect(html).toContain('Врач');
    expect(html).toContain('Разрешено');
    expect(html).toContain('Не разрешено');
    expect(html).toContain('D1 · текущая версия');
    expect(html).not.toContain('hidden-membership');
    expect(html).not.toContain('hidden-user');
    expect(html).not.toContain('Не выводить имя');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
  });

  it('offers an explicit choice rather than merging two scopes', () => {
    const first = assignment();
    const second = {
      ...assignment(),
      assignmentId: 'assignment-b',
      department: {
        ...assignment().department,
        id: 'department-b',
        code: 'DIAGNOSTICS',
        name: 'Диагностика',
      },
    };
    const html = renderToStaticMarkup(
      createElement(AccessWorkspace, {
        assignments: [first, second],
        selected: null,
      }),
    );

    expect(html).toContain('Выберите рабочий контур');
    expect(html).toContain('Общая практика');
    expect(html).toContain('Диагностика');
    expect(html).not.toContain('Разрешения этого контура');
  });

  it('has a fail-closed operational state', () => {
    const html = renderToStaticMarkup(
      createElement(AccessWorkspaceState, {
        title: 'Проверка доступа недоступна',
        text: 'Полномочия не выданы.',
      }),
    );
    expect(html).toContain('Доступ закрыт безопасно');
    expect(html).toContain('Полномочия не выданы.');
  });
});
