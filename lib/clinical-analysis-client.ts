'use client';

import type {
  ClinicalAnalysisError,
  ClinicalAnalysisRequest,
  ClinicalAnalysisResponse,
} from './clinical-contract';
import { CLINICAL_ANALYSIS_MODEL } from './clinical-contract';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isClinicalAnalysisResponse(
  value: unknown,
): value is ClinicalAnalysisResponse {
  return (
    isRecord(value) &&
    value.provider === 'cloudflare-workers-ai' &&
    value.model === CLINICAL_ANALYSIS_MODEL &&
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
): Promise<ClinicalAnalysisResponse> {
  const response = await fetch('/api/clinical/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    cache: 'no-store',
    signal,
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const errorBody = isRecord(body) ? (body as ClinicalAnalysisError) : null;
    throw new Error(
      errorBody && typeof errorBody.error === 'string'
        ? errorBody.error
        : 'Не удалось получить проверенные подсказки.',
    );
  }

  if (!isClinicalAnalysisResponse(body)) {
    throw new Error('Сервер вернул некорректный формат подсказок.');
  }

  return body;
}
