import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AccessAdministrationWorkspace, AssignmentDialog } from './access-administration-workspace';

describe('access administration workspace', () => {
  it.each(['clinician', 'nurse', 'registrar', 'administrator'] as const)(
    'does not preselect grant privileges from legacy role %s', (legacyRole) => {
      const html = renderToStaticMarkup(createElement(AssignmentDialog, {
        assignment: null, busy: false, error: null, mode: 'grant',
        initialEffectiveFrom: 1704067200000,
        memberships: [{ id: 'test-member', displayName: 'Test member', legacyRole, status: 'active' }],
        department: { id: 'test-department', code: 'test', name: 'Test department',
          kind: 'clinical', status: 'active', version: 1, versionId: 'v1', lockVersion: 1,
          changeReason: 'Test fixture', changedAt: 1704067200000 },
        onClose: () => {}, onSubmit: () => {},
      }));
      expect(html).not.toMatch(/<input[^>]*checked/);
      expect(html).toMatch(/<button[^>]*disabled[^>]*type="submit"/);
      expect(html).toContain('Выберите роли явно');
    },
  );
  it('renders operational department and assignment controls from D1 data', () => {
    const html = renderToStaticMarkup(
      createElement(AccessAdministrationWorkspace, {
        actorAssignmentId: 'assignment-admin',
        facility: { id: 'fac-a', name: 'Главный филиал' },
        organization: { id: 'org-a', name: 'ORION Clinic' },
        initialWorkspace: {
          scope: { organizationId: 'org-a', facilityId: 'fac-a' },
          departments: [
            {
              id: 'department-a',
              code: 'general_medicine',
              name: 'Общая медицина',
              kind: 'clinical',
              status: 'active',
              version: 2,
              versionId: 'department-a-v2',
              lockVersion: 2,
              changeReason: 'Уточнена структура',
              changedAt: Date.UTC(2026, 8, 6, 10, 0),
            },
          ],
          memberships: [
            {
              id: 'membership-a',
              displayName: 'А. Сейдахметова',
              legacyRole: 'clinician',
              status: 'active',
            },
          ],
          assignments: [
            {
              id: 'assignment-admin',
              departmentId: 'department-a',
              membershipId: 'membership-a',
              memberDisplayName: 'А. Сейдахметова',
              version: 3,
              versionId: 'assignment-admin-v3',
              lockVersion: 3,
              status: 'active',
              roles: ['doctor', 'administrator'],
              allowPermissions: [],
              denyPermissions: [],
              effectivePermissions: [
                'patient.directory.read',
                'access.manage',
              ],
              effectiveFrom: Date.UTC(2026, 8, 1),
              effectiveUntil: null,
              changeReason: 'Рабочий контур администратора',
              changedAt: Date.UTC(2026, 8, 1),
            },
          ],
        },
      }),
    );

    expect(html).toContain('Управление доступом');
    expect(html).toContain('Новое отделение');
    expect(html).toContain('Общая медицина');
    expect(html).toContain('Выдать доступ');
    expect(html).toContain('Текущий контур');
    expect(html).toContain('Каждая команда создаёт новую неизменяемую версию');
    expect(html).not.toContain('Отозвать</button>');
  });
});
