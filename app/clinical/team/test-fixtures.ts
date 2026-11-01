import type { DirectorySnapshot } from '@/lib/clinical/directory-contracts';
import { deriveEffectivePermissions } from '@/lib/domain/access-governance';

/** In-memory unit-test data only; never used as an application fallback or seed. */
export function directoryFixture(): DirectorySnapshot {
  return {
    schemaVersion: 1, clinic: { id: 'crm-clinic-local', name: 'Клиника проверки' },
    accounts: [{ id: 'account-1', name: 'Врач для проверки', status: 'active', version: 1 },
      { id: 'account-2', name: 'Регистратор для проверки', status: 'active', version: 1 }],
    memberships: [{ id: 'membership-1', userId: 'account-1', status: 'active', version: 2, interactive: true },
      { id: 'membership-2', userId: 'account-2', status: 'active', version: 1, interactive: true }],
    assignments: [{ id: 'assignment-1', membershipId: 'membership-1', roles: ['doctor'], allowPermissions: [],
      denyPermissions: ['patient.profile.write'], effectivePermissions: deriveEffectivePermissions(['doctor'], [], ['patient.profile.write']),
      status: 'active', version: 4, effectiveFrom: '2026-10-07T07:00:00.000Z', effectiveUntil: null, staffId: 'staff-1', specialty: 'Терапевт' }],
    staff: [{ id: 'staff-1', name: 'Врач для проверки', role: 'doctor' }, { id: 'staff-2', name: 'Медсестра для проверки', role: 'nurse' }],
    generatedAt: '2026-10-07T08:00:00.000Z',
  };
}
