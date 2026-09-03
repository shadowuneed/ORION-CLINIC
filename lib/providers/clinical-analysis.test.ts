import { describe, expect, it } from 'vitest';
import {
  ClinicalAnalysisValidationError,
  parseAndValidateClinicalAnalysis,
  type AnalysisTranscriptSegment,
} from './clinical-analysis';

const segments: AnalysisTranscriptSegment[] = [
  {
    id: 'segment-1',
    version: 1,
    role: 'patient',
    language: 'ru',
    text: 'Головная боль продолжается два дня и температура 38 градусов.',
  },
  {
    id: 'segment-2',
    version: 1,
    role: 'doctor',
    language: 'mixed',
    text: 'Есть ли аллергия на лекарства?',
  },
];

function validOutput() {
  return {
    summary: 'Черновик по подтверждённому врачом снимку расшифровки.',
    suggestions: [
      {
        category: 'clarification',
        riskLevel: 'informational',
        title: 'Уточнить аллергию',
        content: 'Есть ли известная аллергия или реакция на лекарства?',
        evidence: [
          { sourceId: 'segment-2', quote: 'Есть ли аллергия на лекарства?' },
        ],
      },
    ],
    sections: [
      {
        code: 'complaints',
        content: 'Головная боль в течение двух дней, температура 38 °C.',
        evidence: [
          {
            sourceId: 'segment-1',
            quote: 'Головная боль продолжается два дня',
          },
        ],
      },
    ],
  };
}

describe('clinical analysis validation', () => {
  it('accepts exact evidence from the current transcript snapshot', () => {
    expect(parseAndValidateClinicalAnalysis(validOutput(), segments)).toEqual(
      validOutput(),
    );
  });

  it('rejects invented evidence identifiers and quotes', () => {
    const output = validOutput();
    output.suggestions[0].evidence[0] = {
      sourceId: 'segment-404',
      quote: 'Есть ли аллергия на лекарства?',
    };
    expect(() => parseAndValidateClinicalAnalysis(output, segments)).toThrow(
      ClinicalAnalysisValidationError,
    );

    output.suggestions[0].evidence[0] = {
      sourceId: 'segment-2',
      quote: 'Придуманная цитата',
    };
    expect(() => parseAndValidateClinicalAnalysis(output, segments)).toThrow(
      ClinicalAnalysisValidationError,
    );
  });

  it('rejects dose-like or imperative medication instructions', () => {
    const output = validOutput();
    output.suggestions[0] = {
      category: 'medication',
      riskLevel: 'attention',
      title: 'Лекарство',
      content: 'Назначить препарат 500 мг дважды в день.',
      evidence: [
        { sourceId: 'segment-1', quote: 'температура 38 градусов' },
      ],
    };
    expect(() => parseAndValidateClinicalAnalysis(output, segments)).toThrow(
      ClinicalAnalysisValidationError,
    );
  });

  it('rejects duplicate section codes', () => {
    const output = validOutput();
    output.sections.push({ ...output.sections[0] });
    expect(() => parseAndValidateClinicalAnalysis(output, segments)).toThrow(
      ClinicalAnalysisValidationError,
    );
  });
});
