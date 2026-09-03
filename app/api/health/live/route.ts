import { env } from 'cloudflare:workers';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import {
  apiSuccess,
  createApiRequestContext,
} from '@/lib/http/api-response';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const context = createApiRequestContext(request, '/api/health/live');

  try {
    const config = parseRuntimeConfig(env);
    return apiSuccess(context, {
      status: 'live',
      build: config.buildId,
      environment: config.environment,
      dataMode: 'synthetic-only',
      checkedAt: new Date().toISOString(),
    });
  } catch {
    return apiSuccess(context, {
      status: 'live',
      build: 'unknown',
      configuration: 'invalid',
      checkedAt: new Date().toISOString(),
    });
  }
}
