import type { ClinicalLanguage, ClinicalSpeakerRole } from './clinical-contract';

export const CLINICAL_RESEARCH_PROVIDER = 'groq-compound' as const;
export const CLINICAL_RESEARCH_MODEL = 'groq/compound-mini';

export type ClinicalResearchEvidence = {
  id: string;
  role: ClinicalSpeakerRole;
  language: ClinicalLanguage;
  text: string;
};

export type ClinicalResearchRequest = {
  suggestion: {
    title: string;
    rationale: string;
    clinicianPrompt: string;
  };
  evidence: ClinicalResearchEvidence[];
};

export type ClinicalResearchSource = {
  title: string;
  url: string;
};

export type ClinicalResearchResponse = {
  provider: typeof CLINICAL_RESEARCH_PROVIDER;
  model: string;
  generatedAt: string;
  answer: string;
  sources: ClinicalResearchSource[];
};
