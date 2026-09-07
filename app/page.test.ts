import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('./authenticated-clinic-page', () => ({
  AuthenticatedClinicPage: () => null,
  getAuthenticatedClinicContext: vi.fn(async () => ({ user: {}, capabilities: {} })),
}));
vi.mock('./workspace-assignment-boundary', () => ({ WorkspaceAssignmentBoundary: () => null }));
vi.mock('./clinical-workspace', () => ({ ClinicalWorkspace: () => null }));
vi.mock('./clinic-dashboard', () => ({ ClinicDashboard: () => null }));
import Home from './page';
import { ClinicalWorkspace } from './clinical-workspace';
import { ClinicDashboard } from './clinic-dashboard';

const content = (page: ReactElement) => ((page.props as { children: ReactElement }).children.props as { children: ReactElement }).children;
describe('home and encounter routing', () => {
  it('shows the dashboard without automatically selecting a patient', async () => {
    expect(content(await Home({ searchParams: Promise.resolve({}) })).type).toBe(ClinicDashboard);
  });
  it('preserves explicit encounter links as the clinical workspace', async () => {
    expect(content(await Home({ searchParams: Promise.resolve({ encounterId: 'enc-a' }) })).type).toBe(ClinicalWorkspace);
  });
});
