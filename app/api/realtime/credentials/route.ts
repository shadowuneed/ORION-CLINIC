import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../../chatgpt-auth';

export const dynamic = 'force-dynamic';

const regionEndpoints = {
  us: {
    api: 'https://api.soniox.com',
    websocket: 'wss://stt-rt.soniox.com/transcribe-websocket',
  },
  eu: {
    api: 'https://api.eu.soniox.com',
    websocket: 'wss://stt-rt.eu.soniox.com/transcribe-websocket',
  },
  jp: {
    api: 'https://api.jp.soniox.com',
    websocket: 'wss://stt-rt.jp.soniox.com/transcribe-websocket',
  },
} as const;

type Region = keyof typeof regionEndpoints;

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
    },
  });
}

export async function POST() {
  const user = await getChatGPTUser();
  const isLocalPreview = process.env.NODE_ENV === 'development';

  if (!user && !isLocalPreview) {
    return json({ error: 'Требуется вход врача.' }, 401);
  }

  const longLivedKey = env.SONIOX_API_KEY;
  const region = env.SONIOX_REGION as Region | undefined;

  if (!longLivedKey || !region || !regionEndpoints[region]) {
    return json(
      {
        error:
          'Речевой контур ещё не настроен. Нужны серверные SONIOX_API_KEY и SONIOX_REGION.',
        code: 'speech_provider_not_configured',
      },
      503,
    );
  }

  const clientReferenceId = `orion_${crypto.randomUUID()}`;
  const endpoint = regionEndpoints[region];
  const upstream = await fetch(`${endpoint.api}/v1/auth/temporary-api-key`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${longLivedKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      usage_type: 'transcribe_websocket',
      expires_in_seconds: 60,
      single_use: true,
      max_session_duration_seconds: 7_200,
      client_reference_id: clientReferenceId,
    }),
  });

  const payload = (await upstream.json().catch(() => null)) as
    | { api_key?: string; expires_at?: string; error_type?: string }
    | null;

  if (!upstream.ok || !payload?.api_key || !payload.expires_at) {
    return json(
      {
        error: 'Soniox не выдал временный ключ. Проверьте проект, регион и лимиты.',
        code: payload?.error_type ?? 'temporary_key_failed',
      },
      upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
    );
  }

  return json({
    apiKey: payload.api_key,
    expiresAt: payload.expires_at,
    websocketUrl: endpoint.websocket,
    model: 'stt-rt-v5',
    region,
  });
}
