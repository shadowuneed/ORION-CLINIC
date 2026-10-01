import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  cloudIngressResponse,
  CloudRuntimeUnavailableError,
  env,
} from './workers-compat';

const request = (pathname: string, method = 'GET', headers?: HeadersInit) =>
  new Request(`https://orion.example${pathname}`, { method, headers });

describe('cloud build boundary', () => {
  it.each(['DB', 'FILES', 'GROQ_API_KEY', 'DATABASE_URL', 'LOCAL_SPEECH_URL'])(
    'does not expose the legacy %s binding',
    (binding) => {
      expect(() => env[binding]).toThrow(CloudRuntimeUnavailableError);
    },
  );

  it('does not enumerate or modify runtime bindings', () => {
    expect(() => Object.keys(env)).toThrow(CloudRuntimeUnavailableError);
    expect(() => Reflect.set(env, 'DB', {})).toThrow(CloudRuntimeUnavailableError);
    expect(() => 'DB' in env).toThrow(CloudRuntimeUnavailableError);
  });

  it.each([
    '/sign-out', '/pathway?view=overview', '/scheduling', '/workspace',
    '/api/orders', '/api/access', '/api/health/ready', '/api/auth/local/login',
    '/api/auth/local/logout', '/api/dashboard/briefing', '/api/speech/transcribe',
    '/_next/data/build-id/patients.json',
  ])('rejects unported route %s', async (pathname) => {
    const response = cloudIngressResponse(request(pathname));
    expect(response?.status).toBe(503);
    expect(response?.headers.get('Cache-Control')).toContain('no-store');
  });

  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])(
    'cannot enable clinical access with forged identities via %s',
    (method) => {
      const response = cloudIngressResponse(request('/api/orders', method, {
        'oai-authenticated-user-id': 'staff-admin',
        'oai-authenticated-user-email': 'admin@example.com',
        'x-orion-local-generation': 'a'.repeat(32),
        'x-middleware-subrequest': 'proxy:proxy:proxy:proxy:proxy',
        Authorization: 'Bearer forged',
        Cookie: 'orion-local-session=forged',
      }));
      expect(response?.status).toBe(503);
    },
  );

  it.each([
    ['/sign-in', 'GET'], ['/access', 'HEAD'], ['/patients', 'GET'], ['/patients/patient-a', 'GET'],
    ['/dashboard', 'GET'], ['/dashboard', 'HEAD'],
    ['/api/auth/cloud/csrf', 'GET'], ['/api/auth/cloud/session', 'GET'], ['/api/auth/cloud/login', 'POST'],
    ['/api/auth/cloud/logout', 'POST'], ['/api/auth/cloud/refresh', 'POST'], ['/api/patients', 'GET'],
    ['/api/patients', 'POST'], ['/api/patients/patient-a', 'PATCH'], ['/api/patients/patient-a/archive', 'POST'],
    ['/api/patients/patient-a/history', 'GET'],
  ])('forwards only implemented %s %s to independent auth checks', (path, method) => {
    expect(cloudIngressResponse(request(path, method))).toBeNull();
  });

  it.each([['/api/auth/cloud/logout', 'GET'], ['/api/patients/patient-a', 'DELETE'], ['/access', 'POST'],
    ['/dashboard', 'POST'],
    ['/api/patients/patient-a/history', 'POST']])(
    'rejects unimplemented method %s %s', (path, method) => {
      expect(cloudIngressResponse(request(path, method))?.status).toBe(405);
    },
  );

  it('exposes liveness without claiming database or clinical readiness', async () => {
    const response = cloudIngressResponse(request('/api/health/live'));
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({
      status: 'live', runtime: 'node', clinicalReady: false,
    });
    const head = cloudIngressResponse(request('/api/health/live', 'HEAD'));
    expect(head?.status).toBe(200);
    expect(await head?.text()).toBe('');
  });

  it.each(['GET', 'HEAD'])('lands on the scoped cloud dashboard via %s without exposing the legacy dashboard', method => {
    const response = cloudIngressResponse(request('/', method));
    expect(response?.status).toBe(307);
    // Next's proxy adapter requires an absolute URL even for a same-origin redirect.
    expect(response?.headers.get('Location')).toBe('https://orion.example/dashboard');
    expect(cloudIngressResponse(request('/?next=https://other.example/'))?.headers.get('Location')).toBe('https://orion.example/dashboard');
    expect(response?.headers.get('Cache-Control')).toContain('no-store');
    expect(cloudIngressResponse(request('/', 'POST'))?.status).toBe(503);
  });

  it('preserves explicit landing selectors and duplicates for independent validation without forwarding encounter or return URLs', () => {
    const response = cloudIngressResponse(request('/?facilityId=fac-a&facilityId=fac-b&accessAssignmentId=assignment-a&accessAssignmentId=assignment-b&encounterId=private-encounter&next=https://other.example/'));
    const target = new URL(response!.headers.get('Location')!);
    expect(target.origin).toBe('https://orion.example');
    expect(target.pathname).toBe('/dashboard');
    expect(target.searchParams.getAll('accessAssignmentId')).toEqual(['assignment-a', 'assignment-b']);
    expect(target.searchParams.getAll('facilityId')).toEqual(['fac-a', 'fac-b']);
    expect([...target.searchParams.keys()].sort()).toEqual(['accessAssignmentId', 'accessAssignmentId', 'facilityId', 'facilityId']);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
    'does not allow writes through liveness via %s',
    (method) => {
      expect(cloudIngressResponse(request('/api/health/live', method))?.status).toBe(503);
    },
  );

  it('permits only static build assets, not arbitrary framework routes', () => {
    expect(cloudIngressResponse(request('/_next/static/chunks/app.js'))).toBeNull();
    expect(cloudIngressResponse(request('/_next/static/chunks/app.js', 'POST'))?.status).toBe(503);
    expect(cloudIngressResponse(request('/_next/static/%2f..%2fapi/patients'))?.status).toBe(503);
    expect(cloudIngressResponse(request('/_next/image?url=http://127.0.0.1/'))?.status).toBe(503);
    expect(cloudIngressResponse(request('/_next/static/../../api/orders'))?.status).toBe(503);
  });

  it.each([
    '/_next/static/chunks/app/patients/[patientId]/page-3e9e8888b9871cd9.js',
    '/_next/static/chunks/app/patients/%5BpatientId%5D/page-3e9e8888b9871cd9.js',
    '/_next/static/chunks/app/patients/%5bpatientId%5d/page.js',
    '/_next/static/chunks/app/example/%5B%5B...slug%5D%5D/page.js',
  ])('loads generated dynamic-route asset %s without opening write methods', path => {
    expect(cloudIngressResponse(request(path))).toBeNull();
    expect(cloudIngressResponse(request(path, 'HEAD'))).toBeNull();
    expect(cloudIngressResponse(request(path, 'POST'))?.status).toBe(503);
  });

  it.each([
    '/_next/static/%2Fapi%2Fpatients', '/_next/static/%5BpatientId%5D/%2e%2e%2fapi/patients',
    '/_next/static/%255BpatientId%255D/page.js', '/_next/static/%5BpatientId%5D/%5c..%5capi',
    '/_next/static/%5BpatientId%5D/%00page.js', '/_next/data/%5BpatientId%5D/page.json',
  ])('does not decode unsafe or non-static asset route %s', path => {
    expect(cloudIngressResponse(request(path))?.status).toBe(503);
  });

  it('cannot be unlocked by an environment-ready flag', () => {
    const previous = process.env.ORION_CLOUD_READY;
    process.env.ORION_CLOUD_READY = 'true';
    try {
      expect(cloudIngressResponse(request('/api/orders'))?.status).toBe(503);
    } finally {
      if (previous === undefined) delete process.env.ORION_CLOUD_READY;
      else process.env.ORION_CLOUD_READY = previous;
    }
  });

  it('uses native Next scripts without changing the retained local scripts', () => {
    const manifest = JSON.parse(readFileSync(
      fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8',
    ));
    expect(manifest.scripts.build).toBe('next build --webpack');
    expect(manifest.scripts.dev).toContain('--hostname 127.0.0.1 --port 3215');
    expect(manifest.scripts['dev:local']).toBe('vinext dev');
    expect(manifest.scripts['build:local']).toContain('vinext build');
    const source = readFileSync(
      fileURLToPath(new URL('../../next.config.ts', import.meta.url)), 'utf8',
    );
    expect(source).toContain("'cloudflare:workers'");
    expect(source).toContain('NormalModuleReplacementPlugin');
    expect(source).toContain('dataUrlCondition: () => true');
    expect(source).toContain("__ORION_LOCAL_CREDENTIALS__: 'false'");
    expect(source).not.toContain('ignoreBuildErrors');
  });
});
