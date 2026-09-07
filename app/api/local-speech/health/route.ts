import { env } from 'cloudflare:workers';
import { verifyClinicalToolAccess } from '@/lib/auth/clinical-tool-access';
import { D1AccessGovernanceRepository } from '@/lib/repositories/access-governance';

export const dynamic = 'force-dynamic';

const LOCAL_SPEECH_ORIGIN = 'http://127.0.0.1:3101';
const UPSTREAM_TIMEOUT_MS = 5_000;

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function isSameOriginRequest(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  if (!isSameOriginRequest(request)) {
    return json({ error: 'Запрос из другого источника отклонён.' }, 403);
  }

  const access = await verifyClinicalToolAccess(
    new D1AccessGovernanceRepository(env.DB),
    request,
  );
  if (!access.ok) {
    return json({ error: access.message, code: access.code, assignments: access.assignments }, access.status);
  }

  try {
    const upstream = await fetch(`${LOCAL_SPEECH_ORIGIN}/health`, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const payload = (await upstream.json().catch(() => null)) as unknown;

    if (!upstream.ok) {
      return json(
        { error: 'Локальный речевой сервис пока не готов.' },
        upstream.status >= 400 && upstream.status < 600
          ? upstream.status
          : 503,
      );
    }

    return json(payload ?? { ready: true });
  } catch {
    return json(
      {
        error:
          'Локальный речевой сервис не запущен на 127.0.0.1:3101.',
        code: 'local_speech_unavailable',
      },
      503,
    );
  }
}
