import { env } from 'cloudflare:workers';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { assertStorageReady } from '@/lib/health/readiness';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
} from '@/lib/http/api-response';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const context = createApiRequestContext(request, '/api/health/ready');

  try {
    parseRuntimeConfig(env);
    if (!env.DB || !env.FILES) {
      throw new Error('Required storage binding is unavailable');
    }

    await assertStorageReady(env.DB, env.FILES);

    return apiSuccess(context, {
      status: 'ready',
      checkedAt: new Date().toISOString(),
    });
  } catch {
    return apiFailure(
      context,
      503,
      'SERVICE_NOT_READY',
      'Сервис пока не готов принимать запросы.',
    );
  }
}
