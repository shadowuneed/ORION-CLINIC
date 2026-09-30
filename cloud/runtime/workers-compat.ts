/**
 * Build-only compatibility for legacy Workers imports.
 *
 * This is not a D1/R2 adapter: no credentials, local files, network fallbacks or
 * fake database results are exposed. Only explicitly ported routes pass ingress.
 */
export class CloudRuntimeUnavailableError extends Error {
  readonly code = 'CLOUD_RUNTIME_NOT_READY';

  constructor() {
    super('The clinical cloud runtime has not been migrated.');
    this.name = 'CloudRuntimeUnavailableError';
  }
}

const unavailable = (): never => {
  throw new CloudRuntimeUnavailableError();
};

export const env: Readonly<Record<string, never>> = new Proxy(
  Object.freeze(Object.create(null) as Record<string, never>),
  {
    get: unavailable,
    set: unavailable,
    defineProperty: unavailable,
    deleteProperty: unavailable,
    has: unavailable,
    ownKeys: unavailable,
    getOwnPropertyDescriptor: unavailable,
  },
);

const responseHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};

/**
 * No environment switch or client identity can enable an unported route.
 * null forwards implemented routes to their independent verified-session/RPC
 * boundaries. This routing decision is not authentication or authorization.
 */
export function cloudIngressResponse(request: Request): Response | null {
  const pathname = new URL(request.url).pathname;
  const readable = request.method === 'GET' || request.method === 'HEAD';

  const buildAsset = /^\/_next\/static\/[a-zA-Z0-9_./-]+$/.test(pathname) &&
    !pathname.split('/').some((segment) => segment === '.' || segment === '..');
  if (readable && buildAsset) {
    return null;
  }

  const routeMethods = new Map<string, readonly string[]>([
    ['/sign-in', ['GET', 'HEAD']], ['/access', ['GET', 'HEAD']],
    ['/patients', ['GET', 'HEAD']], ['/favicon.svg', ['GET', 'HEAD']],
    ['/api/auth/cloud/csrf', ['GET']], ['/api/auth/cloud/session', ['GET']],
    ['/api/auth/cloud/login', ['POST']], ['/api/auth/cloud/logout', ['POST']],
    ['/api/auth/cloud/refresh', ['POST']], ['/api/patients', ['GET', 'POST']],
  ]);
  let allowed = routeMethods.get(pathname);
  if (/^\/patients\/[a-zA-Z0-9_-]{1,160}$/.test(pathname)) allowed = ['GET', 'HEAD'];
  if (/^\/api\/patients\/[a-zA-Z0-9_-]{1,160}$/.test(pathname)) allowed = ['GET', 'PATCH'];
  if (/^\/api\/patients\/[a-zA-Z0-9_-]{1,160}\/archive$/.test(pathname)) allowed = ['POST'];
  if (/^\/api\/patients\/[a-zA-Z0-9_-]{1,160}\/history$/.test(pathname)) allowed = ['GET'];
  if (allowed) {
    if (allowed.includes(request.method)) return null;
    return new Response(null, { status: 405, headers: { ...responseHeaders, Allow: allowed.join(', ') } });
  }

  if (readable && pathname === '/api/health/live') {
    return new Response(
      request.method === 'HEAD'
        ? null
        : JSON.stringify({ status: 'live', runtime: 'node', clinicalReady: false }),
      {
        status: 200,
        headers: { ...responseHeaders, 'Content-Type': 'application/json' },
      },
    );
  }

  const apiRequest = pathname.startsWith('/api/');
  return new Response(
    request.method === 'HEAD'
      ? null
      : apiRequest
        ? JSON.stringify({
            ok: false,
            error: {
              code: 'CLOUD_RUNTIME_NOT_READY',
              message: 'Cloud backend migration is not complete.',
            },
          })
        : 'ORION Clinic: облачная версия ещё настраивается. Клинические разделы временно недоступны.',
    {
      status: 503,
      headers: {
        ...responseHeaders,
        'Content-Type': apiRequest
          ? 'application/json'
          : 'text/plain; charset=utf-8',
        'Retry-After': '60',
      },
    },
  );
}
