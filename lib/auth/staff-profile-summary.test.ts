import { describe, expect, it } from 'vitest';
import type { AccessAssignmentSummary } from './access-governance';
import { staffProfileFromAssignments } from './staff-profile-summary';

const now = Date.UTC(2026, 8, 28);
function assignment(overrides: Partial<AccessAssignmentSummary> = {}): AccessAssignmentSummary {
  return {
    assignmentId: 'a', assignmentVersionId: 'v', assignmentVersion: 1,
    status: 'active', source: 'bootstrap', effectiveFrom: now - 1, effectiveUntil: null,
    organization: { id: 'o', name: 'ORION', status: 'active' },
    facility: { id: 'f', name: 'Клиника', status: 'active' },
    department: { id: 'd', code: 'general', name: 'Терапия', kind: 'clinical', status: 'active' },
    membership: { id: 'm', legacyRole: 'clinician', status: 'active' },
    user: { id: 'u', displayName: 'А. Сейдахметова', status: 'active' },
    roles: ['doctor', 'administrator'], allowPermissions: [], denyPermissions: [], effectivePermissions: [],
    ...overrides,
  };
}

describe('header staff profile summary', () => {
  it('shows the active assigned employee and distinct roles, not the technical provider name', () => {
    expect(staffProfileFromAssignments([assignment()], 'Seedy', now)).toEqual({
      staffName: 'А. Сейдахметова', roles: ['Врач', 'Администратор'], workplace: 'Терапия',
    });
  });
  it('never presents a revoked or expired assignment as current', () => {
    expect(staffProfileFromAssignments([assignment({ status: 'revoked' }), assignment({ effectiveUntil: now })], 'Seedy', now)).toEqual({
      staffName: 'Seedy', roles: [], workplace: null,
    });
  });
});
