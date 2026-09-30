import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  context: vi.fn().mockResolvedValue({ user: { displayName: 'Synthetic Doctor', userId: 'doctor-a' } }),
}));
vi.mock('../authenticated-clinic-page', () => ({
  getAuthenticatedClinicContext: mocks.context,
  AuthenticatedClinicPage: ({ children, requiredCapability }: { children: ReactNode; requiredCapability: string }) =>
    createElement('div', { 'data-required-capability': requiredCapability }, children),
}));
vi.mock('../workspace-assignment-boundary', () => ({
  WorkspaceAssignmentBoundary: ({ children, returnTo }: { children: ReactNode; returnTo: string }) =>
    createElement('div', { 'data-assignment-return-to': returnTo }, children),
}));
vi.mock('../orion-workspace', () => ({
  OrionWorkspace: ({ requestedEncounterId }: { requestedEncounterId: string }) =>
    createElement('div', { 'data-recorder-encounter': requestedEncounterId }),
}));
vi.mock('./encounter-start', () => ({
  EncounterStart: () => createElement('div', { 'data-encounter-start': true }),
}));

import LiveConsultationPage from './page';

beforeEach(() => vi.clearAllMocks());

describe('live route selection', () => {
  it('renders only the start page when no encounter is explicitly selected', async () => {
    const html = renderToStaticMarkup(await LiveConsultationPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('data-encounter-start="true"');
    expect(html).not.toContain('data-recorder-encounter');
    expect(html).toContain('data-required-capability="clinician"');
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith('/live');
  });

  it('does not resume a recorder for a blank encounter selector', async () => {
    const html = renderToStaticMarkup(await LiveConsultationPage({ searchParams: Promise.resolve({ encounterId: '  ' }) }));
    expect(html).toContain('data-encounter-start="true"');
    expect(html).not.toContain('data-recorder-encounter');
  });

  it('retains the explicit encounter and assignment boundary on the existing recorder route', async () => {
    const html = renderToStaticMarkup(await LiveConsultationPage({ searchParams: Promise.resolve({
      encounterId: 'encounter-a', accessAssignmentId: 'assignment-a', facilityId: 'facility-a',
    }) }));
    expect(html).toContain('data-recorder-encounter="encounter-a"');
    expect(html).not.toContain('data-encounter-start');
    expect(html).toContain('data-required-capability="clinician"');
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith('/live?encounterId=encounter-a&accessAssignmentId=assignment-a&facilityId=facility-a');
    expect(html).toContain('data-assignment-return-to="/live?encounterId=encounter-a&amp;accessAssignmentId=assignment-a&amp;facilityId=facility-a"');
  });

  it('preserves ambiguous selectors for server validation without choosing an encounter', async () => {
    const html = renderToStaticMarkup(await LiveConsultationPage({ searchParams: Promise.resolve({
      encounterId: ['encounter-a', 'encounter-b'], accessAssignmentId: ['assignment-a', 'assignment-b'],
    }) }));
    expect(html).not.toContain('data-recorder-encounter');
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith('/live?encounterId=encounter-a&encounterId=encounter-b&accessAssignmentId=assignment-a&accessAssignmentId=assignment-b');
  });
});
