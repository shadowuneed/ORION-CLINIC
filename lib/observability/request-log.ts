export type ApiRequestLogContext = {
  requestId: string;
  route: string;
  method: string;
  startedAt: number;
};

type ApiCompletion = {
  status: number;
  errorCode?: string;
};

export function logApiCompletion(
  context: ApiRequestLogContext,
  completion: ApiCompletion,
) {
  const record = {
    timestamp: new Date().toISOString(),
    level: completion.status >= 500 ? 'error' : 'info',
    event: 'api.request.completed',
    requestId: context.requestId,
    route: context.route,
    method: context.method,
    status: completion.status,
    durationMs: Math.max(0, Date.now() - context.startedAt),
    ...(completion.errorCode ? { errorCode: completion.errorCode } : {}),
  };

  const serialized = JSON.stringify(record);
  if (completion.status >= 500) {
    console.error(serialized);
  } else {
    console.info(serialized);
  }
}
