import { z } from 'zod';

export const clinicalSectionCodes = [
  'complaints',
  'history_of_present_illness',
  'past_medical_history',
  'allergy_status',
  'objective_findings',
  'preliminary_diagnosis',
  'examination_plan',
  'treatment_plan',
] as const;

export const analysisPolicyVersion = 'orion-clinical-drafts-v1';

export type AnalysisTranscriptSegment = {
  id: string;
  version: number;
  role: 'doctor' | 'patient' | 'other' | 'unknown';
  language: 'ru' | 'kk' | 'mixed' | 'unknown';
  text: string;
};

const evidenceSchema = z
  .object({
    sourceId: z.string().min(1).max(100),
    quote: z.string().trim().min(1).max(600),
  })
  .strict();

const suggestionSchema = z
  .object({
    category: z.enum(['clarification', 'safety', 'action', 'medication']),
    riskLevel: z.enum(['informational', 'attention', 'urgent']),
    title: z.string().trim().min(1).max(180),
    content: z.string().trim().min(1).max(1_500),
    evidence: z.array(evidenceSchema).min(1).max(4),
  })
  .strict();

const sectionSchema = z
  .object({
    code: z.enum(clinicalSectionCodes),
    content: z.string().trim().min(1).max(4_000),
    evidence: z.array(evidenceSchema).min(1).max(8),
  })
  .strict();

export const clinicalAnalysisOutputSchema = z
  .object({
    summary: z.string().trim().min(1).max(1_200),
    suggestions: z.array(suggestionSchema).min(1).max(8),
    sections: z.array(sectionSchema).max(8),
  })
  .strict();

export type ClinicalAnalysisOutput = z.infer<typeof clinicalAnalysisOutputSchema>;

export class ClinicalAnalysisValidationError extends Error {
  constructor(message = 'Clinical analysis output is invalid') {
    super(message);
    this.name = 'ClinicalAnalysisValidationError';
  }
}

function assertEvidence(
  evidence: Array<{ sourceId: string; quote: string }>,
  segments: readonly AnalysisTranscriptSegment[],
) {
  const byId = new Map(segments.map((segment) => [segment.id, segment]));
  for (const item of evidence) {
    const segment = byId.get(item.sourceId);
    if (!segment || !segment.text.includes(item.quote)) {
      throw new ClinicalAnalysisValidationError(
        'Analysis evidence must quote an exact current transcript segment',
      );
    }
  }
}

function hasUnsafeMedicationInstruction(content: string) {
  return (
    /\d+(?:[.,]\d+)?\s*(?:мг|mg|мл|ml|таб(?:летк[аи])?)(?:\s|[.,;:]|$)/iu.test(
      content,
    ) ||
    /(?:^|[^\p{L}])(?:назначить|принимать|примите|вводить|дайте)(?:[^\p{L}]|$)/iu.test(
      content,
    )
  );
}

export function parseAndValidateClinicalAnalysis(
  value: unknown,
  segments: readonly AnalysisTranscriptSegment[],
): ClinicalAnalysisOutput {
  const parsed = clinicalAnalysisOutputSchema.safeParse(value);
  if (!parsed.success) {
    throw new ClinicalAnalysisValidationError();
  }

  const sectionCodes = new Set<string>();
  for (const section of parsed.data.sections) {
    if (sectionCodes.has(section.code)) {
      throw new ClinicalAnalysisValidationError('Clinical section codes must be unique');
    }
    sectionCodes.add(section.code);
    assertEvidence(section.evidence, segments);
  }

  let medicationCount = 0;
  for (const suggestion of parsed.data.suggestions) {
    assertEvidence(suggestion.evidence, segments);
    if (suggestion.category === 'clarification' && !suggestion.content.includes('?')) {
      throw new ClinicalAnalysisValidationError(
        'Clarification suggestions must be phrased as a question',
      );
    }
    if (suggestion.category === 'safety' && suggestion.riskLevel === 'informational') {
      throw new ClinicalAnalysisValidationError(
        'Safety suggestions cannot be informational',
      );
    }
    if (suggestion.category === 'medication') {
      medicationCount += 1;
      if (hasUnsafeMedicationInstruction(suggestion.content)) {
        throw new ClinicalAnalysisValidationError(
          'Medication drafts cannot contain a dose or prescribing instruction',
        );
      }
    }
  }
  if (medicationCount > 2) {
    throw new ClinicalAnalysisValidationError('Too many medication drafts');
  }

  return parsed.data;
}

export type ClinicalAnalysisProviderResult = {
  provider: string;
  model: string;
  modelVersion: string;
  policyVersion: string;
  output: ClinicalAnalysisOutput;
  raw: Record<string, unknown>;
  durationMs: number;
};

export interface ClinicalAnalysisProvider {
  analyze(input: {
    segments: readonly AnalysisTranscriptSegment[];
    signal?: AbortSignal;
  }): Promise<ClinicalAnalysisProviderResult>;
}
