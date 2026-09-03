import {
  apiSuccess,
  createApiRequestContext,
} from '@/lib/http/api-response';

export function GET(request: Request) {
  const context = createApiRequestContext(request, '/api/health');
  return apiSuccess(context, {
    service: 'orion-clinic',
    checks: {
      liveness: '/api/health/live',
      readiness: '/api/health/ready',
    },
  });
}
