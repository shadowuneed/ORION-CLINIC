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
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: '/:path*' };
