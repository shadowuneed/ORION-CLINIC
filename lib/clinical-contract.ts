export const CLINICAL_ANALYSIS_PROVIDER = 'groq' as const;
export const CLINICAL_ANALYSIS_MODEL = 'openai/gpt-oss-120b';

export type ClinicalSpeakerRole = 'doctor' | 'patient' | 'unknown';
export type ClinicalLanguage = 'ru' | 'kk' | 'mixed' | 'unknown';
export type ClinicalSuggestionCategory =
  | 'clarification'
  | 'safety'
  | 'option'
  | 'medication';
export type ClinicalSuggestionPriority = 'routine' | 'attention' | 'urgent';

export type ClinicalTranscriptSegment = {
  id: string;
  role: ClinicalSpeakerRole;
  language: ClinicalLanguage;
  text: string;
};

export type ClinicalAnalysisRequest = {
  segments: ClinicalTranscriptSegment[];
  mode: 'live' | 'final';
};

export type ClinicalSuggestion = {
  id: string;
  category: ClinicalSuggestionCategory;
  priority: ClinicalSuggestionPriority;
  title: string;
  rationale: string;
  clinicianPrompt: string;
  evidenceSegmentIds: string[];
};

export type ClinicalAnalysisResponse = {
  provider: typeof CLINICAL_ANALYSIS_PROVIDER;
  model: string;
  generatedAt: string;
  summary: string;
  suggestions: ClinicalSuggestion[];
};

export type ClinicalAnalysisError = {
  error: string;
  code: string;
  retryAfterSeconds?: number;
};
