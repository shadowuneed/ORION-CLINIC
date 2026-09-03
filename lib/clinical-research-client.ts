'use client';

import {
  CLINICAL_RESEARCH_PROVIDER,
  type ClinicalResearchRequest,
  type ClinicalResearchResponse,
} from './clinical-research-contract';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isResearchResponse(value: unknown): value is ClinicalResearchResponse {
  return (
    isRecord(value) &&
    value.provider === CLINICAL_RESEARCH_PROVIDER &&
    typeof value.model === 'string' &&
    typeof value.generatedAt === 'string' &&
    typeof value.answer === 'string' &&
    Array.isArray(value.sources) &&
    value.sources.every(
      (source) =>
        isRecord(source) &&
        typeof source.title === 'string' &&
        typeof source.url === 'string',
    )
  );
}

export async function requestClinicalResearch(
  request: ClinicalResearchRequest,
  signal: AbortSignal,
) {
  const response = await fetch('/api/clinical/research', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    cache: 'no-store',
    signal,
  });
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.error === 'string'
        ? body.error
        : 'Не удалось проверить подсказку по источникам.';
    throw new Error(message);
  }
  if (!isResearchResponse(body)) {
    throw new Error('Compound вернул некорректный формат проверки.');
  }
  return body;
}
