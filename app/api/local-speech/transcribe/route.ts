import { env } from 'cloudflare:workers';
import { verifyClinicalToolAccess } from '@/lib/auth/clinical-tool-access';
import { D1AccessGovernanceRepository } from '@/lib/repositories/access-governance';

export const dynamic = 'force-dynamic';

const LOCAL_SPEECH_ORIGIN = 'http://127.0.0.1:3101';
const MAX_AUDIO_BYTES = 800_000;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const INDEX_PATTERN = /^(?:0|[1-9]\d{0,5})$/;

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

async function readBoundedAudio(request: Request) {
  if (!request.body) return null;
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_AUDIO_BYTES) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_AUDIO_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes < 44) return null;
  const audio = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return audio;
}

export async function POST(request: Request) {
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

  const sessionId = request.headers.get('x-orion-session-id');
  const utteranceIndex = request.headers.get('x-orion-utterance-index');
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) {
    return json({ error: 'Некорректный идентификатор сессии.' }, 400);
  }
  if (!utteranceIndex || !INDEX_PATTERN.test(utteranceIndex)) {
    return json({ error: 'Некорректный номер фрагмента.' }, 400);
  }
  if (request.headers.get('content-type')?.split(';', 1)[0] !== 'audio/wav') {
    return json({ error: 'Ожидается WAV-аудио.' }, 415);
  }

  const audio = await readBoundedAudio(request);
  if (!audio) {
    return json({ error: 'Аудиофрагмент пуст или превышает лимит.' }, 413);
  }

  const form = new FormData();
  const audioBuffer = audio.buffer.slice(
    audio.byteOffset,
    audio.byteOffset + audio.byteLength,
  ) as ArrayBuffer;
  form.append('audio', new Blob([audioBuffer], { type: 'audio/wav' }), 'utterance.wav');
  form.append('session_id', sessionId);
  form.append('utterance_index', utteranceIndex);

  try {
    const upstream = await fetch(`${LOCAL_SPEECH_ORIGIN}/v1/transcribe`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: form,
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(45_000),
      ]),
    });
    const payload = (await upstream.json().catch(() => null)) as unknown;

    if (!upstream.ok) {
      return json(
        { error: 'Локальный STT не смог распознать аудиофрагмент.' },
        upstream.status >= 400 && upstream.status < 600
          ? upstream.status
          : 502,
      );
    }

    return json(payload);
  } catch {
    return json(
      { error: 'Локальное распознавание не ответило вовремя.' },
      504,
    );
  }
}
