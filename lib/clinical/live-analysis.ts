import { z } from 'zod';

export const LIVE_ANALYSIS_MIN_CHARACTERS = 80;
export const LIVE_ANALYSIS_INTERVAL_MS = 12_000;
export const LIVE_ANALYSIS_MAX_SEGMENTS = 24;
export const LIVE_ANALYSIS_MAX_CHARACTERS = 16_000;
const id = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/);
export const liveAnalysisRequestSchema = z.object({ encounterId: id }).strict();
export const liveAnalysisSourceSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/), lastSequence: z.number().int().nonnegative(),
  segmentIds: z.array(id).max(LIVE_ANALYSIS_MAX_SEGMENTS), analyzedSegments: z.number().int().min(0).max(LIVE_ANALYSIS_MAX_SEGMENTS),
  totalSegments: z.number().int().min(0).max(4000),
}).strict();
export const liveAnalysisSuggestionSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{32}$/), category: z.enum(['clarification', 'safety', 'action', 'medication']),
  riskLevel: z.enum(['informational', 'attention', 'urgent']), title: z.string().min(1).max(180), content: z.string().min(1).max(1500),
  evidence: z.array(z.object({ sourceId: id, sequence: z.number().int().positive(), quote: z.string().min(1).max(600) }).strict()).min(1).max(4),
}).strict();
const base = { schemaVersion: z.literal(1), encounterId: id, source: liveAnalysisSourceSchema,
  generatedAt: z.string().datetime({ precision: 3 }), retryAfterMs: z.number().int().min(0).max(3_600_000), reviewRequired: z.literal(true) };
export const liveAnalysisReadySchema = z.object({ ...base, status: z.literal('ready'), summary: z.string().min(1).max(1200),
  suggestions: z.array(liveAnalysisSuggestionSchema).min(1).max(8), cached: z.boolean() }).strict();
export const liveAnalysisResponseSchema = z.discriminatedUnion('status', [liveAnalysisReadySchema,
  z.object({ ...base, status: z.literal('waiting'), reason: z.enum(['more_text', 'cooldown', 'busy']), summary: z.null(), suggestions: z.array(z.never()).length(0), cached: z.literal(false) }).strict(),
]);
export type LiveAnalysisResponse = z.infer<typeof liveAnalysisResponseSchema>;
export type LiveAnalysisReady = z.infer<typeof liveAnalysisReadySchema>;
export type LiveAnalysisSource = z.infer<typeof liveAnalysisSourceSchema>;
export type LiveAnalysisSuggestion = z.infer<typeof liveAnalysisSuggestionSchema>;
