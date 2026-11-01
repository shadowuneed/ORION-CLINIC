import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { postgresAuthorityRouteGuard } from '../scripts/postgres-authority-route-guard';
import type { LocalAccountAuthority } from '../scripts/local-account-store';
function request(url: string, authority: () => LocalAccountAuthority = () => 'postgresql') {
  const state = { statusCode: 200, body: '', setHeader: vi.fn(), end(value = '') { state.body = value; } };
  const next = vi.fn(); postgresAuthorityRouteGuard(authority)({ url } as IncomingMessage, state as unknown as ServerResponse, next);
  return { state, next };
}
describe('one-way local PostgreSQL legacy HTTP authority fence', () => {
  it.each(['/api/patients', '/api/patients/id/photo', '/api/workspace', '/api/workspace/protocols/sign', '/api/workspace/transcript/speech/session',
    '/api/access', '/api/access/admin/assignments', '/api/orders/a/result', '/api/scheduling/queue', '/api/local-speech/transcribe', '/api/clinical/analyze',
    '/api/v1/anything', '/api/dashboard/briefing', '/api/health/ready'])('blocks old read AND mutation route %s after cutover', path => {
    const f = request(path); expect(f.state.statusCode).toBe(409); expect(f.next).not.toHaveBeenCalled(); expect(f.state.body).toContain('LEGACY_API_DISABLED');
  });
  it.each(['/api/clinical/v1/snapshot', '/api/clinical/v1/speech/session', '/api/clinical/v1/analysis', '/api/crm/v1/commands', '/api/directory/v1/snapshot?clinicId=clinic',
    '/api/local-account/session', '/api/health/live', '/login', '/logout', '/account/password', '/clinical', '/clinical.rsc?_rsc=abc', '/patients/patient-1.rsc', '/.rsc', '/assets/app.js', '/@fs/C:/Some%20Project/app.js', '/@vite/client'])('preserves canonical PG, login and asset route %s', path => {
    const f = request(path); expect(f.next).toHaveBeenCalledOnce(); expect(f.state.body).toBe('');
  });
  it.each(['/api/%70atients', '/%61pi/patients', '/foo/../api/patients', '/api/clinical/%76%31/snapshot', '/api/clinical/v1/../../patients', '/api\\patients', '//api/patients', '/API/patients', '/api/%252570atients'])('rejects alias or encoded route spellings %s', path => {
    const f = request(path); expect(f.state.statusCode).toBe(409); expect(f.next).not.toHaveBeenCalled();
  });
  it('only uses explicit legacy mode, never an unreadable marker fallback', () => {
    const legacy = request('/api/patients', () => 'legacy_d1'); expect(legacy.next).toHaveBeenCalledOnce();
    const broken = request('/api/patients', () => { throw new Error('private filesystem detail'); });
    expect(broken.state.statusCode).toBe(503); expect(broken.state.body).not.toContain('private filesystem detail'); expect(broken.next).not.toHaveBeenCalled();
  });
  it('reads the current authority for every API request', () => {
    let source: LocalAccountAuthority = 'legacy_d1'; const mode = vi.fn(() => source);
    expect(request('/api/patients', mode).next).toHaveBeenCalledOnce(); source = 'postgresql'; expect(request('/api/patients', mode).next).not.toHaveBeenCalled();
    expect(mode).toHaveBeenCalledTimes(2);
  });
  it.each(['/orders', '/orders.rsc', '/care', '/communications', '/observations', '/encounters/new', '/patients/id/edit', '/_next/data/build/orders.json', '/__vinext/prerender/static-params'])('fences legacy SSR/data loader %s', path => {
    const f = request(path); expect(f.state.statusCode).toBe(303); expect(f.next).not.toHaveBeenCalled(); expect(f.state.setHeader).toHaveBeenCalledWith('Location', '/clinical');
  });
  it.each(['/access/manage', '/access/admin/assignments.rsc'])('routes old access administration %s to the PG team UI', path => {
    const f = request(path); expect(f.state.statusCode).toBe(303); expect(f.state.setHeader).toHaveBeenCalledWith('Location', '/clinical/team');
  });
});
