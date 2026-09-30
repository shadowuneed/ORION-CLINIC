import { NextResponse, type NextRequest } from 'next/server';
import { cloudIngressResponse } from './cloud/runtime/workers-compat';

export function proxy(request: NextRequest) {
  const response = cloudIngressResponse(request);
  if (response) return response;

  // Legacy gateway identities never become authority in the Vercel runtime.
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name.startsWith('oai-') || name.startsWith('x-orion-')) {
      headers.delete(name);
    }
  }
  const forwarded = NextResponse.next({ request: { headers } });
  if (!new URL(request.url).pathname.startsWith('/_next/static/')) {
    forwarded.headers.set('Cache-Control', 'private, no-store, max-age=0');
    forwarded.headers.set('X-Content-Type-Options', 'nosniff');
    forwarded.headers.set('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
  }
  return forwarded;
}

export const config = { matcher: '/:path*' };
