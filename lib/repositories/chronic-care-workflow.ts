import { hashAuditEvent } from '@/lib/audit/event-hash';
import {
  ChronicCarePermissionRequiredError,
  chronicCareCapabilities,
  requireChronicCarePermission,
  type ChronicCarePermission,
  type ChronicCareScope,
} from '@/lib/auth/chronic-care-access';
import {
  CHRONIC_REGISTRY_SOURCE_LABEL,
  chronicDueState,
  nextChronicTaskStatus,
  signedCarePlanContentSchema,
  type ChronicDueState,
  type ChronicRegistryStatus,
  type ChronicTaskKind,
  type ChronicTaskOwnerRole,
  type ChronicTaskStatus,
  type ContactMethod,
  type SignedCarePlanContent,
  type WellbeingState,
} from '@/lib/domain/chronic-care';

export type ChronicEligibleBasis = {
  encounterId: string;
  protocolVersionId: string;
  protocolVersion: number;
  signedAt: number;
  patient: ChronicPatientSummary;
};

export type ChronicPatientSummary = {
  id: string;
  displayName: string;
  medicalRecordNumber: string;
};

export type ChronicAssignee = {
  membershipId: string;
  role: ChronicTaskOwnerRole;
  displayName: string;
};

export type ChronicCarePlanRecord = {
  id: string;
  enrollmentId: string;
  patientId: string;
  current: {
    id: string;
    version: number;
    enrollmentVersionId: string;
    content: SignedCarePlanContent;
    contentHash: string;
    signedByMembershipId: string;
    signedBy: string;
    signedAt: number;
    changeReason: string;
  };
};

export type ChronicEnrollmentRecord = {
  id: string;
  registryCode: string;
  sourceType: 'local_test';
  sourceLabel: string;
  managingClinicianMembershipId: string;
  managingClinician: string;
  patient: ChronicPatientSummary;
  current: {
    id: string;
    version: number;
    status: ChronicRegistryStatus;
    basisEncounterId: string;
    basisProtocolVersionId: string;
    diagnosisDisplay: string;
    diagnosisCode: string | null;
    diagnosisBasis: string;
    decisionReason: string;
    decidedAt: number;
  };
  plan: ChronicCarePlanRecord | null;
};

export type ChronicTaskRecord = {
  id: string;
  enrollmentId: string;
  carePlanId: string;
  sourcePlanVersionId: string;
  blueprintKey: string;
  kind: ChronicTaskKind;
  title: string;
  ownerRole: ChronicTaskOwnerRole;
  assignedMembershipId: string;
  assignedTo: string;
  patient: ChronicPatientSummary;
  current: {
    id: string;
    version: number;
    status: ChronicTaskStatus;
    dueDate: string;
    dueState: ChronicDueState;
    inclusionReason: string;
    instructions: string | null;
    contactMethod: ContactMethod | null;
    wellbeing: WellbeingState | null;
    responseSummary: string | null;
    respondedAt: number | null;
    escalationReason: string | null;
    escalatedAt: number | null;
    completedAt: number | null;
    changeReason: string;
  };
};

export type ChronicCareWorkspace = {
  dataMode: 'synthetic-only';
  sourceLabel: string;
  role: ChronicCareScope['role'];
  today: string;
  eligibleBases: ChronicEligibleBasis[];
  assignees: ChronicAssignee[];
  enrollments: ChronicEnrollmentRecord[];
  tasks: ChronicTaskRecord[];
  cohort: ChronicTaskRecord[];
  cohortCounts: Record<ChronicDueState, number>;
  capabilities: Record<ChronicCarePermission, boolean>;
  externalBlocks: Array<{
    code: 'ERDB' | 'PUZ' | 'FREE_MEDICINES' | 'PATIENT_MESSAGING';
    label: string;
    status: 'not_connected';
  }>;
};

export type CreateChronicEnrollmentCommand = {
  patientId: string;
  basisEncounterId: string;
  basisProtocolVersionId: string;
  registryCode: string;
  diagnosisDisplay: string;
  diagnosisCode: string | null;
  diagnosisBasis: string;
  doctorConfirmed: true;
  localSourceAcknowledged: true;
  reason: string;
  idempotencyKey: string;
  requestId: string;
};

export type SaveSignedCarePlanCommand = {
  enrollmentId: string;
  expectedEnrollmentVersion: number;
  expectedPlanVersion: number | null;
  content: SignedCarePlanContent;
  doctorConfirmed: true;
  localSourceAcknowledged: true;
  reason: string;
  idempotencyKey: string;
  requestId: string;
};

export type ChronicTaskCommand = {
  taskId: string;
  action: 'start' | 'record_response' | 'escalate' | 'complete' | 'resolve' | 'cancel';
  expectedTaskVersion: number;
  reason: string;
  contactMethod: ContactMethod | null;
  wellbeing: WellbeingState | null;
  responseSummary: string | null;
  escalationReason: string | null;
  idempotencyKey: string;
  requestId: string;
};

type AuditHeadRow = {
  lastSequence: number;
  lastEventHash: string | null;
  lockVersion: number;
};

type IdempotencyRow = {
  id: string;
  requestHash: string;
  status: string;
  resultResourceId: string | null;
  responseJson: string | null;
};

type EligibleBasisRow = {
  encounterId: string;
  protocolVersionId: string;
  protocolVersion: number;
  signedAt: number;
  patientId: string;
  patientDisplayName: string;
  medicalRecordNumber: string;
};

type EnrollmentRow = {
  id: string;
  patientId: string;
  patientDisplayName: string;
  medicalRecordNumber: string;
  registryCode: string;
  sourceType: 'local_test';
  sourceLabel: string;
  managingClinicianMembershipId: string;
  managingClinician: string;
  currentVersionId: string;
  currentVersion: number;
  currentStatus: ChronicRegistryStatus;
  basisEncounterId: string;
  basisProtocolVersionId: string;
  diagnosisDisplay: string;
  diagnosisCode: string | null;
  diagnosisBasis: string;
  decisionReason: string;
  decidedAt: number;
  carePlanId: string | null;
  planVersionId: string | null;
  planVersion: number | null;
  planEnrollmentVersionId: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  goalsJson: string | null;
  treatmentPlan: string | null;
  dietPlan: string | null;
  medicationsJson: string | null;
  taskBlueprintsJson: string | null;
  contentHash: string | null;
  signedByMembershipId: string | null;
  signedBy: string | null;
  signedAt: number | null;
  planChangeReason: string | null;
};

type TaskRow = {
  id: string;
  enrollmentId: string;
  carePlanId: string;
  sourcePlanVersionId: string;
  patientId: string;
  patientDisplayName: string;
  medicalRecordNumber: string;
  blueprintKey: string;
  kind: ChronicTaskKind;
  title: string;
  ownerRole: ChronicTaskOwnerRole;
  assignedMembershipId: string;
  assignedTo: string;
  currentVersionId: string;
  currentVersion: number;
  currentStatus: ChronicTaskStatus;
  dueDate: string;
  instructions: string | null;
  contactMethod: ContactMethod | null;
  wellbeing: WellbeingState | null;
  responseSummary: string | null;
  respondedAt: number | null;
  escalationReason: string | null;
  escalatedAt: number | null;
  completedAt: number | null;
  changeReason: string;
  managingClinicianMembershipId: string;
};

export class ChronicCareAuditUnavailableError extends Error {}
export class ChronicCareConflictError extends Error {}
export class ChronicCareLifecycleError extends Error {}
export class ChronicCareNotFoundError extends Error {}
export class ChronicCareValidationError extends Error {}
export class ChronicCareVersionConflictError extends Error {
  constructor(
    public readonly currentVersion: number,
    public readonly resource: 'enrollment' | 'plan' | 'task',
  ) {
    super(`${resource} version conflict`);
  }
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeNullable(value: string | null) {
  const normalized = value ? normalizeText(value) : '';
  return normalized || null;
}

function formatDateInTimeZone(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

async function sha256Json(value: unknown) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new ChronicCareValidationError(`${label} contains invalid JSON`);
  }
}

function planFromEnrollmentRow(row: EnrollmentRow): ChronicCarePlanRecord | null {
  if (
    !row.carePlanId ||
    !row.planVersionId ||
    row.planVersion === null ||
    !row.planEnrollmentVersionId ||
    !row.effectiveFrom ||
    !row.effectiveTo ||
    row.goalsJson === null ||
    row.treatmentPlan === null ||
    row.dietPlan === null ||
    row.medicationsJson === null ||
    row.taskBlueprintsJson === null ||
    !row.contentHash ||
    !row.signedByMembershipId ||
    !row.signedBy ||
    row.signedAt === null ||
    row.planChangeReason === null
  ) {
    return null;
  }
  const content = signedCarePlanContentSchema.parse({
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    goals: parseJson(row.goalsJson, 'Care plan goals'),
    treatmentPlan: row.treatmentPlan,
    dietPlan: row.dietPlan,
    medications: parseJson(row.medicationsJson, 'Care plan medications'),
    tasks: parseJson(row.taskBlueprintsJson, 'Care plan tasks'),
  });
  return {
    id: row.carePlanId,
    enrollmentId: row.id,
    patientId: row.patientId,
    current: {
      id: row.planVersionId,
      version: row.planVersion,
      enrollmentVersionId: row.planEnrollmentVersionId,
      content,
      contentHash: row.contentHash,
      signedByMembershipId: row.signedByMembershipId,
      signedBy: row.signedBy,
      signedAt: row.signedAt,
      changeReason: row.planChangeReason,
    },
  };
}

function enrollmentFromRow(row: EnrollmentRow): ChronicEnrollmentRecord {
  return {
    id: row.id,
    registryCode: row.registryCode,
    sourceType: row.sourceType,
    sourceLabel: row.sourceLabel,
    managingClinicianMembershipId: row.managingClinicianMembershipId,
    managingClinician: row.managingClinician,
    patient: {
      id: row.patientId,
      displayName: row.patientDisplayName,
      medicalRecordNumber: row.medicalRecordNumber,
    },
    current: {
      id: row.currentVersionId,
      version: row.currentVersion,
      status: row.currentStatus,
      basisEncounterId: row.basisEncounterId,
      basisProtocolVersionId: row.basisProtocolVersionId,
      diagnosisDisplay: row.diagnosisDisplay,
      diagnosisCode: row.diagnosisCode,
      diagnosisBasis: row.diagnosisBasis,
      decisionReason: row.decisionReason,
      decidedAt: row.decidedAt,
    },
    plan: planFromEnrollmentRow(row),
  };
}

function taskFromRow(row: TaskRow, today: string): ChronicTaskRecord {
  const dueState = chronicDueState(row.currentStatus, row.dueDate, today);
  const inclusionReason =
    dueState === 'overdue'
      ? `Срок ${row.dueDate} прошёл, задача не закрыта`
      : dueState === 'due_soon'
        ? `Срок ${row.dueDate} наступит в течение 7 дней`
        : dueState === 'closed'
          ? `Задача закрыта со статусом ${row.currentStatus}`
          : `Срок ${row.dueDate} позже ближайших 7 дней`;
  return {
    id: row.id,
    enrollmentId: row.enrollmentId,
    carePlanId: row.carePlanId,
    sourcePlanVersionId: row.sourcePlanVersionId,
    blueprintKey: row.blueprintKey,
    kind: row.kind,
    title: row.title,
    ownerRole: row.ownerRole,
    assignedMembershipId: row.assignedMembershipId,
    assignedTo: row.assignedTo,
    patient: {
      id: row.patientId,
      displayName: row.patientDisplayName,
      medicalRecordNumber: row.medicalRecordNumber,
    },
    current: {
      id: row.currentVersionId,
      version: row.currentVersion,
      status: row.currentStatus,
      dueDate: row.dueDate,
      dueState,
      inclusionReason,
      instructions: row.instructions,
      contactMethod: row.contactMethod,
      wellbeing: row.wellbeing,
      responseSummary: row.responseSummary,
      respondedAt: row.respondedAt,
      escalationReason: row.escalationReason,
      escalatedAt: row.escalatedAt,
      completedAt: row.completedAt,
      changeReason: row.changeReason,
    },
  };
}

export class D1ChronicCareWorkflowRepository {
  constructor(
    private readonly database: D1Database,
    private readonly scope: ChronicCareScope,
  ) {}

  async list(input: {
    dueState?: ChronicDueState | 'all';
    limit?: number;
    now?: number;
  } = {}): Promise<ChronicCareWorkspace> {
    requireChronicCarePermission(this.scope.role, 'workspace.read');
    const now = input.now ?? Date.now();
    const facility = await this.database
      .prepare(`select timezone from facilities
        where organization_id = ?1 and id = ?2 and status = 'active' limit 1`)
      .bind(this.scope.organizationId, this.scope.facilityId)
      .first<{ timezone: string }>();
    if (!facility) throw new ChronicCareNotFoundError('Facility unavailable');
    const today = formatDateInTimeZone(now, facility.timezone);
    const visibility = this.scope.role === 'clinician'
      ? 'enrollment.managing_clinician_membership_id = ?3'
      : `exists (
          select 1 from chronic_care_tasks visible_task
          where visible_task.organization_id = enrollment.organization_id
            and visible_task.facility_id = enrollment.facility_id
            and visible_task.enrollment_id = enrollment.id
            and visible_task.assigned_membership_id = ?3
        )`;
    const taskVisibility = this.scope.role === 'clinician'
      ? 'enrollment.managing_clinician_membership_id = ?3'
      : 'task.assigned_membership_id = ?3';
    const eligibleStatement = this.scope.role === 'clinician'
      ? this.database
          .prepare(`
            select encounter.id as encounterId,
              signed.id as protocolVersionId, signed.version as protocolVersion,
              signed.signed_at as signedAt, patient.id as patientId,
              coalesce(profile.display_name, patient.display_name) as patientDisplayName,
              patient.medical_record_number as medicalRecordNumber
            from encounters encounter
            join patients patient
              on patient.organization_id = encounter.organization_id
              and patient.facility_id = encounter.facility_id
              and patient.id = encounter.patient_id
              and patient.status = 'active'
            left join patient_profile_heads profile_head
              on profile_head.organization_id = patient.organization_id
              and profile_head.facility_id = patient.facility_id
              and profile_head.patient_id = patient.id
            left join patient_profile_versions profile
              on profile.organization_id = profile_head.organization_id
              and profile.facility_id = profile_head.facility_id
              and profile.patient_id = profile_head.patient_id
              and profile.id = profile_head.current_version_id
            join protocol_heads protocol_head
              on protocol_head.organization_id = encounter.organization_id
              and protocol_head.facility_id = encounter.facility_id
              and protocol_head.encounter_id = encounter.id
            join protocol_versions signed
              on signed.organization_id = protocol_head.organization_id
              and signed.facility_id = protocol_head.facility_id
              and signed.encounter_id = protocol_head.encounter_id
              and signed.id = protocol_head.current_signed_protocol_version_id
              and signed.status = 'signed'
              and signed.signed_by_membership_id = encounter.clinician_membership_id
            where encounter.organization_id = ?1 and encounter.facility_id = ?2
              and encounter.clinician_membership_id = ?3
              and not exists (
                select 1 from chronic_registry_enrollments existing
                where existing.organization_id = encounter.organization_id
                  and existing.facility_id = encounter.facility_id
                  and existing.patient_id = encounter.patient_id
              )
            order by signed.signed_at desc, encounter.id
            limit 100
          `)
          .bind(this.scope.organizationId, this.scope.facilityId, this.scope.membershipId)
          .all<EligibleBasisRow>()
      : Promise.resolve({ results: [] } as unknown as D1Result<EligibleBasisRow>);
    const [eligibleResult, assigneeResult, enrollmentResult, taskResult] =
      await Promise.all([
        eligibleStatement,
        this.database
          .prepare(`select membership.id as membershipId, membership.role,
              user.display_name as displayName
            from memberships membership
            join users user on user.id = membership.user_id and user.status = 'active'
            where membership.organization_id = ?1 and membership.facility_id = ?2
              and membership.status = 'active'
              and membership.role in ('clinician', 'nurse')
            order by membership.role, user.display_name, membership.id`)
          .bind(this.scope.organizationId, this.scope.facilityId)
          .all<ChronicAssignee>(),
        this.database
          .prepare(`
            select enrollment.id, enrollment.patient_id as patientId,
              coalesce(profile.display_name, patient.display_name) as patientDisplayName,
              patient.medical_record_number as medicalRecordNumber,
              enrollment.registry_code as registryCode,
              enrollment.source_type as sourceType,
              enrollment.source_label as sourceLabel,
              enrollment.managing_clinician_membership_id as managingClinicianMembershipId,
              manager_user.display_name as managingClinician,
              current.id as currentVersionId, current.version as currentVersion,
              current.status as currentStatus,
              current.basis_encounter_id as basisEncounterId,
              current.basis_protocol_version_id as basisProtocolVersionId,
              current.diagnosis_display as diagnosisDisplay,
              current.diagnosis_code as diagnosisCode,
              current.diagnosis_basis as diagnosisBasis,
              current.decision_reason as decisionReason,
              current.decided_at as decidedAt,
              plan.id as carePlanId, plan_current.id as planVersionId,
              plan_current.version as planVersion,
              plan_current.enrollment_version_id as planEnrollmentVersionId,
              plan_current.effective_from as effectiveFrom,
              plan_current.effective_to as effectiveTo,
              plan_current.goals_json as goalsJson,
              plan_current.treatment_plan as treatmentPlan,
              plan_current.diet_plan as dietPlan,
              plan_current.medications_json as medicationsJson,
              plan_current.task_blueprints_json as taskBlueprintsJson,
              plan_current.content_hash as contentHash,
              plan_current.signed_by_membership_id as signedByMembershipId,
              signer_user.display_name as signedBy,
              plan_current.signed_at as signedAt,
              plan_current.change_reason as planChangeReason
            from chronic_registry_enrollments enrollment
            join chronic_registry_enrollment_heads enrollment_head
              on enrollment_head.organization_id = enrollment.organization_id
              and enrollment_head.facility_id = enrollment.facility_id
              and enrollment_head.enrollment_id = enrollment.id
            join chronic_registry_enrollment_versions current
              on current.organization_id = enrollment_head.organization_id
              and current.facility_id = enrollment_head.facility_id
              and current.enrollment_id = enrollment_head.enrollment_id
              and current.id = enrollment_head.current_version_id
            join patients patient
              on patient.organization_id = enrollment.organization_id
              and patient.facility_id = enrollment.facility_id
              and patient.id = enrollment.patient_id
            left join patient_profile_heads profile_head
              on profile_head.organization_id = patient.organization_id
              and profile_head.facility_id = patient.facility_id
              and profile_head.patient_id = patient.id
            left join patient_profile_versions profile
              on profile.organization_id = profile_head.organization_id
              and profile.facility_id = profile_head.facility_id
              and profile.patient_id = profile_head.patient_id
              and profile.id = profile_head.current_version_id
            join memberships manager
              on manager.organization_id = enrollment.organization_id
              and manager.facility_id = enrollment.facility_id
              and manager.id = enrollment.managing_clinician_membership_id
            join users manager_user on manager_user.id = manager.user_id
            left join chronic_care_plans plan
              on plan.organization_id = enrollment.organization_id
              and plan.facility_id = enrollment.facility_id
              and plan.enrollment_id = enrollment.id
            left join chronic_care_plan_heads plan_head
              on plan_head.organization_id = plan.organization_id
              and plan_head.facility_id = plan.facility_id
              and plan_head.care_plan_id = plan.id
            left join chronic_care_plan_versions plan_current
              on plan_current.organization_id = plan_head.organization_id
              and plan_current.facility_id = plan_head.facility_id
              and plan_current.care_plan_id = plan_head.care_plan_id
              and plan_current.id = plan_head.current_version_id
            left join memberships signer
              on signer.organization_id = plan_current.organization_id
              and signer.facility_id = plan_current.facility_id
              and signer.id = plan_current.signed_by_membership_id
            left join users signer_user on signer_user.id = signer.user_id
            where enrollment.organization_id = ?1 and enrollment.facility_id = ?2
              and ${visibility}
            order by case current.status when 'active' then 0 else 1 end,
              current.decided_at desc, enrollment.id
          `)
          .bind(this.scope.organizationId, this.scope.facilityId, this.scope.membershipId)
          .all<EnrollmentRow>(),
        this.database
          .prepare(`
            select task.id, task.enrollment_id as enrollmentId,
              task.care_plan_id as carePlanId,
              task.source_plan_version_id as sourcePlanVersionId,
              task.patient_id as patientId,
              coalesce(profile.display_name, patient.display_name) as patientDisplayName,
              patient.medical_record_number as medicalRecordNumber,
              task.blueprint_key as blueprintKey, task.kind, task.title,
              task.owner_role as ownerRole,
              task.assigned_membership_id as assignedMembershipId,
              assigned_user.display_name as assignedTo,
              current.id as currentVersionId, current.version as currentVersion,
              current.status as currentStatus, current.due_date as dueDate,
              current.instructions, current.contact_method as contactMethod,
              current.wellbeing, current.response_summary as responseSummary,
              current.responded_at as respondedAt,
              current.escalation_reason as escalationReason,
              current.escalated_at as escalatedAt,
              current.completed_at as completedAt,
              current.change_reason as changeReason,
              enrollment.managing_clinician_membership_id as managingClinicianMembershipId
            from chronic_care_tasks task
            join chronic_care_task_heads head
              on head.organization_id = task.organization_id
              and head.facility_id = task.facility_id
              and head.task_id = task.id
            join chronic_care_task_versions current
              on current.organization_id = head.organization_id
              and current.facility_id = head.facility_id
              and current.task_id = head.task_id
              and current.id = head.current_version_id
            join chronic_registry_enrollments enrollment
              on enrollment.organization_id = task.organization_id
              and enrollment.facility_id = task.facility_id
              and enrollment.id = task.enrollment_id
            join patients patient
              on patient.organization_id = task.organization_id
              and patient.facility_id = task.facility_id
              and patient.id = task.patient_id
            left join patient_profile_heads profile_head
              on profile_head.organization_id = patient.organization_id
              and profile_head.facility_id = patient.facility_id
              and profile_head.patient_id = patient.id
            left join patient_profile_versions profile
              on profile.organization_id = profile_head.organization_id
              and profile.facility_id = profile_head.facility_id
              and profile.patient_id = profile_head.patient_id
              and profile.id = profile_head.current_version_id
            join memberships assigned
              on assigned.organization_id = task.organization_id
              and assigned.facility_id = task.facility_id
              and assigned.id = task.assigned_membership_id
            join users assigned_user on assigned_user.id = assigned.user_id
            where task.organization_id = ?1 and task.facility_id = ?2
              and ${taskVisibility}
            order by current.due_date, task.title, task.id
          `)
          .bind(this.scope.organizationId, this.scope.facilityId, this.scope.membershipId)
          .all<TaskRow>(),
      ]);
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
    const tasks = taskResult.results.map((row) => taskFromRow(row, today));
    const requestedDueState = input.dueState ?? 'all';
    const cohort = tasks
      .filter((task) =>
        requestedDueState === 'all'
          ? task.current.dueState === 'overdue' || task.current.dueState === 'due_soon'
          : task.current.dueState === requestedDueState,
      )
      .slice(0, limit);
    const cohortCounts: Record<ChronicDueState, number> = {
      current: 0,
      due_soon: 0,
      overdue: 0,
      closed: 0,
    };
    for (const task of tasks) cohortCounts[task.current.dueState] += 1;
    return {
      dataMode: 'synthetic-only',
      sourceLabel: CHRONIC_REGISTRY_SOURCE_LABEL,
      role: this.scope.role,
      today,
      eligibleBases: eligibleResult.results.map((row) => ({
        encounterId: row.encounterId,
        protocolVersionId: row.protocolVersionId,
        protocolVersion: row.protocolVersion,
        signedAt: row.signedAt,
        patient: {
          id: row.patientId,
          displayName: row.patientDisplayName,
          medicalRecordNumber: row.medicalRecordNumber,
        },
      })),
      assignees: assigneeResult.results,
      enrollments: enrollmentResult.results.map(enrollmentFromRow),
      tasks,
      cohort,
      cohortCounts,
      capabilities: chronicCareCapabilities(this.scope.role),
      externalBlocks: [
        { code: 'ERDB', label: 'Постановка на учёт в ЭРДБ', status: 'not_connected' },
        { code: 'PUZ', label: 'Отправка плана в ПУЗ', status: 'not_connected' },
        { code: 'FREE_MEDICINES', label: 'Источник права на бесплатные лекарства', status: 'not_connected' },
        { code: 'PATIENT_MESSAGING', label: 'Автообзвон и WhatsApp/Telegram-уведомления', status: 'not_connected' },
      ],
    };
  }

  async createEnrollment(
    input: CreateChronicEnrollmentCommand,
  ): Promise<ChronicEnrollmentRecord> {
    requireChronicCarePermission(this.scope.role, 'enrollment.confirm');
    const normalized = {
      patientId: input.patientId,
      basisEncounterId: input.basisEncounterId,
      basisProtocolVersionId: input.basisProtocolVersionId,
      registryCode: normalizeText(input.registryCode).toUpperCase(),
      diagnosisDisplay: normalizeText(input.diagnosisDisplay),
      diagnosisCode: normalizeNullable(input.diagnosisCode),
      diagnosisBasis: normalizeText(input.diagnosisBasis),
      reason: normalizeText(input.reason),
      doctorConfirmed: input.doctorConfirmed,
      localSourceAcknowledged: input.localSourceAcknowledged,
      accessAssignmentId: this.scope.accessAssignmentId,
      dataMode: 'synthetic-only',
    } as const;
    const requestHash = await sha256Json(normalized);
    const replay = await this.findIdempotency('chronic.enrollment.create', input.idempotencyKey);
    if (replay) return this.resolveReplay<ChronicEnrollmentRecord>(replay, requestHash);
    const basis = await this.requireEligibleBasis(normalized);
    const collision = await this.database
      .prepare(`select 1 as present from chronic_registry_enrollments
        where organization_id = ?1 and facility_id = ?2
          and patient_id = ?3 and registry_code = ?4 limit 1`)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        normalized.patientId,
        normalized.registryCode,
      )
      .first<{ present: number }>();
    if (collision) throw new ChronicCareConflictError('Patient is already enrolled in this registry');
    const now = Date.now();
    const enrollmentId = `chronic-enrollment-${crypto.randomUUID()}`;
    const versionId = `chronic-enrollment-version-${crypto.randomUUID()}`;
    const response: ChronicEnrollmentRecord = {
      id: enrollmentId,
      registryCode: normalized.registryCode,
      sourceType: 'local_test',
      sourceLabel: CHRONIC_REGISTRY_SOURCE_LABEL,
      managingClinicianMembershipId: this.scope.membershipId,
      managingClinician: basis.clinicianDisplayName,
      patient: {
        id: basis.patientId,
        displayName: basis.patientDisplayName,
        medicalRecordNumber: basis.medicalRecordNumber,
      },
      current: {
        id: versionId,
        version: 1,
        status: 'active',
        basisEncounterId: normalized.basisEncounterId,
        basisProtocolVersionId: normalized.basisProtocolVersionId,
        diagnosisDisplay: normalized.diagnosisDisplay,
        diagnosisCode: normalized.diagnosisCode,
        diagnosisBasis: normalized.diagnosisBasis,
        decisionReason: normalized.reason,
        decidedAt: now,
      },
      plan: null,
    };
    return this.commitCommand({
      operation: 'chronic.enrollment.create',
      key: input.idempotencyKey,
      requestHash,
      resourceType: 'chronic_enrollment',
      resourceId: enrollmentId,
      response,
      action: 'chronic.enrollment.confirmed',
      entityType: 'chronic_enrollment',
      requestId: input.requestId,
      metadata: {
        patientId: basis.patientId,
        registryCode: normalized.registryCode,
        basisProtocolVersionId: normalized.basisProtocolVersionId,
        sourceType: 'local_test',
      },
      now,
      statements: [
        this.database.prepare(`insert into chronic_registry_enrollments (
          id, organization_id, facility_id, patient_id, registry_code,
          source_type, source_label, managing_clinician_membership_id,
          created_by_membership_id, access_assignment_id, created_at
        ) values (?1, ?2, ?3, ?4, ?5, 'local_test', ?6, ?7, ?7, ?8, ?9)`)
          .bind(
            enrollmentId,
            this.scope.organizationId,
            this.scope.facilityId,
            basis.patientId,
            normalized.registryCode,
            CHRONIC_REGISTRY_SOURCE_LABEL,
            this.scope.membershipId,
            this.scope.accessAssignmentId,
            now,
          ),
        this.database.prepare(`insert into chronic_registry_enrollment_versions (
          id, organization_id, facility_id, enrollment_id, version,
          supersedes_version_id, status, basis_encounter_id,
          basis_protocol_version_id, diagnosis_display, diagnosis_code,
          diagnosis_basis, decision_reason, decided_by_membership_id,
          access_assignment_id, decided_at, created_at
        ) values (?1, ?2, ?3, ?4, 1, null, 'active', ?5, ?6, ?7, ?8,
          ?9, ?10, ?11, ?12, ?13, ?13)`)
          .bind(
            versionId,
            this.scope.organizationId,
            this.scope.facilityId,
            enrollmentId,
            normalized.basisEncounterId,
            normalized.basisProtocolVersionId,
            normalized.diagnosisDisplay,
            normalized.diagnosisCode,
            normalized.diagnosisBasis,
            normalized.reason,
            this.scope.membershipId,
            this.scope.accessAssignmentId,
            now,
          ),
        this.database.prepare(`insert into chronic_registry_enrollment_heads (
          id, organization_id, facility_id, enrollment_id, current_version_id,
          lock_version, created_at, updated_at
        ) values (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)`)
          .bind(
            `chronic-enrollment-head-${crypto.randomUUID()}`,
            this.scope.organizationId,
            this.scope.facilityId,
            enrollmentId,
            versionId,
            now,
          ),
      ],
    });
  }

  async recordListRead(input: { resultCount: number; requestId: string }) {
    requireChronicCarePermission(this.scope.role, 'workspace.read');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const auditHead = await this.requireAuditHead();
      const audit = await this.createAudit({
        auditHead,
        action: 'chronic.workspace.read',
        entityType: 'chronic_care_workspace',
        entityId: this.scope.facilityId,
        requestId: input.requestId,
        metadata: {
          resultCount: input.resultCount,
          role: this.scope.role,
          dataMode: 'synthetic-only',
        },
        occurredAt: Date.now(),
      });
      try {
        const results = await this.database.batch([
          this.auditInsert(audit),
          this.auditHeadUpdate(audit),
        ]);
        if (
          results.length !== 2 ||
          results.some((result) => result.meta.changes !== 1)
        ) {
          throw new Error('Read audit did not commit');
        }
        return;
      } catch {
        if (attempt === 2) throw new ChronicCareAuditUnavailableError();
      }
    }
  }

  async saveSignedPlan(
    input: SaveSignedCarePlanCommand,
  ): Promise<ChronicCarePlanRecord> {
    requireChronicCarePermission(this.scope.role, 'plan.sign');
    const content = signedCarePlanContentSchema.parse(input.content);
    const normalized = {
      enrollmentId: input.enrollmentId,
      expectedEnrollmentVersion: input.expectedEnrollmentVersion,
      expectedPlanVersion: input.expectedPlanVersion,
      content,
      doctorConfirmed: input.doctorConfirmed,
      localSourceAcknowledged: input.localSourceAcknowledged,
      reason: normalizeText(input.reason),
      accessAssignmentId: this.scope.accessAssignmentId,
      dataMode: 'synthetic-only',
    } as const;
    const requestHash = await sha256Json(normalized);
    const replay = await this.findIdempotency('chronic.plan.sign', input.idempotencyKey);
    if (replay) return this.resolveReplay<ChronicCarePlanRecord>(replay, requestHash);
    const enrollment = await this.requireManagedEnrollment(input.enrollmentId);
    if (enrollment.currentVersion !== input.expectedEnrollmentVersion) {
      throw new ChronicCareVersionConflictError(enrollment.currentVersion, 'enrollment');
    }
    if (enrollment.currentStatus !== 'active') {
      throw new ChronicCareLifecycleError('Care plan requires an active enrollment');
    }
    const currentPlan = await this.getPlanHead(input.enrollmentId);
    if (currentPlan) {
      if (input.expectedPlanVersion !== currentPlan.version) {
        throw new ChronicCareVersionConflictError(currentPlan.version, 'plan');
      }
    } else if (input.expectedPlanVersion !== null) {
      throw new ChronicCareVersionConflictError(0, 'plan');
    }
    await this.requireValidAssignees(content);
    const now = Date.now();
    const planId = currentPlan?.carePlanId ?? `chronic-care-plan-${crypto.randomUUID()}`;
    const planVersionId = `chronic-care-plan-version-${crypto.randomUUID()}`;
    const planVersion = (currentPlan?.version ?? 0) + 1;
    const contentHash = await sha256Json(content);
    const signer = await this.requireCurrentUserDisplayName();
    const response: ChronicCarePlanRecord = {
      id: planId,
      enrollmentId: enrollment.id,
      patientId: enrollment.patientId,
      current: {
        id: planVersionId,
        version: planVersion,
        enrollmentVersionId: enrollment.currentVersionId,
        content,
        contentHash,
        signedByMembershipId: this.scope.membershipId,
        signedBy: signer,
        signedAt: now,
        changeReason: normalized.reason,
      },
    };
    const statements: D1PreparedStatement[] = [];
    if (!currentPlan) {
      statements.push(
        this.database.prepare(`insert into chronic_care_plans (
          id, organization_id, facility_id, enrollment_id, patient_id,
          created_by_membership_id, access_assignment_id, created_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
          .bind(
            planId,
            this.scope.organizationId,
            this.scope.facilityId,
            enrollment.id,
            enrollment.patientId,
            this.scope.membershipId,
            this.scope.accessAssignmentId,
            now,
          ),
      );
    }
    statements.push(
      this.database.prepare(`insert into chronic_care_plan_versions (
        id, organization_id, facility_id, care_plan_id, enrollment_id,
        enrollment_version_id, version, supersedes_version_id, effective_from,
        effective_to, goals_json, treatment_plan, diet_plan, medications_json,
        task_blueprints_json, content_hash, signed_by_membership_id,
        access_assignment_id, signed_at, change_reason, created_at
      ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
        ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?19)`)
        .bind(
          planVersionId,
          this.scope.organizationId,
          this.scope.facilityId,
          planId,
          enrollment.id,
          enrollment.currentVersionId,
          planVersion,
          currentPlan?.currentVersionId ?? null,
          content.effectiveFrom,
          content.effectiveTo,
          JSON.stringify(content.goals),
          content.treatmentPlan,
          content.dietPlan,
          JSON.stringify(content.medications),
          JSON.stringify(content.tasks),
          contentHash,
          this.scope.membershipId,
          this.scope.accessAssignmentId,
          now,
          normalized.reason,
        ),
    );
    if (currentPlan) {
      statements.push(
        this.database.prepare(`update chronic_care_plan_heads
          set current_version_id = ?1, lock_version = lock_version + 1,
            updated_at = ?2
          where organization_id = ?3 and facility_id = ?4
            and care_plan_id = ?5 and current_version_id = ?6
            and lock_version = ?7`)
          .bind(
            planVersionId,
            now,
            this.scope.organizationId,
            this.scope.facilityId,
            planId,
            currentPlan.currentVersionId,
            currentPlan.version,
          ),
      );
      const oldOpenTasks = await this.listOpenTaskRows(planId);
      for (const task of oldOpenTasks) {
        const cancellationVersionId = `chronic-task-version-${crypto.randomUUID()}`;
        statements.push(
          this.database.prepare(`insert into chronic_care_task_versions (
            id, organization_id, facility_id, task_id, version,
            supersedes_version_id, status, due_date, instructions,
            contact_method, wellbeing, response_summary, responded_at,
            escalation_reason, escalated_at, completed_at, change_reason,
            changed_by_membership_id, access_assignment_id, created_at
          ) values (?1, ?2, ?3, ?4, ?5, ?6, 'cancelled', ?7, ?8,
            ?9, ?10, ?11, ?12, null, null, null, ?13, ?14, ?15, ?16)`)
            .bind(
              cancellationVersionId,
              this.scope.organizationId,
              this.scope.facilityId,
              task.id,
              task.currentVersion + 1,
              task.currentVersionId,
              task.dueDate,
              task.instructions,
              task.contactMethod,
              task.wellbeing,
              task.responseSummary,
              task.respondedAt,
              'Заменено новой подписанной версией плана',
              this.scope.membershipId,
              this.scope.accessAssignmentId,
              now,
            ),
          this.database.prepare(`update chronic_care_task_heads
            set current_version_id = ?1, lock_version = lock_version + 1,
              updated_at = ?2
            where organization_id = ?3 and facility_id = ?4
              and task_id = ?5 and current_version_id = ?6
              and lock_version = ?7`)
            .bind(
              cancellationVersionId,
              now,
              this.scope.organizationId,
              this.scope.facilityId,
              task.id,
              task.currentVersionId,
              task.currentVersion,
            ),
        );
      }
    } else {
      statements.push(
        this.database.prepare(`insert into chronic_care_plan_heads (
          id, organization_id, facility_id, care_plan_id, current_version_id,
          lock_version, created_at, updated_at
        ) values (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)`)
          .bind(
            `chronic-care-plan-head-${crypto.randomUUID()}`,
            this.scope.organizationId,
            this.scope.facilityId,
            planId,
            planVersionId,
            now,
          ),
      );
    }
    for (const blueprint of content.tasks) {
      const taskId = `chronic-task-${crypto.randomUUID()}`;
      const taskVersionId = `chronic-task-version-${crypto.randomUUID()}`;
      statements.push(
        this.database.prepare(`insert into chronic_care_tasks (
          id, organization_id, facility_id, enrollment_id, care_plan_id,
          source_plan_version_id, patient_id, blueprint_key, kind, title,
          owner_role, assigned_membership_id, access_assignment_id, created_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`)
          .bind(
            taskId,
            this.scope.organizationId,
            this.scope.facilityId,
            enrollment.id,
            planId,
            planVersionId,
            enrollment.patientId,
            blueprint.key,
            blueprint.kind,
            blueprint.title,
            blueprint.ownerRole,
            blueprint.assignedMembershipId,
            this.scope.accessAssignmentId,
            now,
          ),
        this.database.prepare(`insert into chronic_care_task_versions (
          id, organization_id, facility_id, task_id, version,
          supersedes_version_id, status, due_date, instructions,
          contact_method, wellbeing, response_summary, responded_at,
          escalation_reason, escalated_at, completed_at, change_reason,
          changed_by_membership_id, access_assignment_id, created_at
        ) values (?1, ?2, ?3, ?4, 1, null, 'pending', ?5, ?6,
          null, null, null, null, null, null, null, ?7, ?8, ?9, ?10)`)
          .bind(
            taskVersionId,
            this.scope.organizationId,
            this.scope.facilityId,
            taskId,
            blueprint.dueDate,
            blueprint.instructions,
            'Создано из подписанной версии плана',
            this.scope.membershipId,
            this.scope.accessAssignmentId,
            now,
          ),
        this.database.prepare(`insert into chronic_care_task_heads (
          id, organization_id, facility_id, task_id, current_version_id,
          lock_version, created_at, updated_at
        ) values (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)`)
          .bind(
            `chronic-task-head-${crypto.randomUUID()}`,
            this.scope.organizationId,
            this.scope.facilityId,
            taskId,
            taskVersionId,
            now,
          ),
      );
    }
    return this.commitCommand({
      operation: 'chronic.plan.sign',
      key: input.idempotencyKey,
      requestHash,
      resourceType: 'chronic_care_plan',
      resourceId: planId,
      response,
      action: currentPlan ? 'chronic.plan.revised' : 'chronic.plan.signed',
      entityType: 'chronic_care_plan',
      requestId: input.requestId,
      metadata: {
        enrollmentId: enrollment.id,
        planVersion,
        taskCount: content.tasks.length,
        medicationCount: content.medications.length,
        replacedPlanVersion: currentPlan?.version ?? null,
        dataMode: 'synthetic-only',
      },
      now,
      statements,
    });
  }

  async commandTask(input: ChronicTaskCommand): Promise<ChronicTaskRecord> {
    const permissionByAction: Record<ChronicTaskCommand['action'], ChronicCarePermission> = {
      start: 'task.start',
      record_response: 'task.response',
      escalate: 'task.escalate',
      complete: 'task.complete',
      resolve: 'task.resolve',
      cancel: 'task.cancel',
    };
    requireChronicCarePermission(this.scope.role, permissionByAction[input.action]);
    const normalized = {
      taskId: input.taskId,
      action: input.action,
      expectedTaskVersion: input.expectedTaskVersion,
      reason: normalizeText(input.reason),
      contactMethod: input.contactMethod,
      wellbeing: input.wellbeing,
      responseSummary: normalizeNullable(input.responseSummary),
      escalationReason: normalizeNullable(input.escalationReason),
      accessAssignmentId: this.scope.accessAssignmentId,
      dataMode: 'synthetic-only',
    } as const;
    const requestHash = await sha256Json(normalized);
    const replay = await this.findIdempotency('chronic.task.command', input.idempotencyKey);
    if (replay) return this.resolveReplay<ChronicTaskRecord>(replay, requestHash);
    const current = await this.requireVisibleTask(input.taskId);
    if (
      ['start', 'record_response', 'escalate', 'complete'].includes(input.action) &&
      (current.assignedMembershipId !== this.scope.membershipId ||
        current.ownerRole !== this.scope.role)
    ) {
      throw new ChronicCarePermissionRequiredError(permissionByAction[input.action]);
    }
    if (current.currentVersion !== input.expectedTaskVersion) {
      throw new ChronicCareVersionConflictError(current.currentVersion, 'task');
    }
    let nextStatus: ChronicTaskStatus;
    try {
      nextStatus = nextChronicTaskStatus(current.currentStatus, input.action);
    } catch (error) {
      throw new ChronicCareLifecycleError(
        error instanceof Error ? error.message : 'Invalid chronic task transition',
      );
    }
    const now = Date.now();
    const versionId = `chronic-task-version-${crypto.randomUUID()}`;
    const contactMethod = input.action === 'record_response'
      ? normalized.contactMethod
      : current.contactMethod;
    const wellbeing = input.action === 'record_response'
      ? normalized.wellbeing
      : current.wellbeing;
    const responseSummary = input.action === 'record_response'
      ? normalized.responseSummary
      : current.responseSummary;
    const respondedAt = input.action === 'record_response' ? now : current.respondedAt;
    const escalationReason = input.action === 'escalate'
      ? normalized.escalationReason
      : input.action === 'resolve'
        ? current.escalationReason
        : null;
    const escalatedAt = input.action === 'escalate'
      ? now
      : input.action === 'resolve'
        ? current.escalatedAt
        : null;
    const completedAt = nextStatus === 'completed' ? now : null;
    const response = taskFromRow(
      {
        ...current,
        currentVersionId: versionId,
        currentVersion: current.currentVersion + 1,
        currentStatus: nextStatus,
        contactMethod,
        wellbeing,
        responseSummary,
        respondedAt,
        escalationReason,
        escalatedAt,
        completedAt,
        changeReason: normalized.reason,
      },
      await this.currentClinicDate(now),
    );
    return this.commitCommand({
      operation: 'chronic.task.command',
      key: input.idempotencyKey,
      requestHash,
      resourceType: 'chronic_care_task',
      resourceId: current.id,
      response,
      action: `chronic.task.${input.action}`,
      entityType: 'chronic_care_task',
      requestId: input.requestId,
      metadata: {
        enrollmentId: current.enrollmentId,
        patientId: current.patientId,
        previousStatus: current.currentStatus,
        nextStatus,
        previousVersion: current.currentVersion,
        sourcePlanVersionId: current.sourcePlanVersionId,
        dataMode: 'synthetic-only',
      },
      now,
      statements: [
        this.database.prepare(`insert into chronic_care_task_versions (
          id, organization_id, facility_id, task_id, version,
          supersedes_version_id, status, due_date, instructions,
          contact_method, wellbeing, response_summary, responded_at,
          escalation_reason, escalated_at, completed_at, change_reason,
          changed_by_membership_id, access_assignment_id, created_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
          ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)`)
          .bind(
            versionId,
            this.scope.organizationId,
            this.scope.facilityId,
            current.id,
            current.currentVersion + 1,
            current.currentVersionId,
            nextStatus,
            current.dueDate,
            current.instructions,
            contactMethod,
            wellbeing,
            responseSummary,
            respondedAt,
            escalationReason,
            escalatedAt,
            completedAt,
            normalized.reason,
            this.scope.membershipId,
            this.scope.accessAssignmentId,
            now,
          ),
        this.database.prepare(`update chronic_care_task_heads
          set current_version_id = ?1, lock_version = lock_version + 1,
            updated_at = ?2
          where organization_id = ?3 and facility_id = ?4
            and task_id = ?5 and current_version_id = ?6
            and lock_version = ?7`)
          .bind(
            versionId,
            now,
            this.scope.organizationId,
            this.scope.facilityId,
            current.id,
            current.currentVersionId,
            current.currentVersion,
          ),
      ],
    });
  }

  private async requireEligibleBasis(input: {
    patientId: string;
    basisEncounterId: string;
    basisProtocolVersionId: string;
  }) {
    const row = await this.database
      .prepare(`select encounter.patient_id as patientId,
          coalesce(profile.display_name, patient.display_name) as patientDisplayName,
          patient.medical_record_number as medicalRecordNumber,
          clinician_user.display_name as clinicianDisplayName
        from encounters encounter
        join patients patient
          on patient.organization_id = encounter.organization_id
          and patient.facility_id = encounter.facility_id
          and patient.id = encounter.patient_id and patient.status = 'active'
        left join patient_profile_heads profile_head
          on profile_head.organization_id = patient.organization_id
          and profile_head.facility_id = patient.facility_id
          and profile_head.patient_id = patient.id
        left join patient_profile_versions profile
          on profile.organization_id = profile_head.organization_id
          and profile.facility_id = profile_head.facility_id
          and profile.patient_id = profile_head.patient_id
          and profile.id = profile_head.current_version_id
        join protocol_heads protocol_head
          on protocol_head.organization_id = encounter.organization_id
          and protocol_head.facility_id = encounter.facility_id
          and protocol_head.encounter_id = encounter.id
          and protocol_head.current_signed_protocol_version_id = ?5
        join protocol_versions protocol_version
          on protocol_version.organization_id = protocol_head.organization_id
          and protocol_version.facility_id = protocol_head.facility_id
          and protocol_version.encounter_id = protocol_head.encounter_id
          and protocol_version.id = protocol_head.current_signed_protocol_version_id
          and protocol_version.status = 'signed'
          and protocol_version.signed_by_membership_id = ?3
        join memberships clinician
          on clinician.organization_id = encounter.organization_id
          and clinician.facility_id = encounter.facility_id
          and clinician.id = encounter.clinician_membership_id
          and clinician.id = ?3 and clinician.role = 'clinician'
          and clinician.status = 'active'
        join users clinician_user on clinician_user.id = clinician.user_id
        where encounter.organization_id = ?1 and encounter.facility_id = ?2
          and encounter.id = ?4 and encounter.patient_id = ?6 limit 1`)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.membershipId,
        input.basisEncounterId,
        input.basisProtocolVersionId,
        input.patientId,
      )
      .first<{
        patientId: string;
        patientDisplayName: string;
        medicalRecordNumber: string;
        clinicianDisplayName: string;
      }>();
    if (!row) {
      throw new ChronicCareNotFoundError(
        'Current signed protocol for the assigned clinician was not found',
      );
    }
    return row;
  }

  private async requireManagedEnrollment(enrollmentId: string) {
    const row = await this.database
      .prepare(`select enrollment.id, enrollment.patient_id as patientId,
          enrollment.managing_clinician_membership_id as managingClinicianMembershipId,
          head.current_version_id as currentVersionId,
          head.lock_version as currentVersion,
          current.status as currentStatus
        from chronic_registry_enrollments enrollment
        join chronic_registry_enrollment_heads head
          on head.organization_id = enrollment.organization_id
          and head.facility_id = enrollment.facility_id
          and head.enrollment_id = enrollment.id
        join chronic_registry_enrollment_versions current
          on current.organization_id = head.organization_id
          and current.facility_id = head.facility_id
          and current.enrollment_id = head.enrollment_id
          and current.id = head.current_version_id
        where enrollment.organization_id = ?1 and enrollment.facility_id = ?2
          and enrollment.id = ?3
          and enrollment.managing_clinician_membership_id = ?4 limit 1`)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        enrollmentId,
        this.scope.membershipId,
      )
      .first<{
        id: string;
        patientId: string;
        managingClinicianMembershipId: string;
        currentVersionId: string;
        currentVersion: number;
        currentStatus: ChronicRegistryStatus;
      }>();
    if (!row) throw new ChronicCareNotFoundError('Chronic enrollment unavailable');
    return row;
  }

  private async getPlanHead(enrollmentId: string) {
    return this.database
      .prepare(`select plan.id as carePlanId,
          head.current_version_id as currentVersionId,
          head.lock_version as version
        from chronic_care_plans plan
        join chronic_care_plan_heads head
          on head.organization_id = plan.organization_id
          and head.facility_id = plan.facility_id
          and head.care_plan_id = plan.id
        where plan.organization_id = ?1 and plan.facility_id = ?2
          and plan.enrollment_id = ?3 limit 1`)
      .bind(this.scope.organizationId, this.scope.facilityId, enrollmentId)
      .first<{ carePlanId: string; currentVersionId: string; version: number }>();
  }

  private async requireValidAssignees(content: SignedCarePlanContent) {
    const result = await this.database
      .prepare(`select id as membershipId, role from memberships
        where organization_id = ?1 and facility_id = ?2
          and status = 'active' and role in ('clinician', 'nurse')`)
      .bind(this.scope.organizationId, this.scope.facilityId)
      .all<{ membershipId: string; role: ChronicTaskOwnerRole }>();
    const roles = new Map(result.results.map((row) => [row.membershipId, row.role]));
    for (const task of content.tasks) {
      if (roles.get(task.assignedMembershipId) !== task.ownerRole) {
        throw new ChronicCareValidationError(
          `Task ${task.key} has an unavailable or mismatched assignee`,
        );
      }
      if (
        task.ownerRole === 'clinician' &&
        task.assignedMembershipId !== this.scope.membershipId
      ) {
        throw new ChronicCareValidationError(
          `Task ${task.key} must be assigned to the managing clinician`,
        );
      }
    }
  }

  private async listOpenTaskRows(carePlanId: string) {
    return this.database
      .prepare(`select task.id, current.id as currentVersionId,
          current.version as currentVersion, current.status as currentStatus,
          current.due_date as dueDate, current.instructions,
          current.contact_method as contactMethod, current.wellbeing,
          current.response_summary as responseSummary,
          current.responded_at as respondedAt
        from chronic_care_tasks task
        join chronic_care_task_heads head
          on head.organization_id = task.organization_id
          and head.facility_id = task.facility_id and head.task_id = task.id
        join chronic_care_task_versions current
          on current.organization_id = head.organization_id
          and current.facility_id = head.facility_id
          and current.task_id = head.task_id and current.id = head.current_version_id
        where task.organization_id = ?1 and task.facility_id = ?2
          and task.care_plan_id = ?3
          and current.status in ('pending', 'in_progress', 'escalated')
        order by task.id`)
      .bind(this.scope.organizationId, this.scope.facilityId, carePlanId)
      .all<{
        id: string;
        currentVersionId: string;
        currentVersion: number;
        currentStatus: ChronicTaskStatus;
        dueDate: string;
        instructions: string | null;
        contactMethod: ContactMethod | null;
        wellbeing: WellbeingState | null;
        responseSummary: string | null;
        respondedAt: number | null;
      }>()
      .then((result) => result.results);
  }

  private async requireVisibleTask(taskId: string) {
    const visibility = this.scope.role === 'clinician'
      ? 'enrollment.managing_clinician_membership_id = ?4'
      : 'task.assigned_membership_id = ?4';
    const row = await this.database
      .prepare(`select task.id, task.enrollment_id as enrollmentId,
          task.care_plan_id as carePlanId,
          task.source_plan_version_id as sourcePlanVersionId,
          task.patient_id as patientId,
          patient.display_name as patientDisplayName,
          patient.medical_record_number as medicalRecordNumber,
          task.blueprint_key as blueprintKey, task.kind, task.title,
          task.owner_role as ownerRole,
          task.assigned_membership_id as assignedMembershipId,
          assigned_user.display_name as assignedTo,
          current.id as currentVersionId, current.version as currentVersion,
          current.status as currentStatus, current.due_date as dueDate,
          current.instructions, current.contact_method as contactMethod,
          current.wellbeing, current.response_summary as responseSummary,
          current.responded_at as respondedAt,
          current.escalation_reason as escalationReason,
          current.escalated_at as escalatedAt,
          current.completed_at as completedAt,
          current.change_reason as changeReason,
          enrollment.managing_clinician_membership_id as managingClinicianMembershipId
        from chronic_care_tasks task
        join chronic_care_task_heads head
          on head.organization_id = task.organization_id
          and head.facility_id = task.facility_id and head.task_id = task.id
        join chronic_care_task_versions current
          on current.organization_id = head.organization_id
          and current.facility_id = head.facility_id
          and current.task_id = head.task_id and current.id = head.current_version_id
        join chronic_registry_enrollments enrollment
          on enrollment.organization_id = task.organization_id
          and enrollment.facility_id = task.facility_id and enrollment.id = task.enrollment_id
        join patients patient
          on patient.organization_id = task.organization_id
          and patient.facility_id = task.facility_id and patient.id = task.patient_id
        join memberships assigned
          on assigned.organization_id = task.organization_id
          and assigned.facility_id = task.facility_id and assigned.id = task.assigned_membership_id
        join users assigned_user on assigned_user.id = assigned.user_id
        where task.organization_id = ?1 and task.facility_id = ?2
          and task.id = ?3 and ${visibility} limit 1`)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        taskId,
        this.scope.membershipId,
      )
      .first<TaskRow>();
    if (!row) throw new ChronicCareNotFoundError('Chronic task unavailable');
    return row;
  }

  private async currentClinicDate(now: number) {
    const facility = await this.database
      .prepare(`select timezone from facilities
        where organization_id = ?1 and id = ?2 limit 1`)
      .bind(this.scope.organizationId, this.scope.facilityId)
      .first<{ timezone: string }>();
    return formatDateInTimeZone(now, facility?.timezone ?? 'Asia/Almaty');
  }

  private async requireCurrentUserDisplayName() {
    const row = await this.database
      .prepare(`select user.display_name as displayName
        from memberships membership join users user on user.id = membership.user_id
        where membership.organization_id = ?1 and membership.facility_id = ?2
          and membership.id = ?3 and membership.status = 'active'
          and user.status = 'active' limit 1`)
      .bind(this.scope.organizationId, this.scope.facilityId, this.scope.membershipId)
      .first<{ displayName: string }>();
    if (!row) throw new ChronicCareNotFoundError('Current user unavailable');
    return row.displayName;
  }

  private async requireAuditHead() {
    const row = await this.database
      .prepare(`select last_sequence as lastSequence,
        last_event_hash as lastEventHash, lock_version as lockVersion
        from audit_stream_heads
        where organization_id = ?1 and facility_id = ?2 limit 1`)
      .bind(this.scope.organizationId, this.scope.facilityId)
      .first<AuditHeadRow>();
    if (!row) throw new ChronicCareAuditUnavailableError();
    return row;
  }

  private async createAudit(input: {
    auditHead: AuditHeadRow;
    action: string;
    entityType: string;
    entityId: string;
    requestId: string;
    metadata: Record<string, unknown>;
    occurredAt: number;
  }) {
    const sequence = input.auditHead.lastSequence + 1;
    const metadataJson = JSON.stringify({
      ...input.metadata,
      accessAssignmentId: this.scope.accessAssignmentId,
    });
    const eventHash = await hashAuditEvent({
      previousHash: input.auditHead.lastEventHash,
      organizationId: this.scope.organizationId,
      facilityId: this.scope.facilityId,
      sequence,
      actorType: 'user',
      actorId: this.scope.userId,
      actorMembershipId: this.scope.membershipId,
      action: input.action,
      outcome: 'succeeded',
      purpose: 'synthetic_chronic_care',
      schemaVersion: 1,
      entityType: input.entityType,
      entityId: input.entityId,
      requestId: input.requestId,
      metadataJson,
      occurredAt: input.occurredAt,
    });
    return {
      ...input,
      id: `audit-${crypto.randomUUID()}`,
      sequence,
      metadataJson,
      eventHash,
    };
  }

  private auditInsert(
    audit: Awaited<ReturnType<D1ChronicCareWorkflowRepository['createAudit']>>,
  ) {
    return this.database.prepare(`insert into audit_events (
      id, organization_id, facility_id, sequence, actor_type, actor_id,
      actor_membership_id, action, outcome, purpose, schema_version,
      entity_type, entity_id, request_id, metadata_json, previous_hash,
      event_hash, occurred_at
    ) values (?1, ?2, ?3, ?4, 'user', ?5, ?6, ?7, 'succeeded',
      'synthetic_chronic_care', 1, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`)
      .bind(
        audit.id,
        this.scope.organizationId,
        this.scope.facilityId,
        audit.sequence,
        this.scope.userId,
        this.scope.membershipId,
        audit.action,
        audit.entityType,
        audit.entityId,
        audit.requestId,
        audit.metadataJson,
        audit.auditHead.lastEventHash,
        audit.eventHash,
        audit.occurredAt,
      );
  }

  private auditHeadUpdate(
    audit: Awaited<ReturnType<D1ChronicCareWorkflowRepository['createAudit']>>,
  ) {
    return this.database.prepare(`update audit_stream_heads
      set last_sequence = ?1, last_event_hash = ?2,
        lock_version = lock_version + 1, updated_at = ?3
      where organization_id = ?4 and facility_id = ?5
        and last_sequence = ?6 and lock_version = ?7
        and exists (select 1 from audit_events where id = ?8)`)
      .bind(
        audit.sequence,
        audit.eventHash,
        audit.occurredAt,
        this.scope.organizationId,
        this.scope.facilityId,
        audit.auditHead.lastSequence,
        audit.auditHead.lockVersion,
        audit.id,
      );
  }

  private async findIdempotency(operation: string, key: string) {
    return this.database
      .prepare(`select id, request_hash as requestHash, status,
        result_resource_id as resultResourceId, response_json as responseJson
        from command_idempotency
        where organization_id = ?1 and facility_id = ?2
          and actor_membership_id = ?3 and access_assignment_id = ?4
          and operation = ?5 and idempotency_key = ?6 limit 1`)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.membershipId,
        this.scope.accessAssignmentId,
        operation,
        key,
      )
      .first<IdempotencyRow>();
  }

  private resolveReplay<T>(replay: IdempotencyRow, requestHash: string): T {
    if (
      replay.requestHash !== requestHash ||
      replay.status !== 'succeeded' ||
      !replay.resultResourceId ||
      !replay.responseJson
    ) {
      throw new ChronicCareConflictError(
        'Idempotency key conflicts with an earlier chronic-care command',
      );
    }
    try {
      const stored = JSON.parse(replay.responseJson) as T & { id?: string };
      if (stored.id !== replay.resultResourceId) throw new Error('Resource mismatch');
      return stored;
    } catch {
      throw new ChronicCareConflictError('Stored chronic-care response is invalid');
    }
  }

  private commandStart(input: {
    id: string;
    operation: string;
    key: string;
    requestHash: string;
    now: number;
  }) {
    return this.database.prepare(`insert into command_idempotency (
      id, organization_id, facility_id, actor_membership_id,
      access_assignment_id, operation, idempotency_key, request_hash, status, created_at
    ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'processing', ?9)`)
      .bind(
        input.id,
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.membershipId,
        this.scope.accessAssignmentId,
        input.operation,
        input.key,
        input.requestHash,
        input.now,
      );
  }

  private commandComplete(input: {
    id: string;
    resourceType: string;
    resourceId: string;
    responseJson: string;
    now: number;
  }) {
    return this.database.prepare(`update command_idempotency
      set status = 'succeeded', result_resource_type = ?1,
        result_resource_id = ?2, response_json = ?3, completed_at = ?4
      where id = ?5 and status = 'processing'`)
      .bind(
        input.resourceType,
        input.resourceId,
        input.responseJson,
        input.now,
        input.id,
      );
  }

  private async commitCommand<T>(input: {
    operation: string;
    key: string;
    requestHash: string;
    resourceType: string;
    resourceId: string;
    response: T;
    action: string;
    entityType: string;
    requestId: string;
    metadata: Record<string, unknown>;
    now: number;
    statements: D1PreparedStatement[];
  }): Promise<T> {
    const existing = await this.findIdempotency(input.operation, input.key);
    if (existing) return this.resolveReplay<T>(existing, input.requestHash);
    const commandId = `command-${crypto.randomUUID()}`;
    const responseJson = JSON.stringify(input.response);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const auditHead = await this.requireAuditHead();
      const audit = await this.createAudit({
        auditHead,
        action: input.action,
        entityType: input.entityType,
        entityId: input.resourceId,
        requestId: input.requestId,
        metadata: input.metadata,
        occurredAt: input.now,
      });
      const statements = [
        this.commandStart({
          id: commandId,
          operation: input.operation,
          key: input.key,
          requestHash: input.requestHash,
          now: input.now,
        }),
        ...input.statements,
        this.auditInsert(audit),
        this.auditHeadUpdate(audit),
        this.commandComplete({
          id: commandId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          responseJson,
          now: input.now,
        }),
      ];
      try {
        const results = await this.database.batch(statements);
        if (
          results.length !== statements.length ||
          results.some((result) => result.meta.changes !== 1)
        ) {
          throw new ChronicCareConflictError(
            'Chronic-care command did not commit atomically',
          );
        }
        return input.response;
      } catch (error) {
        const replay = await this.findIdempotency(input.operation, input.key);
        if (replay?.status === 'succeeded') {
          return this.resolveReplay<T>(replay, input.requestHash);
        }
        const currentAudit = await this.requireAuditHead();
        const contended =
          currentAudit.lastSequence !== auditHead.lastSequence ||
          currentAudit.lockVersion !== auditHead.lockVersion;
        if (contended && attempt < 2) continue;
        throw error;
      }
    }
    throw new ChronicCareAuditUnavailableError();
  }
}
