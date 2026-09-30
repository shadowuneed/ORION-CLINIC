/**
 * Build-only compatibility for legacy Workers imports.
 *
 * This is not a D1/R2 adapter: no credentials, local files, network fallbacks or
 * fake database results are exposed. Clinical ingress is closed in proxy.ts.
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
 * Hard-closed boundary. No environment switch or client-supplied identity can
 * enable unported clinical routes. null permits only build assets, not pages.
 */
export function cloudIngressResponse(request: Request): Response | null {
  const pathname = new URL(request.url).pathname;
  const readable = request.method === 'GET' || request.method === 'HEAD';

  const buildAsset = /^\/_next\/static\/[a-zA-Z0-9_./-]+$/.test(pathname) &&
    !pathname.split('/').some((segment) => segment === '.' || segment === '..');
  if (readable && buildAsset) {
    return null;
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
