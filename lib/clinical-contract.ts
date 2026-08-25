export const CLINICAL_ANALYSIS_MODEL = '@cf/qwen/qwen3.8-27b';

export type ClinicalSpeakerRole = 'doctor' | 'patient' | 'unknown';
export type ClinicalLanguage = 'ru' | 'kk' | 'mixed' | 'unknown';
export type ClinicalSuggestionCategory =
  | 'clarification'
  | 'safety'
  | 'option';
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
  provider: 'cloudflare-workers-ai';
  model: typeof CLINICAL_ANALYSIS_MODEL;
  generatedAt: string;
  summary: string;
  suggestions: ClinicalSuggestion[];
};

export type ClinicalAnalysisError = {
  error: string;
  code: string;
};
