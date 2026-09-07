import { env } from 'cloudflare:workers';
import { verifyClinicalToolAccess } from '@/lib/auth/clinical-tool-access';
import { D1AccessGovernanceRepository } from '@/lib/repositories/access-governance';

export const dynamic = 'force-dynamic';

const LOCAL_SPEECH_ORIGIN = 'http://127.0.0.1:3101';
const MAX_REQUEST_BYTES = 2_048;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

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

async function authorize(request: Request) {
  if (!isSameOriginRequest(request)) {
    return {
      ok: false as const,
      status: 403 as const,
      code: 'cross_origin',
      assignments: undefined,
      message: 'Запрос из другого источника отклонён.',
    };
  }
  return verifyClinicalToolAccess(
    new D1AccessGovernanceRepository(env.DB),
    request,
  );
}

async function readSmallJson(request: Request) {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_REQUEST_BYTES) return null;

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) return null;
  if (!text) return {};

  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const authorizationError = await authorize(request);
  if (!authorizationError.ok) {
    return json(
      { error: authorizationError.message, code: authorizationError.code, assignments: authorizationError.assignments },
      authorizationError.status,
    );
  }

  const body = await readSmallJson(request);
  if (!body) return json({ error: 'Некорректный запрос сессии.' }, 400);
  if (
    body.doctorFirst !== undefined &&
    typeof body.doctorFirst !== 'boolean'
  ) {
    return json({ error: 'Поле doctorFirst должно быть логическим.' }, 400);
  }

  try {
    const upstream = await fetch(`${LOCAL_SPEECH_ORIGIN}/v1/sessions`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ doctorFirst: body.doctorFirst !== false }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await upstream.json().catch(() => null)) as unknown;

    if (!upstream.ok) {
      return json(
        { error: 'Локальный STT не смог создать речевую сессию.' },
        upstream.status >= 400 && upstream.status < 600
          ? upstream.status
          : 502,
      );
    }

    return json(payload);
  } catch {
    return json(
      { error: 'Нет соединения с локальным речевым сервисом.' },
      503,
    );
  }
}

export async function DELETE(request: Request) {
  const authorizationError = await authorize(request);
  if (!authorizationError.ok) {
    return json(
      { error: authorizationError.message, code: authorizationError.code, assignments: authorizationError.assignments },
      authorizationError.status,
    );
  }

  const body = await readSmallJson(request);
  const sessionId = body?.sessionId;
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    return json({ error: 'Некорректный идентификатор сессии.' }, 400);
  }

  try {
    const upstream = await fetch(
      `${LOCAL_SPEECH_ORIGIN}/v1/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: 'DELETE',
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!upstream.ok && upstream.status !== 404) {
      return json(
        { error: 'Локальный STT не смог завершить речевую сессию.' },
        upstream.status >= 400 && upstream.status < 600
          ? upstream.status
          : 502,
      );
    }

    return new Response(null, {
      status: 204,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return json(
      { error: 'Нет соединения с локальным речевым сервисом.' },
      503,
    );
  }
}
