import type {
  LocalMaterialContextReadInput,
  LocalMaterialContextSnapshotReader,
} from '@/lib/local-materials/server-context';

if (typeof window !== 'undefined') {
  throw new Error('Local material access snapshots are server-only.');
}

const tokenHashPattern = /^[a-f0-9]{64}$/;
const unsafeScalarPattern = /[\p{Cc}\p{Surrogate}]/u;

function isExactIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 &&
    value.trim() === value && !unsafeScalarPattern.test(value);
}

/**
 * Metadata only. This read neither touches a session nor releases a key/material.
 * One SQL statement observes current session, assignment, patient and consent
 * state using the database clock. A later operation must authorize again: the
 * returned snapshot is not an offline lease or permission to publish bytes.
 * Missing/revoked/forbidden scope returns null; database errors propagate.
 */
export class D1LocalMaterialContextRepository implements LocalMaterialContextSnapshotReader {
  constructor(private readonly database: D1Database) {}

  async readSnapshot(input: LocalMaterialContextReadInput): Promise<unknown | null> {
    if (!input || typeof input.tokenHash !== 'string' || input.tokenHash.length !== 64 ||
      !tokenHashPattern.test(input.tokenHash) ||
      ![input.userId, input.issuer, input.subject, input.accessAssignmentId,
        input.facilityId, input.patientId, input.encounterId].every(isExactIdentifier)) {
      return null;
    }

    return this.database.prepare(`
      with database_clock as (
        select cast(unixepoch('subsec') * 1000 as integer) as observed_at
      ), current_scope as (
        select clock.observed_at as observedAt,
          session.id as sessionId, user.id as userId, user.version as userVersion,
          user.external_issuer as issuer, user.external_subject as subject,
          access.assignment_id as accessAssignmentId,
          assignment_version.id as assignmentVersionId,
          assignment_version.version as assignmentVersion,
          access.membership_id as membershipId, member.version as membershipVersion,
          access.organization_id as organizationId, organization.version as organizationVersion,
          access.facility_id as facilityId, facility.version as facilityVersion,
          assignment.department_id as departmentId,
          department_version.id as departmentVersionId,
          department_version.version as departmentVersion,
          patient.id as patientId,
          coalesce(profile.version, patient.version) as patientVersion,
          profile.id as patientVersionId,
          encounter.id as encounterId, encounter.version as encounterVersion,
          encounter.status as encounterStatus, access.can_manage as canManage
        from database_clock clock
        join staff_sessions session on session.token_hash = ?1
          and session.revoked_at is null
          and session.created_at <= clock.observed_at
          and session.idle_expires_at > clock.observed_at
          and session.absolute_expires_at > clock.observed_at
        join users user on user.id = session.user_id and user.status = 'active'
          and user.version = session.user_version
          and user.external_issuer = session.identity_issuer
          and user.external_subject = session.identity_subject
          and user.id = ?2 and user.external_issuer = ?3 and user.external_subject = ?4
        join memberships member on member.user_id = user.id and member.status = 'active'
        join encounter_access_assignment_permissions access
          on access.membership_id = member.id
          and access.organization_id = member.organization_id
          and access.facility_id = member.facility_id
          and access.assignment_id = ?5 and access.facility_id = ?6
          and access.can_read = 1 and access.effective_from <= clock.observed_at
          and (access.effective_until is null or access.effective_until > clock.observed_at)
        join organizations organization on organization.id = access.organization_id
          and organization.status = 'active'
        join facilities facility on facility.id = access.facility_id
          and facility.organization_id = access.organization_id and facility.status = 'active'
        join department_access_assignments assignment
          on assignment.id = access.assignment_id
          and assignment.organization_id = access.organization_id
          and assignment.facility_id = access.facility_id
          and assignment.membership_id = access.membership_id
        join department_access_assignment_heads assignment_head
          on assignment_head.assignment_id = assignment.id
          and assignment_head.organization_id = assignment.organization_id
          and assignment_head.facility_id = assignment.facility_id
          and assignment_head.membership_id = assignment.membership_id
          and assignment_head.department_id = assignment.department_id
        join department_access_assignment_versions assignment_version
          on assignment_version.id = assignment_head.current_version_id
          and assignment_version.assignment_id = assignment_head.assignment_id
          and assignment_version.organization_id = assignment_head.organization_id
          and assignment_version.facility_id = assignment_head.facility_id
          and assignment_version.membership_id = assignment_head.membership_id
          and assignment_version.department_id = assignment_head.department_id
          and assignment_version.version = assignment_head.lock_version
        join department_heads department_head
          on department_head.department_id = assignment.department_id
          and department_head.organization_id = assignment.organization_id
          and department_head.facility_id = assignment.facility_id
        join department_versions department_version
          on department_version.id = department_head.current_version_id
          and department_version.department_id = department_head.department_id
          and department_version.organization_id = department_head.organization_id
          and department_version.facility_id = department_head.facility_id
          and department_version.version = department_head.lock_version
        join encounters encounter on encounter.id = ?8
          and encounter.organization_id = access.organization_id
          and encounter.facility_id = access.facility_id
          and encounter.clinician_membership_id = access.membership_id
        join patients patient on patient.id = ?7 and patient.id = encounter.patient_id
          and patient.organization_id = encounter.organization_id
          and patient.facility_id = encounter.facility_id and patient.status = 'active'
        left join patient_profile_heads profile_head
          on profile_head.patient_id = patient.id
          and profile_head.organization_id = patient.organization_id
          and profile_head.facility_id = patient.facility_id
        left join patient_profile_versions profile
          on profile.id = profile_head.current_version_id
          and profile.organization_id = profile_head.organization_id
          and profile.facility_id = profile_head.facility_id
          and profile.patient_id = profile_head.patient_id
          and profile.version = profile_head.lock_version
        where profile_head.id is null or (profile.id is not null and profile.status = 'active')
      ), current_consents as (
        select head.consent_type as type, event.id as eventId,
          event.version as version, event.decision as decision,
          event.effective_at as effectiveAt, event.expires_at as expiresAt,
          event.policy_version as policyVersion, event.policy_hash as policyHash,
          event.external_processor as externalProcessor,
          case when head.patient_id = scope.patientId and event.id is not null
            then 1 else 0 end as integrity
        from current_scope scope
        join consent_heads head on head.organization_id = scope.organizationId
          and head.facility_id = scope.facilityId and head.encounter_id = scope.encounterId
          and head.consent_type in ('care', 'transient_audio_processing', 'audio_retention',
            'transcript_storage', 'external_ai_processing')
        left join consent_events event on event.id = head.current_consent_event_id
          and event.organization_id = head.organization_id
          and event.facility_id = head.facility_id and event.patient_id = head.patient_id
          and event.encounter_id = head.encounter_id and event.consent_type = head.consent_type
          and event.version = head.lock_version
      )
      select scope.*,
        case when exists (select 1 from current_consents where integrity = 0)
          then 0 else 1 end as consentsIntegrity,
        (select json_group_array(json_object(
          'type', type, 'eventId', eventId, 'version', version, 'decision', decision,
          'effectiveAt', effectiveAt, 'expiresAt', expiresAt,
          'policyVersion', policyVersion, 'policyHash', policyHash,
          'externalProcessor', externalProcessor
        )) from (select * from current_consents where integrity = 1 order by type)) as consentsJson
      from current_scope scope
    `).bind(input.tokenHash, input.userId, input.issuer, input.subject,
      input.accessAssignmentId, input.facilityId, input.patientId, input.encounterId).first();
  }
}
