'use client';

import type {
  ClinicalAnalysisError,
  ClinicalAnalysisRequest,
  ClinicalAnalysisResponse,
} from './clinical-contract';
import { CLINICAL_ANALYSIS_PROVIDER } from './clinical-contract';

const ANALYSIS_CLIENT_TIMEOUT_MS = 35_000;

export class ClinicalAnalysisRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly retryAfterSeconds: number | null,
  ) {
    super(message);
    this.name = 'ClinicalAnalysisRequestError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isClinicalAnalysisResponse(
  value: unknown,
): value is ClinicalAnalysisResponse {
  return (
    isRecord(value) &&
    value.provider === CLINICAL_ANALYSIS_PROVIDER &&
    typeof value.model === 'string' &&
    value.model.length > 0 &&
    typeof value.generatedAt === 'string' &&
    typeof value.summary === 'string' &&
    Array.isArray(value.suggestions) &&
    value.suggestions.every(
      (suggestion) =>
        isRecord(suggestion) &&
        typeof suggestion.id === 'string' &&
        typeof suggestion.category === 'string' &&
        typeof suggestion.priority === 'string' &&
        typeof suggestion.title === 'string' &&
        typeof suggestion.rationale === 'string' &&
        typeof suggestion.clinicianPrompt === 'string' &&
        Array.isArray(suggestion.evidenceSegmentIds) &&
        suggestion.evidenceSegmentIds.every((id) => typeof id === 'string'),
    )
  );
}

export async function requestClinicalAnalysis(
  request: ClinicalAnalysisRequest,
  signal: AbortSignal,
  scopedFetch: (input: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<ClinicalAnalysisResponse> {
  const timeoutSignal = AbortSignal.timeout(ANALYSIS_CLIENT_TIMEOUT_MS);
  let response: Response;
  let body: unknown;
  try {
    response = await scopedFetch('/api/clinical/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
      signal: AbortSignal.any([signal, timeoutSignal]),
    });
    body = await response.json().catch((error: unknown) => {
      if (signal.aborted || timeoutSignal.aborted) throw error;
      return null;
    });
  } catch (error) {
    if (timeoutSignal.aborted && !signal.aborted) {
      throw new Error(
        'Анализ не ответил за 35 секунд. Расшифровка сохранена — повторите запрос.',
      );
    }
    throw error;
  }

  if (!response.ok) {
    const errorBody = isRecord(body) ? (body as ClinicalAnalysisError) : null;
    throw new ClinicalAnalysisRequestError(
      errorBody && typeof errorBody.error === 'string'
        ? errorBody.error
        : 'Не удалось получить проверенные подсказки.',
      response.status,
      errorBody && typeof errorBody.code === 'string' ? errorBody.code : null,
      errorBody &&
        typeof errorBody.retryAfterSeconds === 'number' &&
        Number.isFinite(errorBody.retryAfterSeconds) &&
        errorBody.retryAfterSeconds >= 0
        ? errorBody.retryAfterSeconds
        : null,
    );
  }

  if (!isClinicalAnalysisResponse(body)) {
    throw new Error('Сервер вернул некорректный формат подсказок.');
  }

  return body;
}
