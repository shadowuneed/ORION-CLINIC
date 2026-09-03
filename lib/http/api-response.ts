import {
  logApiCompletion,
  type ApiRequestLogContext,
} from '../observability/request-log';

export type ApiRequestContext = ApiRequestLogContext;

export type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
};

function responseHeaders(context: ApiRequestContext) {
  return {
    'Cache-Control': 'no-store',
    'X-Request-Id': context.requestId,
  };
}

export function createApiRequestContext(
  request: Request,
  route: string,
): ApiRequestContext {
  return {
    // Public callers must not be able to inject patient identifiers into logs.
    // A future trusted edge may pass an independently validated trace context.
    requestId: crypto.randomUUID(),
    route,
    method: request.method,
    startedAt: Date.now(),
  };
}

export function apiSuccess<T>(
  context: ApiRequestContext,
  payload: T,
  status = 200,
) {
  logApiCompletion(context, { status });
  return Response.json(payload, {
    status,
    headers: responseHeaders(context),
  });
}

export function apiBinarySuccess(
  context: ApiRequestContext,
  body: BodyInit,
  headers: HeadersInit,
  status = 200,
) {
  logApiCompletion(context, { status });
  return new Response(body, {
    status,
    headers: { ...responseHeaders(context), ...headers },
  });
}

export function apiFailure(
  context: ApiRequestContext,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  logApiCompletion(context, { status, errorCode: code });
  return Response.json(
    {
      error: {
        code,
        message,
        requestId: context.requestId,
        ...(details ? { details } : {}),
      },
    },
    { status, headers: responseHeaders(context) },
  );
}

export function hasSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return Boolean(origin && origin === new URL(request.url).origin);
}
