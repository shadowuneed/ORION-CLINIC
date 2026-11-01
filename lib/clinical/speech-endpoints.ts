/** An explicit storage destination prevents a PostgreSQL encounter falling back to D1. */
export type ClinicalSpeechApiBase = '/api/clinical/v1/speech';

export function localSpeechEndpoints(encounterId: string | null, apiBase?: ClinicalSpeechApiBase) {
  if (apiBase && (!encounterId || apiBase !== '/api/clinical/v1/speech')) {
    throw new Error('Для локальной записи нужен открытый приём PostgreSQL.');
  }
  const base = encounterId ? apiBase ?? '/api/workspace/transcript/speech' : '/api/local-speech';
  return {
    health: `${base}/health${encounterId ? `?encounterId=${encodeURIComponent(encounterId)}` : ''}`,
    session: `${base}/session`,
    transcribe: `${base}/transcribe`,
  };
}
