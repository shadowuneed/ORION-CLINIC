import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../authenticated-clinic-page', () => ({
  AuthenticatedClinicPage: () => null,
  getAuthenticatedClinicContext: vi.fn(async (returnTo: string) => ({ returnTo })),
}));
vi.mock('./communications-workspace', () => ({ CommunicationsWorkspace: () => null }));

import CommunicationsPage from './page';

describe('communications route identity', () => {
  it('remounts the workspace when navigation clears or changes an assignment', async () => {
    const first = await CommunicationsPage({ searchParams: Promise.resolve({ facilityId: 'fac-a', accessAssignmentId: 'missing-assignment' }) });
    const cleared = await CommunicationsPage({ searchParams: Promise.resolve({}) });
    const selected = await CommunicationsPage({ searchParams: Promise.resolve({ facilityId: 'fac-a', accessAssignmentId: 'assignment-a' }) });
    const key = (page: ReactElement) => (page.props as { children: ReactElement }).children.key;
    expect(key(first)).toBe('/communications?facilityId=fac-a&accessAssignmentId=missing-assignment');
    expect(key(cleared)).toBe('/communications');
    expect(key(selected)).toBe('/communications?facilityId=fac-a&accessAssignmentId=assignment-a');
    expect(new Set([key(first), key(cleared), key(selected)]).size).toBe(3);
  });
});
