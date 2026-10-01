import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const control = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock('../authenticated-clinic-page', () => ({ getAuthenticatedClinicContext: control.context,
  AuthenticatedClinicPage: ({ children }: { children: ReactNode }) => createElement('div', {}, children) }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('./[patientId]/patient-detail', () => ({ PatientDetailView: (props: Record<string, unknown>) =>
  createElement('section', { 'data-props': JSON.stringify(props) }, 'Selected card') }));
import PatientPage from './[patientId]/page';
const render = async (query: { facilityId?: string | string[]; accessAssignmentId?: string | string[] }) =>
  renderToStaticMarkup(await PatientPage({ params: Promise.resolve({ patientId: 'patient-a' }), searchParams: Promise.resolve(query) }));
beforeEach(() => control.context.mockReset().mockResolvedValue({ capabilities: { observations: true } }));
describe('patient page exact selection and pending observation activation', () => {
  it('keeps only the requested card and does not advertise unapplied observation storage', async () => {
    const html = await render({ facilityId: 'fac-a', accessAssignmentId: 'assignment-a' });
    expect(html).toContain('Selected card');
    expect(html).toContain('&quot;vitalsAvailable&quot;:false');
    expect(html).toContain('&quot;encounterWorkspaceAvailable&quot;:false');
    expect(control.context).toHaveBeenCalledWith('/patients/patient-a?facilityId=fac-a&accessAssignmentId=assignment-a');
  });
  it.each([{ facilityId: ['a', 'b'] }, { accessAssignmentId: ['same'] }, { accessAssignmentId: '' }, { facilityId: 'a/b' }])(
    'never turns malformed explicit selection into implicit scope %j', async query => {
      const html = await render(query);
      expect(html).toContain('Параметры карточки не подтверждены');
      expect(html).not.toContain('Selected card');
    });
  it('retains duplicate selectors in return_to so sign-in cannot silently fix them', async () => {
    await render({ facilityId: ['fac-a', 'fac-b'], accessAssignmentId: 'assignment-a' });
    expect(control.context).toHaveBeenCalledWith('/patients/patient-a?facilityId=fac-a&facilityId=fac-b&accessAssignmentId=assignment-a');
  });
});
