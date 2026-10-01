import { describe, expect, it } from 'vitest';
import { scopedWorkspaceUrl, workspacePageUrl, workspaceNavigationUrl } from './workspace-access-url';
import { workspaceRequestSelection, InvalidWorkspaceAccessSelectionError } from './auth/workspace-request-access';

const selection = { accessAssignmentId: 'assignment-a', facilityId: 'fac-a' };
describe('exact workspace scope transport', () => {
  it('opens the patient history under the exact selected access, not an implicit role', () => {
    expect(scopedWorkspaceUrl('/patients/patient-a?facilityId=old', selection))
      .toBe('/patients/patient-a?facilityId=fac-a&accessAssignmentId=assignment-a');
  });
  it('carries the exact selected access and source identity into the order draft handoff', () => {
    const url = new URL(scopedWorkspaceUrl('/orders?encounterId=enc-a&recommendationId=hint-a&recommendationVersion=2&accessAssignmentId=old&facilityId=old', selection), 'https://orion.test');
    expect(Object.fromEntries(url.searchParams)).toEqual({ encounterId: 'enc-a', recommendationId: 'hint-a', recommendationVersion: '2', accessAssignmentId: 'assignment-a', facilityId: 'fac-a' });
  });
  it('opens the selected patient measurements under the exact selected access', () => {
    const url = new URL(scopedWorkspaceUrl('/observations?patientId=patient-a&facilityId=old&accessAssignmentId=old', selection), 'https://orion.test');
    expect(Object.fromEntries(url.searchParams)).toEqual({ patientId: 'patient-a', facilityId: 'fac-a', accessAssignmentId: 'assignment-a' });
  });
  it('retains encounter scope through shell navigation without passing unrelated selections', () => {
    const query = 'encounterId=enc-a&accessAssignmentId=a&facilityId=f&unrelated=value';
    expect(workspaceNavigationUrl('/live', '/', query)).toBe('/live?encounterId=enc-a&accessAssignmentId=a&facilityId=f');
    expect(workspaceNavigationUrl('/', '/live', query)).toBe('/?encounterId=enc-a&accessAssignmentId=a&facilityId=f');
    expect(workspaceNavigationUrl('/orders', '/live', query)).toBe('/orders?accessAssignmentId=a&facilityId=f');
    expect(workspaceNavigationUrl('/live', '/orders', query)).toBe('/live?accessAssignmentId=a&facilityId=f');
    expect(workspaceNavigationUrl('/', '/encounters/new', 'accessAssignmentId=a&facilityId=f')).toBe('/?accessAssignmentId=a&facilityId=f');
  });
  it.each(['/patients', '/patients/patient-a', '/orders', '/scheduling', '/care', '/observations', '/communications'])(
    'keeps exact access context from %s without carrying resource selections', (source) => {
      expect(workspaceNavigationUrl('/', source, 'encounterId=enc-a&patientId=p-a&accessAssignmentId=a&facilityId=f'))
        .toBe('/?accessAssignmentId=a&facilityId=f');
    },
  );
  it.each(['/access', '/access/manage', '/help', '/signed-out', 'https://external.test/', '//external.test/', '/api/workspace'])(
    'does not leak module selectors to %s', (target) => {
      expect(workspaceNavigationUrl(target, '/care', 'accessAssignmentId=a&facilityId=f')).toBe(target);
    },
  );
  it('retains invalid duplicates across modules so target validation can reject them', () => {
    expect(workspaceNavigationUrl('/orders', '/care', 'accessAssignmentId=a&accessAssignmentId=b&facilityId='))
      .toBe('/orders?accessAssignmentId=a&accessAssignmentId=b&facilityId=');
  });
  it('does not erase a malformed explicit selector in shell navigation', () => {
    expect(workspaceNavigationUrl('/live', '/', 'accessAssignmentId=a&accessAssignmentId=b')).toBe('/live?accessAssignmentId=a&accessAssignmentId=b');
  });
  it.each(['/', '/live', '/encounters/new', '/api/workspace', '/api/workspace/exports/download?encounterId=enc-a&kind=pdf',
    '/api/workspace/transcript/speech/session', '/api/clinical/research', '/api/local-speech/transcribe', '/api/dashboard/briefing'])(
    'propagates selection without dropping resource parameters: %s', (path) => {
      const url = new URL(scopedWorkspaceUrl(path, selection), 'https://orion.test');
      expect(url.searchParams.get('accessAssignmentId')).toBe('assignment-a');
      expect(url.searchParams.get('facilityId')).toBe('fac-a');
      if (path.includes('exports')) {
        expect(url.searchParams.get('encounterId')).toBe('enc-a');
        expect(url.searchParams.get('kind')).toBe('pdf');
      }
    },
  );
  it.each(['https://provider.test/api/workspace', '//provider.test/api/workspace', '/patients', '/signin-with-chatgpt', '/api/workspace-foreign', '/orders-foreign', '/observations-foreign', 'https://provider.test/observations', 'https://provider.test/orders', '/api/dashboard/briefing-foreign', '/api/dashboard/briefing/foreign'])(
    'never propagates context to unrelated destinations: %s', (path) => {
      expect(scopedWorkspaceUrl(path, selection)).toBe(path);
    },
  );
  it('keeps the requested context in sign-in return paths and does not hide duplicate selectors', () => {
    expect(workspacePageUrl('/live', { encounterId: 'enc-a', ...selection })).toBe('/live?encounterId=enc-a&accessAssignmentId=assignment-a&facilityId=fac-a');
    const invalid = workspacePageUrl('/', { accessAssignmentId: ['a', 'b'] });
    expect(() => workspaceRequestSelection(new Request(`https://orion.test${invalid}`))).toThrow(InvalidWorkspaceAccessSelectionError);
  });
  it('distinguishes read from mutations and supports matching explicit headers', () => {
    expect(workspaceRequestSelection(new Request('https://orion.test/api/workspace?accessAssignmentId=a', {
      headers: { 'x-orion-access-assignment-id': 'a', 'x-orion-facility-id': 'f' },
    }))).toEqual({ accessAssignmentId: 'a', facilityId: 'f', permission: 'encounter.read' });
    expect(workspaceRequestSelection(new Request('https://orion.test/api/workspace', { method: 'POST' })).permission).toBe('encounter.manage');
  });
  it.each(['?accessAssignmentId=', '?facilityId=%20', '?accessAssignmentId=a&accessAssignmentId=b', '?facilityId=a,b', '?accessAssignmentId=%00', '?encounterId=', '?encounterId=a&encounterId=b', '?encounterId=%20a'])(
    'rejects malformed selectors: %s', (query) => {
      expect(() => workspaceRequestSelection(new Request(`https://orion.test/${query}`))).toThrow(InvalidWorkspaceAccessSelectionError);
    },
  );
  it('rejects conflicting header and URL selection', () => {
    expect(() => workspaceRequestSelection(new Request('https://orion.test/?accessAssignmentId=a', {
      headers: { 'x-orion-access-assignment-id': 'b' },
    }))).toThrow(InvalidWorkspaceAccessSelectionError);
  });
});
