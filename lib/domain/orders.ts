import { z } from 'zod';

const cleanText = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));

const nullableText = (minimum: number, maximum: number) =>
  z.union([cleanText(minimum, maximum), z.null()]);

export const serviceRequestKinds = [
  'laboratory',
  'ecg',
  'service',
  'referral',
] as const;

export const serviceRequestStatuses = [
  'draft',
  'active',
  'on_hold',
  'revoked',
  'completed',
  'entered_in_error',
] as const;

export const serviceRequestPriorities = [
  'routine',
  'urgent',
  'asap',
  'stat',
] as const;

export const diagnosticReportStatuses = [
  'registered',
  'preliminary',
  'final',
  'amended',
  'corrected',
  'cancelled',
  'entered_in_error',
] as const;

const attachableDiagnosticReportStatuses = [
  'registered',
  'preliminary',
  'final',
  'amended',
  'corrected',
] as const;

export type ServiceRequestKind = (typeof serviceRequestKinds)[number];
export type ServiceRequestStatus = (typeof serviceRequestStatuses)[number];
export type ServiceRequestPriority = (typeof serviceRequestPriorities)[number];
export type DiagnosticReportStatus = (typeof diagnosticReportStatuses)[number];
export type DiagnosticReviewState =
  | 'pending'
  | 'reviewed'
  | 'needs_reconciliation';

export const orderListQuerySchema = z.object({
  facilityId: z.string().trim().min(1).max(100).optional(),
  accessAssignmentId: z.string().trim().min(1).max(160).optional(),
  status: z.enum([...serviceRequestStatuses, 'all']).default('all'),
  kind: z.enum([...serviceRequestKinds, 'all']).default('all'),
  query: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const createServiceRequestSchema = z
  .object({
    facilityId: z.string().trim().min(1).max(100).optional(),
    accessAssignmentId: z.string().trim().min(1).max(160).optional(),
    encounterId: z.string().trim().min(1).max(160),
    kind: z.enum(serviceRequestKinds),
    priority: z.enum(serviceRequestPriorities),
    requestedService: cleanText(2, 300),
    targetSpecialty: nullableText(2, 160),
    medicalJustification: cleanText(10, 2_000),
    clinicianNote: nullableText(2, 2_000),
    testDataAcknowledged: z.literal(true),
    idempotencyKey: z.string().uuid(),
  })
  .superRefine((value, context) => {
    if (value.kind === 'referral' && !value.targetSpecialty) {
      context.addIssue({
        code: 'custom',
        path: ['targetSpecialty'],
        message: 'Для направления к специалисту укажите специальность',
      });
    }
    if (value.kind !== 'referral' && value.targetSpecialty) {
      context.addIssue({
        code: 'custom',
        path: ['targetSpecialty'],
        message: 'Специальность применяется только к направлению',
      });
    }
  });

export const serviceRequestCommandSchema = z.object({
  facilityId: z.string().trim().min(1).max(100).optional(),
  accessAssignmentId: z.string().trim().min(1).max(160).optional(),
  action: z.enum([
    'approve',
    'hold',
    'resume',
    'revoke',
    'complete',
    'mark_error',
  ]),
  reason: cleanText(3, 500),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
});

export const diagnosticResultMetadataSchema = z.object({
  facilityId: z.string().trim().min(1).max(100).optional(),
  accessAssignmentId: z.string().trim().min(1).max(160).optional(),
  reportStatus: z.enum(attachableDiagnosticReportStatuses),
  conclusion: nullableText(2, 4_000),
  changeReason: cleanText(3, 500),
  expectedReportVersion: z.number().int().min(0),
  testDataAcknowledged: z.literal(true),
  idempotencyKey: z.string().uuid(),
});

export const diagnosticResultReviewSchema = z.object({
  facilityId: z.string().trim().min(1).max(100).optional(),
  accessAssignmentId: z.string().trim().min(1).max(160).optional(),
  decision: z.enum(['reviewed', 'needs_reconciliation']),
  note: nullableText(3, 1_000),
  expectedReportVersion: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
}).superRefine((value, context) => {
  if (value.decision === 'needs_reconciliation' && !value.note) {
    context.addIssue({
      code: 'custom',
      path: ['note'],
      message: 'Опишите расхождение, которое нужно устранить',
    });
  }
});

const serviceRequestTransitions: Record<
  ServiceRequestStatus,
  ReadonlySet<ServiceRequestStatus>
> = {
  draft: new Set(['active', 'revoked', 'entered_in_error']),
  active: new Set(['on_hold', 'revoked', 'completed', 'entered_in_error']),
  on_hold: new Set(['active', 'revoked', 'entered_in_error']),
  revoked: new Set(),
  completed: new Set(),
  entered_in_error: new Set(),
};

export function nextServiceRequestStatus(
  current: ServiceRequestStatus,
  action: z.infer<typeof serviceRequestCommandSchema>['action'],
): ServiceRequestStatus {
  const requested: Record<typeof action, ServiceRequestStatus> = {
    approve: 'active',
    hold: 'on_hold',
    resume: 'active',
    revoke: 'revoked',
    complete: 'completed',
    mark_error: 'entered_in_error',
  };
  const next = requested[action];
  if (!serviceRequestTransitions[current].has(next)) {
    throw new Error(`Недопустимое изменение направления: ${current} -> ${next}`);
  }
  return next;
}

const diagnosticReportTransitions: Record<
  DiagnosticReportStatus,
  ReadonlySet<DiagnosticReportStatus>
> = {
  registered: new Set([
    'registered',
    'preliminary',
    'final',
    'cancelled',
    'entered_in_error',
  ]),
  preliminary: new Set([
    'preliminary',
    'final',
    'corrected',
    'cancelled',
    'entered_in_error',
  ]),
  final: new Set([
    'final',
    'amended',
    'corrected',
    'cancelled',
    'entered_in_error',
  ]),
  amended: new Set([
    'amended',
    'corrected',
    'cancelled',
    'entered_in_error',
  ]),
  corrected: new Set([
    'amended',
    'corrected',
    'cancelled',
    'entered_in_error',
  ]),
  cancelled: new Set(),
  entered_in_error: new Set(),
};

const initialDiagnosticReportStatuses: ReadonlySet<DiagnosticReportStatus> =
  new Set(['registered', 'preliminary', 'final']);

export function allowedNextDiagnosticReportStatuses(
  current: DiagnosticReportStatus | null,
) {
  const allowed =
    current === null
      ? initialDiagnosticReportStatuses
      : diagnosticReportTransitions[current];

  return attachableDiagnosticReportStatuses.filter((status) =>
    allowed.has(status),
  );
}

export function assertDiagnosticReportTransition(
  current: DiagnosticReportStatus,
  next: DiagnosticReportStatus,
) {
  if (!diagnosticReportTransitions[current].has(next)) {
    throw new Error(`Недопустимое изменение результата: ${current} -> ${next}`);
  }
}

export function canCompleteServiceRequest(input: {
  reportStatus: DiagnosticReportStatus | null;
  reviewState: DiagnosticReviewState | null;
}) {
  return (
    input.reviewState === 'reviewed' &&
    input.reportStatus !== null &&
    ['final', 'amended', 'corrected'].includes(input.reportStatus)
  );
}

export const diagnosticArtifactMimeTypes = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export type DiagnosticArtifactMimeType =
  (typeof diagnosticArtifactMimeTypes)[number];

export const MAX_DIAGNOSTIC_ARTIFACT_BYTES = 10 * 1024 * 1024;

const diagnosticArtifactExtension: Record<DiagnosticArtifactMimeType, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export function diagnosticArtifactObjectKey(input: {
  organizationId: string;
  facilityId: string;
  sha256: string;
  uploadIdentityHash: string;
  mimeType: DiagnosticArtifactMimeType;
}) {
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) {
    throw new Error('Diagnostic artifact SHA-256 is invalid');
  }
  if (!/^[a-f0-9]{64}$/.test(input.uploadIdentityHash)) {
    throw new Error('Diagnostic upload identity hash is invalid');
  }
  return `diagnostic-results/${input.organizationId}/${input.facilityId}/${input.sha256}/${input.uploadIdentityHash}.${diagnosticArtifactExtension[input.mimeType]}`;
}

export function sanitizeDiagnosticFileName(value: string) {
  const normalized = value
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return normalized || 'result';
}

export function detectDiagnosticArtifactMime(bytes: Uint8Array) {
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return 'application/pdf' as const;
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg' as const;
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png' as const;
  }
  return null;
}
