import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

const enumCheck = (
  name: string,
  column: AnySQLiteColumn,
  values: readonly string[],
) =>
  check(
    name,
    sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`,
  );

const jsonCheck = (name: string, column: AnySQLiteColumn, nullable = false) =>
  check(
    name,
    nullable
      ? sql`${column} is null or json_valid(${column})`
      : sql`json_valid(${column})`,
  );

export const organizations = sqliteTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    status: text('status', { enum: ['active', 'suspended'] })
      .notNull()
      .default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    enumCheck('organizations_status_enum', table.status, ['active', 'suspended']),
    check('organizations_version_positive', sql`${table.version} > 0`),
  ],
);

export const facilities = sqliteTable(
  'facilities',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('Asia/Almaty'),
    status: text('status', { enum: ['active', 'suspended'] })
      .notNull()
      .default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('facilities_organization_idx').on(table.organizationId),
    uniqueIndex('facilities_scope_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('facilities_org_name_uidx').on(
      table.organizationId,
      table.name,
    ),
    enumCheck('facilities_status_enum', table.status, ['active', 'suspended']),
    check('facilities_version_positive', sql`${table.version} > 0`),
  ],
);

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    externalIssuer: text('external_issuer').notNull(),
    externalSubject: text('external_subject').notNull(),
    emailNormalized: text('email_normalized'),
    displayName: text('display_name').notNull(),
    status: text('status', { enum: ['invited', 'active', 'disabled'] })
      .notNull()
      .default('invited'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('users_issuer_subject_uidx').on(
      table.externalIssuer,
      table.externalSubject,
    ),
    index('users_email_normalized_idx').on(table.emailNormalized),
    enumCheck('users_status_enum', table.status, [
      'invited',
      'active',
      'disabled',
    ]),
    check('users_version_positive', sql`${table.version} > 0`),
  ],
);

export const memberships = sqliteTable(
  'memberships',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    facilityId: text('facility_id')
      .notNull()
      .references(() => facilities.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', {
      enum: ['clinician', 'nurse', 'registrar', 'administrator', 'auditor'],
    }).notNull(),
    status: text('status', { enum: ['active', 'disabled'] })
      .notNull()
      .default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('memberships_scope_user_uidx').on(
      table.organizationId,
      table.facilityId,
      table.userId,
    ),
    index('memberships_user_idx').on(table.userId),
    uniqueIndex('memberships_scope_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.id,
    ),
    uniqueIndex('memberships_scope_id_user_uidx').on(
      table.organizationId,
      table.facilityId,
      table.id,
      table.userId,
    ),
    foreignKey({
      name: 'memberships_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    enumCheck('memberships_role_enum', table.role, [
      'clinician',
      'nurse',
      'registrar',
      'administrator',
      'auditor',
    ]),
    enumCheck('memberships_status_enum', table.status, ['active', 'disabled']),
    check('memberships_version_positive', sql`${table.version} > 0`),
  ],
);

const tenantScope = () => ({
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  facilityId: text('facility_id')
    .notNull()
    .references(() => facilities.id),
});

export const patients = sqliteTable(
  'patients',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    medicalRecordNumber: text('medical_record_number').notNull(),
    displayName: text('display_name').notNull(),
    birthDate: text('birth_date'),
    sexAtBirth: text('sex_at_birth', {
      enum: ['female', 'male', 'unknown', 'not_recorded'],
    })
      .notNull()
      .default('not_recorded'),
    status: text('status', { enum: ['active', 'inactive', 'merged'] })
      .notNull()
      .default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('patients_scope_mrn_uidx').on(
      table.organizationId,
      table.facilityId,
      table.medicalRecordNumber,
    ),
    index('patients_scope_name_idx').on(
      table.organizationId,
      table.facilityId,
      table.displayName,
    ),
    uniqueIndex('patients_scope_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.id,
    ),
    foreignKey({
      name: 'patients_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    enumCheck('patients_sex_at_birth_enum', table.sexAtBirth, [
      'female',
      'male',
      'unknown',
      'not_recorded',
    ]),
    enumCheck('patients_status_enum', table.status, [
      'active',
      'inactive',
      'merged',
    ]),
    check('patients_version_positive', sql`${table.version} > 0`),
  ],
);

export const patientProfileVersions = sqliteTable(
  'patient_profile_versions',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id),
    version: integer('version').notNull(),
    displayName: text('display_name').notNull(),
    birthDate: text('birth_date'),
    sexAtBirth: text('sex_at_birth', {
      enum: ['female', 'male', 'unknown', 'not_recorded'],
    })
      .notNull()
      .default('not_recorded'),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    status: text('status', { enum: ['active', 'inactive', 'merged'] })
      .notNull()
      .default('active'),
    createdByMembershipId: text('created_by_membership_id')
      .notNull()
      .references(() => memberships.id),
    changeReason: text('change_reason').notNull(),
    supersedesProfileVersionId: text(
      'supersedes_profile_version_id',
    ).references((): AnySQLiteColumn => patientProfileVersions.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('patient_profile_versions_scope_patient_version_uidx').on(
      table.organizationId,
      table.facilityId,
      table.patientId,
      table.version,
    ),
    uniqueIndex('patient_profile_versions_scope_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.patientId,
      table.id,
    ),
    uniqueIndex('patient_profile_versions_supersedes_once_uidx').on(
      table.supersedesProfileVersionId,
    ),
    foreignKey({
      name: 'patient_profile_versions_scope_patient_fk',
      columns: [table.organizationId, table.facilityId, table.patientId],
      foreignColumns: [
        patients.organizationId,
        patients.facilityId,
        patients.id,
      ],
    }),
    foreignKey({
      name: 'patient_profile_versions_scope_actor_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.createdByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    check('patient_profile_versions_version_positive', sql`${table.version} > 0`),
    check(
      'patient_profile_versions_change_reason_present',
      sql`length(trim(${table.changeReason})) > 0`,
    ),
    enumCheck('patient_profile_versions_sex_at_birth_enum', table.sexAtBirth, [
      'female',
      'male',
      'unknown',
      'not_recorded',
    ]),
    enumCheck('patient_profile_versions_status_enum', table.status, [
      'active',
      'inactive',
      'merged',
    ]),
  ],
);

export const patientProfileHeads = sqliteTable(
  'patient_profile_heads',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id),
    currentVersionId: text('current_version_id')
      .notNull()
      .references(() => patientProfileVersions.id),
    lockVersion: integer('lock_version').notNull().default(1),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('patient_profile_heads_scope_patient_uidx').on(
      table.organizationId,
      table.facilityId,
      table.patientId,
    ),
    foreignKey({
      name: 'patient_profile_heads_scope_patient_fk',
      columns: [table.organizationId, table.facilityId, table.patientId],
      foreignColumns: [
        patients.organizationId,
        patients.facilityId,
        patients.id,
      ],
    }),
    foreignKey({
      name: 'patient_profile_heads_scope_current_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.patientId,
        table.currentVersionId,
      ],
      foreignColumns: [
        patientProfileVersions.organizationId,
        patientProfileVersions.facilityId,
        patientProfileVersions.patientId,
        patientProfileVersions.id,
      ],
    }),
    check('patient_profile_heads_lock_positive', sql`${table.lockVersion} > 0`),
  ],
);

export const patientIdentifiers = sqliteTable(
  'patient_identifiers',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id),
    kind: text('kind', { enum: ['test_iin', 'other'] }).notNull(),
    normalizedValue: text('normalized_value').notNull(),
    displayLast4: text('display_last4').notNull(),
    status: text('status', { enum: ['active', 'revoked'] })
      .notNull()
      .default('active'),
    createdByMembershipId: text('created_by_membership_id')
      .notNull()
      .references(() => memberships.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('patient_identifiers_scope_active_value_uidx')
      .on(
        table.organizationId,
        table.facilityId,
        table.kind,
        table.normalizedValue,
      )
      .where(sql`${table.status} = 'active'`),
    index('patient_identifiers_scope_patient_idx').on(
      table.organizationId,
      table.facilityId,
      table.patientId,
      table.status,
    ),
    foreignKey({
      name: 'patient_identifiers_scope_patient_fk',
      columns: [table.organizationId, table.facilityId, table.patientId],
      foreignColumns: [
        patients.organizationId,
        patients.facilityId,
        patients.id,
      ],
    }),
    foreignKey({
      name: 'patient_identifiers_scope_actor_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.createdByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    enumCheck('patient_identifiers_kind_enum', table.kind, ['test_iin', 'other']),
    enumCheck('patient_identifiers_status_enum', table.status, [
      'active',
      'revoked',
    ]),
    check('patient_identifiers_version_positive', sql`${table.version} > 0`),
  ],
);

export const patientPhotoAssets = sqliteTable(
  'patient_photo_assets',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id),
    objectKey: text('object_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sha256: text('sha256').notNull(),
    byteSize: integer('byte_size').notNull(),
    status: text('status', { enum: ['ready', 'deleted'] })
      .notNull()
      .default('ready'),
    createdByMembershipId: text('created_by_membership_id')
      .notNull()
      .references(() => memberships.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('patient_photo_assets_scope_object_uidx').on(
      table.organizationId,
      table.facilityId,
      table.objectKey,
    ),
    uniqueIndex('patient_photo_assets_scope_patient_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.patientId,
      table.id,
    ),
    foreignKey({
      name: 'patient_photo_assets_scope_patient_fk',
      columns: [table.organizationId, table.facilityId, table.patientId],
      foreignColumns: [
        patients.organizationId,
        patients.facilityId,
        patients.id,
      ],
    }),
    foreignKey({
      name: 'patient_photo_assets_scope_actor_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.createdByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    check('patient_photo_assets_byte_size_valid', sql`${table.byteSize} > 0`),
    check('patient_photo_assets_version_positive', sql`${table.version} > 0`),
    enumCheck('patient_photo_assets_status_enum', table.status, [
      'ready',
      'deleted',
    ]),
  ],
);

export const patientPhotoHeads = sqliteTable(
  'patient_photo_heads',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id),
    currentPhotoAssetId: text('current_photo_asset_id')
      .notNull()
      .references(() => patientPhotoAssets.id),
    lockVersion: integer('lock_version').notNull().default(1),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('patient_photo_heads_scope_patient_uidx').on(
      table.organizationId,
      table.facilityId,
      table.patientId,
    ),
    foreignKey({
      name: 'patient_photo_heads_scope_patient_fk',
      columns: [table.organizationId, table.facilityId, table.patientId],
      foreignColumns: [
        patients.organizationId,
        patients.facilityId,
        patients.id,
      ],
    }),
    foreignKey({
      name: 'patient_photo_heads_scope_asset_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.patientId,
        table.currentPhotoAssetId,
      ],
      foreignColumns: [
        patientPhotoAssets.organizationId,
        patientPhotoAssets.facilityId,
        patientPhotoAssets.patientId,
        patientPhotoAssets.id,
      ],
    }),
    check('patient_photo_heads_lock_positive', sql`${table.lockVersion} > 0`),
  ],
);

export const encounters = sqliteTable(
  'encounters',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id),
    clinicianMembershipId: text('clinician_membership_id')
      .notNull()
      .references(() => memberships.id),
    status: text('status', {
      enum: [
        'draft',
        'ready',
        'in_progress',
        'review',
        'finalized',
        'amended',
        'cancelled',
      ],
    })
      .notNull()
      .default('draft'),
    reasonForVisit: text('reason_for_visit'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
    finalizedAt: integer('finalized_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('encounters_scope_status_idx').on(
      table.organizationId,
      table.facilityId,
      table.status,
    ),
    index('encounters_patient_started_idx').on(
      table.patientId,
      table.startedAt,
    ),
    index('encounters_clinician_status_idx').on(
      table.clinicianMembershipId,
      table.status,
    ),
    uniqueIndex('encounters_scope_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.id,
    ),
    foreignKey({
      name: 'encounters_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'encounters_scope_patient_fk',
      columns: [table.organizationId, table.facilityId, table.patientId],
      foreignColumns: [
        patients.organizationId,
        patients.facilityId,
        patients.id,
      ],
    }),
    foreignKey({
      name: 'encounters_scope_clinician_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.clinicianMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    enumCheck('encounters_status_enum', table.status, [
      'draft',
      'ready',
      'in_progress',
      'review',
      'finalized',
      'amended',
      'cancelled',
    ]),
    check('encounters_version_positive', sql`${table.version} > 0`),
    check(
      'encounters_timing_valid',
      sql`${table.endedAt} is null or (${table.startedAt} is not null and ${table.endedAt} >= ${table.startedAt})`,
    ),
    check(
      'encounters_finalization_valid',
      sql`${table.finalizedAt} is null or ${table.status} in ('finalized', 'amended')`,
    ),
  ],
);

export const serviceRequests = sqliteTable(
  'service_requests',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id),
    requestKind: text('request_kind', {
      enum: ['laboratory', 'ecg', 'service', 'referral'],
    }).notNull(),
    createdByMembershipId: text('created_by_membership_id')
      .notNull()
      .references(() => memberships.id),
    createdAt: createdAt(),
  },
  (table) => [
    index('service_requests_encounter_idx').on(
      table.organizationId,
      table.facilityId,
      table.encounterId,
    ),
    index('service_requests_patient_idx').on(
      table.organizationId,
      table.facilityId,
      table.patientId,
    ),
    uniqueIndex('service_requests_scope_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.id,
    ),
    foreignKey({
      name: 'service_requests_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'service_requests_scope_patient_fk',
      columns: [table.organizationId, table.facilityId, table.patientId],
      foreignColumns: [
        patients.organizationId,
        patients.facilityId,
        patients.id,
      ],
    }),
    foreignKey({
      name: 'service_requests_scope_encounter_fk',
      columns: [table.organizationId, table.facilityId, table.encounterId],
      foreignColumns: [
        encounters.organizationId,
        encounters.facilityId,
        encounters.id,
      ],
    }),
    foreignKey({
      name: 'service_requests_scope_creator_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.createdByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    enumCheck('service_requests_kind_enum', table.requestKind, [
      'laboratory',
      'ecg',
      'service',
      'referral',
    ]),
  ],
);

export const serviceRequestVersions = sqliteTable(
  'service_request_versions',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    serviceRequestId: text('service_request_id')
      .notNull()
      .references(() => serviceRequests.id),
    version: integer('version').notNull(),
    supersedesVersionId: text('supersedes_version_id').references(
      (): AnySQLiteColumn => serviceRequestVersions.id,
    ),
    status: text('status', {
      enum: [
        'draft',
        'active',
        'on_hold',
        'revoked',
        'completed',
        'entered_in_error',
      ],
    }).notNull(),
    priority: text('priority', {
      enum: ['routine', 'urgent', 'asap', 'stat'],
    }).notNull(),
    requestedService: text('requested_service').notNull(),
    targetSpecialty: text('target_specialty'),
    medicalJustification: text('medical_justification').notNull(),
    clinicianNote: text('clinician_note'),
    statusReason: text('status_reason'),
    authoredByMembershipId: text('authored_by_membership_id')
      .notNull()
      .references(() => memberships.id),
    approvedByMembershipId: text('approved_by_membership_id').references(
      () => memberships.id,
    ),
    approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('service_request_versions_scope_request_version_uidx').on(
      table.organizationId,
      table.facilityId,
      table.serviceRequestId,
      table.version,
    ),
    uniqueIndex('service_request_versions_scope_request_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.serviceRequestId,
      table.id,
    ),
    uniqueIndex('service_request_versions_supersedes_once_uidx').on(
      table.supersedesVersionId,
    ),
    foreignKey({
      name: 'service_request_versions_scope_request_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.serviceRequestId,
      ],
      foreignColumns: [
        serviceRequests.organizationId,
        serviceRequests.facilityId,
        serviceRequests.id,
      ],
    }),
    foreignKey({
      name: 'service_request_versions_scope_author_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.authoredByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    foreignKey({
      name: 'service_request_versions_scope_approver_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.approvedByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    enumCheck('service_request_versions_status_enum', table.status, [
      'draft',
      'active',
      'on_hold',
      'revoked',
      'completed',
      'entered_in_error',
    ]),
    enumCheck('service_request_versions_priority_enum', table.priority, [
      'routine',
      'urgent',
      'asap',
      'stat',
    ]),
    check('service_request_versions_version_positive', sql`${table.version} > 0`),
    check(
      'service_request_versions_initial_predecessor',
      sql`(${table.version} = 1 and ${table.supersedesVersionId} is null) or (${table.version} > 1 and ${table.supersedesVersionId} is not null)`,
    ),
    check(
      'service_request_versions_service_length',
      sql`length(trim(${table.requestedService})) between 2 and 300`,
    ),
    check(
      'service_request_versions_justification_length',
      sql`length(trim(${table.medicalJustification})) between 10 and 2000`,
    ),
    check(
      'service_request_versions_draft_not_approved',
      sql`${table.status} <> 'draft' or (${table.approvedByMembershipId} is null and ${table.approvedAt} is null)`,
    ),
    check(
      'service_request_versions_active_approved',
      sql`${table.status} not in ('active', 'on_hold', 'completed') or (${table.approvedByMembershipId} is not null and ${table.approvedAt} is not null)`,
    ),
  ],
);

export const serviceRequestHeads = sqliteTable(
  'service_request_heads',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    serviceRequestId: text('service_request_id')
      .notNull()
      .references(() => serviceRequests.id),
    currentVersionId: text('current_version_id')
      .notNull()
      .references(() => serviceRequestVersions.id),
    lockVersion: integer('lock_version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('service_request_heads_scope_request_uidx').on(
      table.organizationId,
      table.facilityId,
      table.serviceRequestId,
    ),
    uniqueIndex('service_request_heads_scope_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.id,
    ),
    foreignKey({
      name: 'service_request_heads_scope_request_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.serviceRequestId,
      ],
      foreignColumns: [
        serviceRequests.organizationId,
        serviceRequests.facilityId,
        serviceRequests.id,
      ],
    }),
    foreignKey({
      name: 'service_request_heads_scope_current_version_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.serviceRequestId,
        table.currentVersionId,
      ],
      foreignColumns: [
        serviceRequestVersions.organizationId,
        serviceRequestVersions.facilityId,
        serviceRequestVersions.serviceRequestId,
        serviceRequestVersions.id,
      ],
    }),
    check('service_request_heads_lock_positive', sql`${table.lockVersion} > 0`),
  ],
);

export const diagnosticReports = sqliteTable(
  'diagnostic_reports',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    serviceRequestId: text('service_request_id')
      .notNull()
      .references(() => serviceRequests.id),
    createdByMembershipId: text('created_by_membership_id')
      .notNull()
      .references(() => memberships.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('diagnostic_reports_scope_request_uidx').on(
      table.organizationId,
      table.facilityId,
      table.serviceRequestId,
    ),
    uniqueIndex('diagnostic_reports_scope_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.id,
    ),
    uniqueIndex('diagnostic_reports_scope_request_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.serviceRequestId,
      table.id,
    ),
    foreignKey({
      name: 'diagnostic_reports_scope_request_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.serviceRequestId,
      ],
      foreignColumns: [
        serviceRequests.organizationId,
        serviceRequests.facilityId,
        serviceRequests.id,
      ],
    }),
    foreignKey({
      name: 'diagnostic_reports_scope_creator_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.createdByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
  ],
);

export const diagnosticReportArtifacts = sqliteTable(
  'diagnostic_report_artifacts',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    serviceRequestId: text('service_request_id')
      .notNull()
      .references(() => serviceRequests.id),
    diagnosticReportId: text('diagnostic_report_id')
      .notNull()
      .references(() => diagnosticReports.id),
    objectKey: text('object_key').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type', {
      enum: ['application/pdf', 'image/jpeg', 'image/png'],
    }).notNull(),
    sha256: text('sha256').notNull(),
    byteSize: integer('byte_size').notNull(),
    source: text('source', { enum: ['manual_upload'] })
      .notNull()
      .default('manual_upload'),
    createdByMembershipId: text('created_by_membership_id')
      .notNull()
      .references(() => memberships.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('diagnostic_report_artifacts_scope_object_uidx').on(
      table.organizationId,
      table.facilityId,
      table.objectKey,
    ),
    uniqueIndex('diagnostic_report_artifacts_scope_report_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.diagnosticReportId,
      table.id,
    ),
    index('diagnostic_report_artifacts_request_idx').on(
      table.organizationId,
      table.facilityId,
      table.serviceRequestId,
    ),
    foreignKey({
      name: 'diagnostic_report_artifacts_scope_request_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.serviceRequestId,
      ],
      foreignColumns: [
        serviceRequests.organizationId,
        serviceRequests.facilityId,
        serviceRequests.id,
      ],
    }),
    foreignKey({
      name: 'diagnostic_report_artifacts_scope_report_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.serviceRequestId,
        table.diagnosticReportId,
      ],
      foreignColumns: [
        diagnosticReports.organizationId,
        diagnosticReports.facilityId,
        diagnosticReports.serviceRequestId,
        diagnosticReports.id,
      ],
    }),
    foreignKey({
      name: 'diagnostic_report_artifacts_scope_creator_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.createdByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    enumCheck('diagnostic_report_artifacts_mime_enum', table.mimeType, [
      'application/pdf',
      'image/jpeg',
      'image/png',
    ]),
    enumCheck('diagnostic_report_artifacts_source_enum', table.source, [
      'manual_upload',
    ]),
    check('diagnostic_report_artifacts_sha256_length', sql`length(${table.sha256}) = 64`),
    check('diagnostic_report_artifacts_size_positive', sql`${table.byteSize} > 0`),
    check(
      'diagnostic_report_artifacts_file_name_length',
      sql`length(trim(${table.fileName})) between 1 and 180`,
    ),
  ],
);

export const diagnosticReportVersions = sqliteTable(
  'diagnostic_report_versions',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    serviceRequestId: text('service_request_id')
      .notNull()
      .references(() => serviceRequests.id),
    diagnosticReportId: text('diagnostic_report_id')
      .notNull()
      .references(() => diagnosticReports.id),
    version: integer('version').notNull(),
    supersedesVersionId: text('supersedes_version_id').references(
      (): AnySQLiteColumn => diagnosticReportVersions.id,
    ),
    reportStatus: text('report_status', {
      enum: [
        'registered',
        'preliminary',
        'final',
        'amended',
        'corrected',
        'cancelled',
        'entered_in_error',
      ],
    }).notNull(),
    conclusion: text('conclusion'),
    artifactId: text('artifact_id').references(() => diagnosticReportArtifacts.id),
    reviewState: text('review_state', {
      enum: ['pending', 'reviewed', 'needs_reconciliation'],
    })
      .notNull()
      .default('pending'),
    reconciliationNote: text('reconciliation_note'),
    changeReason: text('change_reason').notNull(),
    createdByMembershipId: text('created_by_membership_id')
      .notNull()
      .references(() => memberships.id),
    reviewedByMembershipId: text('reviewed_by_membership_id').references(
      () => memberships.id,
    ),
    reviewedAt: integer('reviewed_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('diagnostic_report_versions_scope_report_version_uidx').on(
      table.organizationId,
      table.facilityId,
      table.diagnosticReportId,
      table.version,
    ),
    uniqueIndex('diagnostic_report_versions_scope_report_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.diagnosticReportId,
      table.id,
    ),
    uniqueIndex('diagnostic_report_versions_supersedes_once_uidx').on(
      table.supersedesVersionId,
    ),
    foreignKey({
      name: 'diagnostic_report_versions_scope_report_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.serviceRequestId,
        table.diagnosticReportId,
      ],
      foreignColumns: [
        diagnosticReports.organizationId,
        diagnosticReports.facilityId,
        diagnosticReports.serviceRequestId,
        diagnosticReports.id,
      ],
    }),
    foreignKey({
      name: 'diagnostic_report_versions_scope_artifact_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.diagnosticReportId,
        table.artifactId,
      ],
      foreignColumns: [
        diagnosticReportArtifacts.organizationId,
        diagnosticReportArtifacts.facilityId,
        diagnosticReportArtifacts.diagnosticReportId,
        diagnosticReportArtifacts.id,
      ],
    }),
    foreignKey({
      name: 'diagnostic_report_versions_scope_creator_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.createdByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    foreignKey({
      name: 'diagnostic_report_versions_scope_reviewer_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.reviewedByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    enumCheck('diagnostic_report_versions_status_enum', table.reportStatus, [
      'registered',
      'preliminary',
      'final',
      'amended',
      'corrected',
      'cancelled',
      'entered_in_error',
    ]),
    enumCheck('diagnostic_report_versions_review_enum', table.reviewState, [
      'pending',
      'reviewed',
      'needs_reconciliation',
    ]),
    check('diagnostic_report_versions_version_positive', sql`${table.version} > 0`),
    check(
      'diagnostic_report_versions_initial_predecessor',
      sql`(${table.version} = 1 and ${table.supersedesVersionId} is null) or (${table.version} > 1 and ${table.supersedesVersionId} is not null)`,
    ),
    check(
      'diagnostic_report_versions_review_consistent',
      sql`(${table.reviewState} = 'pending' and ${table.reviewedByMembershipId} is null and ${table.reviewedAt} is null) or (${table.reviewState} <> 'pending' and ${table.reviewedByMembershipId} is not null and ${table.reviewedAt} is not null)`,
    ),
    check(
      'diagnostic_report_versions_reconciliation_note',
      sql`${table.reviewState} <> 'needs_reconciliation' or length(trim(${table.reconciliationNote})) between 3 and 1000`,
    ),
    check(
      'diagnostic_report_versions_change_reason',
      sql`length(trim(${table.changeReason})) between 3 and 500`,
    ),
  ],
);

export const diagnosticReportHeads = sqliteTable(
  'diagnostic_report_heads',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    serviceRequestId: text('service_request_id')
      .notNull()
      .references(() => serviceRequests.id),
    diagnosticReportId: text('diagnostic_report_id')
      .notNull()
      .references(() => diagnosticReports.id),
    currentVersionId: text('current_version_id')
      .notNull()
      .references(() => diagnosticReportVersions.id),
    lockVersion: integer('lock_version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('diagnostic_report_heads_scope_report_uidx').on(
      table.organizationId,
      table.facilityId,
      table.diagnosticReportId,
    ),
    uniqueIndex('diagnostic_report_heads_scope_request_uidx').on(
      table.organizationId,
      table.facilityId,
      table.serviceRequestId,
    ),
    foreignKey({
      name: 'diagnostic_report_heads_scope_report_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.serviceRequestId,
        table.diagnosticReportId,
      ],
      foreignColumns: [
        diagnosticReports.organizationId,
        diagnosticReports.facilityId,
        diagnosticReports.serviceRequestId,
        diagnosticReports.id,
      ],
    }),
    foreignKey({
      name: 'diagnostic_report_heads_scope_current_version_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.diagnosticReportId,
        table.currentVersionId,
      ],
      foreignColumns: [
        diagnosticReportVersions.organizationId,
        diagnosticReportVersions.facilityId,
        diagnosticReportVersions.diagnosticReportId,
        diagnosticReportVersions.id,
      ],
    }),
    check('diagnostic_report_heads_lock_positive', sql`${table.lockVersion} > 0`),
  ],
);

export const consentEvents = sqliteTable(
  'consent_events',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id),
    encounterId: text('encounter_id').references(() => encounters.id),
    version: integer('version').notNull().default(1),
    consentType: text('consent_type', {
      enum: [
        'care',
        'transient_audio_processing',
        'audio_retention',
        'transcript_storage',
        'external_ai_processing',
        'data_exchange',
        'notifications',
      ],
    }).notNull(),
    decision: text('decision', { enum: ['granted', 'denied', 'withdrawn'] })
      .notNull(),
    capturedByMembershipId: text('captured_by_membership_id')
      .notNull()
      .references(() => memberships.id),
    policyVersion: text('policy_version').notNull(),
    policyHash: text('policy_hash').notNull(),
    noticeLanguage: text('notice_language', { enum: ['ru', 'kk'] }).notNull(),
    externalProcessor: text('external_processor'),
    evidenceObjectKey: text('evidence_object_key'),
    source: text('source', { enum: ['written', 'verbal', 'digital'] }).notNull(),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    effectiveAt: integer('effective_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    supersedesConsentEventId: text('supersedes_consent_event_id').references(
      (): AnySQLiteColumn => consentEvents.id,
    ),
    createdAt: createdAt(),
  },
  (table) => [
    index('consent_patient_type_time_idx').on(
      table.patientId,
      table.consentType,
      table.occurredAt,
    ),
    index('consent_encounter_idx').on(table.encounterId),
    uniqueIndex('consent_scope_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.id,
    ),
    uniqueIndex('consent_scope_subject_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.patientId,
      table.consentType,
      table.id,
    ),
    uniqueIndex('consent_scope_encounter_version_uidx').on(
      table.organizationId,
      table.facilityId,
      table.patientId,
      table.encounterId,
      table.consentType,
      table.version,
    ),
    uniqueIndex('consent_scope_encounter_event_uidx').on(
      table.organizationId,
      table.facilityId,
      table.patientId,
      table.encounterId,
      table.consentType,
      table.id,
    ),
    uniqueIndex('consent_supersedes_once_uidx').on(
      table.supersedesConsentEventId,
    ),
    foreignKey({
      name: 'consent_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'consent_scope_patient_fk',
      columns: [table.organizationId, table.facilityId, table.patientId],
      foreignColumns: [
        patients.organizationId,
        patients.facilityId,
        patients.id,
      ],
    }),
    foreignKey({
      name: 'consent_scope_encounter_fk',
      columns: [table.organizationId, table.facilityId, table.encounterId],
      foreignColumns: [
        encounters.organizationId,
        encounters.facilityId,
        encounters.id,
      ],
    }),
    foreignKey({
      name: 'consent_scope_captured_by_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.capturedByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    check(
      'consent_withdrawal_has_source',
      sql`${table.decision} <> 'withdrawn' or ${table.supersedesConsentEventId} is not null`,
    ),
    check(
      'consent_expiry_valid',
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.effectiveAt}`,
    ),
    check('consent_version_positive', sql`${table.version} > 0`),
    enumCheck('consent_type_enum', table.consentType, [
      'care',
      'transient_audio_processing',
      'audio_retention',
      'transcript_storage',
      'external_ai_processing',
      'data_exchange',
      'notifications',
    ]),
    enumCheck('consent_decision_enum', table.decision, [
      'granted',
      'denied',
      'withdrawn',
    ]),
    enumCheck('consent_notice_language_enum', table.noticeLanguage, ['ru', 'kk']),
    enumCheck('consent_source_enum', table.source, [
      'written',
      'verbal',
      'digital',
    ]),
  ],
);

export const consentHeads = sqliteTable(
  'consent_heads',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id),
    consentType: text('consent_type', {
      enum: [
        'care',
        'transient_audio_processing',
        'audio_retention',
        'transcript_storage',
        'external_ai_processing',
        'data_exchange',
        'notifications',
      ],
    }).notNull(),
    currentConsentEventId: text('current_consent_event_id')
      .notNull()
      .references(() => consentEvents.id),
    lockVersion: integer('lock_version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('consent_heads_scope_subject_type_uidx').on(
      table.organizationId,
      table.facilityId,
      table.patientId,
      table.encounterId,
      table.consentType,
    ),
    uniqueIndex('consent_heads_scope_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.id,
    ),
    foreignKey({
      name: 'consent_heads_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'consent_heads_scope_patient_fk',
      columns: [table.organizationId, table.facilityId, table.patientId],
      foreignColumns: [
        patients.organizationId,
        patients.facilityId,
        patients.id,
      ],
    }),
    foreignKey({
      name: 'consent_heads_scope_encounter_fk',
      columns: [table.organizationId, table.facilityId, table.encounterId],
      foreignColumns: [
        encounters.organizationId,
        encounters.facilityId,
        encounters.id,
      ],
    }),
    foreignKey({
      name: 'consent_heads_scope_current_event_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.patientId,
        table.encounterId,
        table.consentType,
        table.currentConsentEventId,
      ],
      foreignColumns: [
        consentEvents.organizationId,
        consentEvents.facilityId,
        consentEvents.patientId,
        consentEvents.encounterId,
        consentEvents.consentType,
        consentEvents.id,
      ],
    }),
    enumCheck('consent_heads_type_enum', table.consentType, [
      'care',
      'transient_audio_processing',
      'audio_retention',
      'transcript_storage',
      'external_ai_processing',
      'data_exchange',
      'notifications',
    ]),
    check('consent_heads_lock_positive', sql`${table.lockVersion} > 0`),
  ],
);

export const transcriptionRuns = sqliteTable(
  'transcription_runs',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id),
    upstreamSessionId: text('upstream_session_id').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    modelVersion: text('model_version').notNull(),
    policyVersion: text('policy_version').notNull(),
    consentEventIdsJson: text('consent_event_ids_json', { mode: 'json' })
      .$type<string[]>()
      .notNull(),
    status: text('status', {
      enum: ['running', 'completed', 'failed', 'cancelled'],
    })
      .notNull()
      .default('running'),
    nextUtteranceIndex: integer('next_utterance_index').notNull().default(0),
    startedByMembershipId: text('started_by_membership_id')
      .notNull()
      .references(() => memberships.id),
    requestId: text('request_id').notNull(),
    errorCode: text('error_code'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('transcription_runs_encounter_status_idx').on(
      table.encounterId,
      table.status,
    ),
    uniqueIndex('transcription_runs_scope_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.id,
    ),
    uniqueIndex('transcription_runs_scope_encounter_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.encounterId,
      table.id,
    ),
    uniqueIndex('transcription_runs_scope_upstream_uidx').on(
      table.organizationId,
      table.facilityId,
      table.upstreamSessionId,
    ),
    foreignKey({
      name: 'transcription_runs_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'transcription_runs_scope_encounter_fk',
      columns: [table.organizationId, table.facilityId, table.encounterId],
      foreignColumns: [
        encounters.organizationId,
        encounters.facilityId,
        encounters.id,
      ],
    }),
    foreignKey({
      name: 'transcription_runs_scope_actor_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.startedByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    enumCheck('transcription_runs_status_enum', table.status, [
      'running',
      'completed',
      'failed',
      'cancelled',
    ]),
    jsonCheck('transcription_runs_consent_events_json', table.consentEventIdsJson),
    check(
      'transcription_runs_next_utterance_nonnegative',
      sql`${table.nextUtteranceIndex} >= 0`,
    ),
    check(
      'transcription_runs_completion_valid',
      sql`${table.completedAt} is null or ${table.completedAt} >= ${table.startedAt}`,
    ),
  ],
);

export const transcriptSegments = sqliteTable(
  'transcript_segments',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id),
    segmentIndex: integer('segment_index').notNull(),
    version: integer('version').notNull().default(1),
    speakerRole: text('speaker_role', {
      enum: ['doctor', 'patient', 'other', 'unknown'],
    })
      .notNull()
      .default('unknown'),
    speakerRoleSource: text('speaker_role_source', {
      enum: ['unassigned', 'model', 'voice_calibration', 'manual'],
    })
      .notNull()
      .default('unassigned'),
    speakerConfidence: integer('speaker_confidence_basis_points'),
    languageCode: text('language_code', {
      enum: ['ru', 'kk', 'mixed', 'unknown'],
    })
      .notNull()
      .default('unknown'),
    text: text('text').notNull(),
    startedAtMs: integer('started_at_ms').notNull(),
    endedAtMs: integer('ended_at_ms').notNull(),
    state: text('state', { enum: ['provisional', 'final', 'corrected'] })
      .notNull()
      .default('provisional'),
    correctedByMembershipId: text('corrected_by_membership_id').references(
      () => memberships.id,
    ),
    supersedesSegmentId: text('supersedes_segment_id').references(
      (): AnySQLiteColumn => transcriptSegments.id,
    ),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('transcript_encounter_segment_version_uidx').on(
      table.encounterId,
      table.segmentIndex,
      table.version,
    ),
    index('transcript_encounter_time_idx').on(
      table.encounterId,
      table.startedAtMs,
    ),
    uniqueIndex('transcript_scope_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.id,
    ),
    uniqueIndex('transcript_scope_encounter_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.encounterId,
      table.id,
    ),
    uniqueIndex('transcript_scope_segment_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.encounterId,
      table.segmentIndex,
      table.id,
    ),
    uniqueIndex('transcript_supersedes_once_uidx').on(
      table.supersedesSegmentId,
    ),
    foreignKey({
      name: 'transcript_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'transcript_scope_encounter_fk',
      columns: [table.organizationId, table.facilityId, table.encounterId],
      foreignColumns: [
        encounters.organizationId,
        encounters.facilityId,
        encounters.id,
      ],
    }),
    foreignKey({
      name: 'transcript_scope_corrected_by_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.correctedByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    check(
      'transcript_timing_valid',
      sql`${table.startedAtMs} >= 0 and ${table.endedAtMs} >= ${table.startedAtMs}`,
    ),
    check(
      'transcript_confidence_valid',
      sql`${table.speakerConfidence} is null or (${table.speakerConfidence} >= 0 and ${table.speakerConfidence} <= 10000)`,
    ),
    check(
      'transcript_correction_has_provenance',
      sql`${table.state} <> 'corrected' or (${table.supersedesSegmentId} is not null and ${table.correctedByMembershipId} is not null)`,
    ),
    check('transcript_version_positive', sql`${table.version} > 0`),
    enumCheck('transcript_speaker_role_enum', table.speakerRole, [
      'doctor',
      'patient',
      'other',
      'unknown',
    ]),
    enumCheck('transcript_speaker_source_enum', table.speakerRoleSource, [
      'unassigned',
      'model',
      'voice_calibration',
      'manual',
    ]),
    enumCheck('transcript_language_enum', table.languageCode, [
      'ru',
      'kk',
      'mixed',
      'unknown',
    ]),
    enumCheck('transcript_state_enum', table.state, [
      'provisional',
      'final',
      'corrected',
    ]),
  ],
);

export const transcriptionResults = sqliteTable(
  'transcription_results',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id),
    transcriptionRunId: text('transcription_run_id')
      .notNull()
      .references(() => transcriptionRuns.id),
    transcriptSegmentId: text('transcript_segment_id')
      .notNull()
      .references(() => transcriptSegments.id),
    utteranceIndex: integer('utterance_index').notNull(),
    inputHash: text('input_hash').notNull(),
    responseHash: text('response_hash').notNull(),
    consentEventIdsJson: text('consent_event_ids_json', { mode: 'json' })
      .$type<string[]>()
      .notNull(),
    durationMs: integer('duration_ms').notNull(),
    processingMs: integer('processing_ms').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('transcription_results_run_utterance_uidx').on(
      table.transcriptionRunId,
      table.utteranceIndex,
    ),
    uniqueIndex('transcription_results_scope_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.id,
    ),
    foreignKey({
      name: 'transcription_results_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'transcription_results_scope_encounter_fk',
      columns: [table.organizationId, table.facilityId, table.encounterId],
      foreignColumns: [
        encounters.organizationId,
        encounters.facilityId,
        encounters.id,
      ],
    }),
    foreignKey({
      name: 'transcription_results_scope_run_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.encounterId,
        table.transcriptionRunId,
      ],
      foreignColumns: [
        transcriptionRuns.organizationId,
        transcriptionRuns.facilityId,
        transcriptionRuns.encounterId,
        transcriptionRuns.id,
      ],
    }),
    foreignKey({
      name: 'transcription_results_scope_segment_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.encounterId,
        table.transcriptSegmentId,
      ],
      foreignColumns: [
        transcriptSegments.organizationId,
        transcriptSegments.facilityId,
        transcriptSegments.encounterId,
        transcriptSegments.id,
      ],
    }),
    check(
      'transcription_results_utterance_nonnegative',
      sql`${table.utteranceIndex} >= 0`,
    ),
    check(
      'transcription_results_hashes_valid',
      sql`length(${table.inputHash}) = 64 and length(${table.responseHash}) = 64`,
    ),
    check(
      'transcription_results_timing_valid',
      sql`${table.durationMs} >= 0 and ${table.processingMs} >= 0`,
    ),
    jsonCheck(
      'transcription_results_consent_events_json',
      table.consentEventIdsJson,
    ),
  ],
);

export const audioAssets = sqliteTable(
  'audio_assets',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id),
    objectKey: text('object_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sha256: text('sha256').notNull(),
    byteSize: integer('byte_size').notNull(),
    durationMs: integer('duration_ms'),
    retentionState: text('retention_state', {
      enum: ['temporary', 'retained', 'deletion_due', 'deleted'],
    })
      .notNull()
      .default('temporary'),
    createdByMembershipId: text('created_by_membership_id')
      .notNull()
      .references(() => memberships.id),
    createdAt: createdAt(),
  },
  (table) => [
    index('audio_assets_encounter_idx').on(table.encounterId),
    uniqueIndex('audio_assets_scope_object_key_uidx').on(
      table.organizationId,
      table.facilityId,
      table.objectKey,
    ),
    foreignKey({
      name: 'audio_assets_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'audio_assets_scope_encounter_fk',
      columns: [table.organizationId, table.facilityId, table.encounterId],
      foreignColumns: [
        encounters.organizationId,
        encounters.facilityId,
        encounters.id,
      ],
    }),
    foreignKey({
      name: 'audio_assets_scope_created_by_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.createdByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    check('audio_assets_byte_size_valid', sql`${table.byteSize} >= 0`),
    enumCheck('audio_assets_retention_state_enum', table.retentionState, [
      'temporary',
      'retained',
      'deletion_due',
      'deleted',
    ]),
    check(
      'audio_assets_duration_valid',
      sql`${table.durationMs} is null or ${table.durationMs} >= 0`,
    ),
  ],
);

export const analysisRuns = sqliteTable(
  'analysis_runs',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id),
    kind: text('kind', {
      enum: ['clinical_note', 'suggestions', 'risk_review'],
    }).notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    modelVersion: text('model_version').notNull(),
    policyVersion: text('policy_version').notNull(),
    inputHash: text('input_hash').notNull(),
    sourceRecordIdsJson: text('source_record_ids_json', { mode: 'json' })
      .$type<string[]>()
      .notNull(),
    requestedByMembershipId: text('requested_by_membership_id').references(
      () => memberships.id,
    ),
    requestId: text('request_id'),
    consentEventIdsJson: text('consent_event_ids_json', { mode: 'json' }).$type<
      string[]
    >(),
    transcriptAcknowledgedAt: integer('transcript_acknowledged_at', {
      mode: 'timestamp_ms',
    }),
    status: text('status', {
      enum: ['queued', 'running', 'succeeded', 'failed', 'superseded'],
    })
      .notNull()
      .default('queued'),
    rawResultJson: text('raw_result_json', { mode: 'json' }).$type<
      Record<string, unknown>
    >(),
    validationResultJson: text('validation_result_json', {
      mode: 'json',
    }).$type<Record<string, unknown>>(),
    metricsJson: text('metrics_json', { mode: 'json' }).$type<
      Record<string, number>
    >(),
    errorCode: text('error_code'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (table) => [
    index('analysis_encounter_status_idx').on(table.encounterId, table.status),
    index('analysis_encounter_input_policy_idx').on(
      table.encounterId,
      table.inputHash,
      table.policyVersion,
    ),
    uniqueIndex('analysis_scope_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.id,
    ),
    uniqueIndex('analysis_scope_encounter_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.encounterId,
      table.id,
    ),
    foreignKey({
      name: 'analysis_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'analysis_scope_encounter_fk',
      columns: [table.organizationId, table.facilityId, table.encounterId],
      foreignColumns: [
        encounters.organizationId,
        encounters.facilityId,
        encounters.id,
      ],
    }),
    foreignKey({
      name: 'analysis_scope_requester_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.requestedByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    enumCheck('analysis_kind_enum', table.kind, [
      'clinical_note',
      'suggestions',
      'risk_review',
    ]),
    enumCheck('analysis_status_enum', table.status, [
      'queued',
      'running',
      'succeeded',
      'failed',
      'superseded',
    ]),
    jsonCheck('analysis_source_records_json', table.sourceRecordIdsJson),
    jsonCheck('analysis_consent_events_json', table.consentEventIdsJson, true),
    jsonCheck('analysis_raw_result_json', table.rawResultJson, true),
    jsonCheck(
      'analysis_validation_result_json',
      table.validationResultJson,
      true,
    ),
    jsonCheck('analysis_metrics_json', table.metricsJson, true),
    check(
      'analysis_completion_valid',
      sql`${table.completedAt} is null or (${table.startedAt} is not null and ${table.completedAt} >= ${table.startedAt})`,
    ),
  ],
);

export const clinicalSectionVersions = sqliteTable(
  'clinical_section_versions',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id),
    code: text('code', {
      enum: [
        'complaints',
        'history_of_present_illness',
        'past_medical_history',
        'allergy_status',
        'objective_findings',
        'preliminary_diagnosis',
        'examination_plan',
        'treatment_plan',
      ],
    }).notNull(),
    content: text('content').notNull(),
    reviewState: text('review_state', {
      enum: [
        'empty',
        'ai_draft',
        'clinician_edited',
        'reviewed',
        'explicitly_absent',
      ],
    })
      .notNull()
      .default('empty'),
    provenanceJson: text('provenance_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    createdByType: text('created_by_type', {
      enum: ['user', 'service'],
    }).notNull(),
    createdById: text('created_by_id').notNull(),
    reviewedByMembershipId: text('reviewed_by_membership_id').references(
      () => memberships.id,
    ),
    reviewedAt: integer('reviewed_at', { mode: 'timestamp_ms' }),
    version: integer('version').notNull().default(1),
    supersedesSectionVersionId: text(
      'supersedes_section_version_id',
    ).references((): AnySQLiteColumn => clinicalSectionVersions.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('clinical_section_versions_encounter_code_version_uidx').on(
      table.encounterId,
      table.code,
      table.version,
    ),
    uniqueIndex('clinical_section_versions_scope_subject_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.encounterId,
      table.code,
      table.id,
    ),
    uniqueIndex('clinical_section_versions_supersedes_once_uidx').on(
      table.supersedesSectionVersionId,
    ),
    foreignKey({
      name: 'clinical_section_versions_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'clinical_section_versions_scope_encounter_fk',
      columns: [table.organizationId, table.facilityId, table.encounterId],
      foreignColumns: [
        encounters.organizationId,
        encounters.facilityId,
        encounters.id,
      ],
    }),
    foreignKey({
      name: 'clinical_section_versions_scope_reviewer_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.reviewedByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    check(
      'clinical_section_versions_human_review_valid',
      sql`(${table.reviewState} not in ('reviewed', 'explicitly_absent')) or (${table.reviewedByMembershipId} is not null and ${table.reviewedAt} is not null)`,
    ),
    check(
      'clinical_section_versions_version_positive',
      sql`${table.version} > 0`,
    ),
    enumCheck('clinical_section_versions_code_enum', table.code, [
      'complaints',
      'history_of_present_illness',
      'past_medical_history',
      'allergy_status',
      'objective_findings',
      'preliminary_diagnosis',
      'examination_plan',
      'treatment_plan',
    ]),
    enumCheck('clinical_section_versions_review_state_enum', table.reviewState, [
      'empty',
      'ai_draft',
      'clinician_edited',
      'reviewed',
      'explicitly_absent',
    ]),
    enumCheck('clinical_section_versions_created_by_type_enum', table.createdByType, [
      'user',
      'service',
    ]),
    jsonCheck('clinical_section_versions_provenance_json', table.provenanceJson),
  ],
);

export const clinicalSectionHeads = sqliteTable(
  'clinical_section_heads',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id),
    code: text('code', {
      enum: [
        'complaints',
        'history_of_present_illness',
        'past_medical_history',
        'allergy_status',
        'objective_findings',
        'preliminary_diagnosis',
        'examination_plan',
        'treatment_plan',
      ],
    }).notNull(),
    currentVersionId: text('current_version_id')
      .notNull()
      .references(() => clinicalSectionVersions.id),
    lockVersion: integer('lock_version').notNull().default(1),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('clinical_section_heads_scope_subject_uidx').on(
      table.organizationId,
      table.facilityId,
      table.encounterId,
      table.code,
    ),
    foreignKey({
      name: 'clinical_section_heads_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'clinical_section_heads_scope_encounter_fk',
      columns: [table.organizationId, table.facilityId, table.encounterId],
      foreignColumns: [
        encounters.organizationId,
        encounters.facilityId,
        encounters.id,
      ],
    }),
    foreignKey({
      name: 'clinical_section_heads_scope_current_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.encounterId,
        table.code,
        table.currentVersionId,
      ],
      foreignColumns: [
        clinicalSectionVersions.organizationId,
        clinicalSectionVersions.facilityId,
        clinicalSectionVersions.encounterId,
        clinicalSectionVersions.code,
        clinicalSectionVersions.id,
      ],
    }),
    check('clinical_section_heads_lock_positive', sql`${table.lockVersion} > 0`),
    enumCheck('clinical_section_heads_code_enum', table.code, [
      'complaints',
      'history_of_present_illness',
      'past_medical_history',
      'allergy_status',
      'objective_findings',
      'preliminary_diagnosis',
      'examination_plan',
      'treatment_plan',
    ]),
  ],
);

export const clinicalSuggestions = sqliteTable(
  'clinical_suggestions',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id),
    analysisRunId: text('analysis_run_id')
      .notNull()
      .references(() => analysisRuns.id),
    category: text('category', {
      enum: [
        'clarification',
        'safety',
        'action',
        'medication',
        'clinical_section',
      ],
    }).notNull(),
    riskLevel: text('risk_level', {
      enum: ['informational', 'attention', 'urgent'],
    })
      .notNull()
      .default('informational'),
    title: text('title').notNull(),
    originalContent: text('original_content').notNull(),
    evidenceJson: text('evidence_json', { mode: 'json' })
      .$type<Array<{ sourceId: string; quote?: string }>>()
      .notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (table) => [
    index('suggestions_encounter_created_idx').on(
      table.encounterId,
      table.createdAt,
    ),
    index('suggestions_analysis_run_idx').on(table.analysisRunId),
    uniqueIndex('suggestions_scope_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.id,
    ),
    uniqueIndex('suggestions_scope_encounter_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.encounterId,
      table.id,
    ),
    foreignKey({
      name: 'suggestions_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'suggestions_scope_encounter_fk',
      columns: [table.organizationId, table.facilityId, table.encounterId],
      foreignColumns: [
        encounters.organizationId,
        encounters.facilityId,
        encounters.id,
      ],
    }),
    foreignKey({
      name: 'suggestions_scope_analysis_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.encounterId,
        table.analysisRunId,
      ],
      foreignColumns: [
        analysisRuns.organizationId,
        analysisRuns.facilityId,
        analysisRuns.encounterId,
        analysisRuns.id,
      ],
    }),
    enumCheck('suggestions_category_enum', table.category, [
      'clarification',
      'safety',
      'action',
      'medication',
      'clinical_section',
    ]),
    enumCheck('suggestions_risk_level_enum', table.riskLevel, [
      'informational',
      'attention',
      'urgent',
    ]),
    jsonCheck('suggestions_evidence_json', table.evidenceJson),
  ],
);

export const suggestionDerivativeVersions = sqliteTable(
  'suggestion_derivative_versions',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id),
    suggestionId: text('suggestion_id')
      .notNull()
      .references(() => clinicalSuggestions.id),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    evidenceJson: text('evidence_json', { mode: 'json' })
      .$type<Array<{ sourceId: string; quote?: string }>>()
      .notNull(),
    provenanceJson: text('provenance_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    reason: text('reason').notNull(),
    authoredByMembershipId: text('authored_by_membership_id')
      .notNull()
      .references(() => memberships.id),
    supersedesDerivativeVersionId: text(
      'supersedes_derivative_version_id',
    ).references((): AnySQLiteColumn => suggestionDerivativeVersions.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('suggestion_derivative_versions_scope_subject_version_uidx').on(
      table.organizationId,
      table.facilityId,
      table.encounterId,
      table.suggestionId,
      table.version,
    ),
    uniqueIndex('suggestion_derivative_versions_scope_subject_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.encounterId,
      table.suggestionId,
      table.id,
    ),
    uniqueIndex('suggestion_derivative_versions_supersedes_once_uidx').on(
      table.supersedesDerivativeVersionId,
    ),
    index('suggestion_derivative_versions_encounter_created_idx').on(
      table.encounterId,
      table.createdAt,
    ),
    foreignKey({
      name: 'suggestion_derivative_versions_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'suggestion_derivative_versions_scope_encounter_fk',
      columns: [table.organizationId, table.facilityId, table.encounterId],
      foreignColumns: [
        encounters.organizationId,
        encounters.facilityId,
        encounters.id,
      ],
    }),
    foreignKey({
      name: 'suggestion_derivative_versions_scope_suggestion_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.encounterId,
        table.suggestionId,
      ],
      foreignColumns: [
        clinicalSuggestions.organizationId,
        clinicalSuggestions.facilityId,
        clinicalSuggestions.encounterId,
        clinicalSuggestions.id,
      ],
    }),
    foreignKey({
      name: 'suggestion_derivative_versions_scope_author_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.authoredByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    check(
      'suggestion_derivative_versions_version_positive',
      sql`${table.version} > 0`,
    ),
    check(
      'suggestion_derivative_versions_title_length',
      sql`length(trim(${table.title})) between 1 and 300`,
    ),
    check(
      'suggestion_derivative_versions_content_length',
      sql`length(trim(${table.content})) between 1 and 8000`,
    ),
    check(
      'suggestion_derivative_versions_reason_length',
      sql`length(trim(${table.reason})) between 3 and 500`,
    ),
    check(
      'suggestion_derivative_versions_hash_length',
      sql`length(${table.contentHash}) = 64`,
    ),
    jsonCheck(
      'suggestion_derivative_versions_evidence_json',
      table.evidenceJson,
    ),
    jsonCheck(
      'suggestion_derivative_versions_provenance_json',
      table.provenanceJson,
    ),
  ],
);

export const suggestionDerivativeHeads = sqliteTable(
  'suggestion_derivative_heads',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id),
    suggestionId: text('suggestion_id')
      .notNull()
      .references(() => clinicalSuggestions.id),
    currentDerivativeVersionId: text('current_derivative_version_id')
      .notNull()
      .references(() => suggestionDerivativeVersions.id),
    lockVersion: integer('lock_version').notNull().default(1),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('suggestion_derivative_heads_scope_suggestion_uidx').on(
      table.organizationId,
      table.facilityId,
      table.suggestionId,
    ),
    uniqueIndex('suggestion_derivative_heads_scope_subject_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.encounterId,
      table.suggestionId,
      table.id,
    ),
    foreignKey({
      name: 'suggestion_derivative_heads_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'suggestion_derivative_heads_scope_encounter_fk',
      columns: [table.organizationId, table.facilityId, table.encounterId],
      foreignColumns: [
        encounters.organizationId,
        encounters.facilityId,
        encounters.id,
      ],
    }),
    foreignKey({
      name: 'suggestion_derivative_heads_scope_suggestion_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.encounterId,
        table.suggestionId,
      ],
      foreignColumns: [
        clinicalSuggestions.organizationId,
        clinicalSuggestions.facilityId,
        clinicalSuggestions.encounterId,
        clinicalSuggestions.id,
      ],
    }),
    foreignKey({
      name: 'suggestion_derivative_heads_scope_version_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.encounterId,
        table.suggestionId,
        table.currentDerivativeVersionId,
      ],
      foreignColumns: [
        suggestionDerivativeVersions.organizationId,
        suggestionDerivativeVersions.facilityId,
        suggestionDerivativeVersions.encounterId,
        suggestionDerivativeVersions.suggestionId,
        suggestionDerivativeVersions.id,
      ],
    }),
    check(
      'suggestion_derivative_heads_lock_positive',
      sql`${table.lockVersion} > 0`,
    ),
  ],
);

export const reviewDecisions = sqliteTable(
  'review_decisions',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id),
    suggestionId: text('suggestion_id')
      .notNull()
      .references(() => clinicalSuggestions.id),
    reviewerMembershipId: text('reviewer_membership_id')
      .notNull()
      .references(() => memberships.id),
    sequence: integer('sequence').notNull(),
    expectedVersion: integer('expected_version').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    decision: text('decision', {
      enum: ['accept', 'edit_and_accept', 'reject', 'restore'],
    }).notNull(),
    resultState: text('result_state', {
      enum: ['proposed', 'accepted', 'edited_and_accepted', 'rejected'],
    }).notNull(),
    reviewedDerivativeVersionId: text('reviewed_derivative_version_id').references(
      () => suggestionDerivativeVersions.id,
    ),
    editedContent: text('edited_content'),
    reason: text('reason'),
    decidedAt: integer('decided_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('review_decisions_suggestion_sequence_uidx').on(
      table.suggestionId,
      table.sequence,
    ),
    uniqueIndex('review_decisions_scope_idempotency_uidx').on(
      table.organizationId,
      table.facilityId,
      table.idempotencyKey,
    ),
    uniqueIndex('review_decisions_scope_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.id,
    ),
    uniqueIndex('review_decisions_scope_subject_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.encounterId,
      table.suggestionId,
      table.id,
    ),
    index('review_decisions_encounter_time_idx').on(
      table.encounterId,
      table.decidedAt,
    ),
    foreignKey({
      name: 'review_decisions_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'review_decisions_scope_encounter_fk',
      columns: [table.organizationId, table.facilityId, table.encounterId],
      foreignColumns: [
        encounters.organizationId,
        encounters.facilityId,
        encounters.id,
      ],
    }),
    foreignKey({
      name: 'review_decisions_scope_suggestion_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.encounterId,
        table.suggestionId,
      ],
      foreignColumns: [
        clinicalSuggestions.organizationId,
        clinicalSuggestions.facilityId,
        clinicalSuggestions.encounterId,
        clinicalSuggestions.id,
      ],
    }),
    foreignKey({
      name: 'review_decisions_scope_reviewer_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.reviewerMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    foreignKey({
      name: 'review_decisions_scope_derivative_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.encounterId,
        table.suggestionId,
        table.reviewedDerivativeVersionId,
      ],
      foreignColumns: [
        suggestionDerivativeVersions.organizationId,
        suggestionDerivativeVersions.facilityId,
        suggestionDerivativeVersions.encounterId,
        suggestionDerivativeVersions.suggestionId,
        suggestionDerivativeVersions.id,
      ],
    }),
    check('review_decisions_sequence_positive', sql`${table.sequence} > 0`),
    check(
      'review_decisions_version_positive',
      sql`${table.expectedVersion} > 0`,
    ),
    check(
      'review_decisions_edited_content_valid',
      sql`(${table.decision} = 'edit_and_accept' and length(trim(coalesce(${table.editedContent}, ''))) > 0) or (${table.decision} <> 'edit_and_accept' and ${table.editedContent} is null)`,
    ),
    enumCheck('review_decisions_decision_enum', table.decision, [
      'accept',
      'edit_and_accept',
      'reject',
      'restore',
    ]),
    enumCheck('review_decisions_result_state_enum', table.resultState, [
      'proposed',
      'accepted',
      'edited_and_accepted',
      'rejected',
    ]),
    check(
      'review_decisions_transition_consistent',
      sql`(${table.decision} = 'accept' and ${table.reviewedDerivativeVersionId} is null and ${table.resultState} = 'accepted') or (${table.decision} = 'accept' and ${table.reviewedDerivativeVersionId} is not null and ${table.resultState} = 'edited_and_accepted') or (${table.decision} = 'edit_and_accept' and ${table.resultState} = 'edited_and_accepted') or (${table.decision} = 'reject' and ${table.resultState} = 'rejected') or (${table.decision} = 'restore' and ${table.resultState} = 'proposed')`,
    ),
  ],
);

export const suggestionReviewHeads = sqliteTable(
  'suggestion_review_heads',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id),
    suggestionId: text('suggestion_id')
      .notNull()
      .references(() => clinicalSuggestions.id),
    state: text('state', {
      enum: ['proposed', 'accepted', 'edited_and_accepted', 'rejected', 'expired'],
    })
      .notNull()
      .default('proposed'),
    currentDecisionId: text('current_decision_id').references(
      () => reviewDecisions.id,
    ),
    lockVersion: integer('lock_version').notNull().default(1),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('suggestion_review_heads_scope_suggestion_uidx').on(
      table.organizationId,
      table.facilityId,
      table.suggestionId,
    ),
    foreignKey({
      name: 'suggestion_review_heads_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'suggestion_review_heads_scope_encounter_fk',
      columns: [table.organizationId, table.facilityId, table.encounterId],
      foreignColumns: [
        encounters.organizationId,
        encounters.facilityId,
        encounters.id,
      ],
    }),
    foreignKey({
      name: 'suggestion_review_heads_scope_suggestion_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.encounterId,
        table.suggestionId,
      ],
      foreignColumns: [
        clinicalSuggestions.organizationId,
        clinicalSuggestions.facilityId,
        clinicalSuggestions.encounterId,
        clinicalSuggestions.id,
      ],
    }),
    foreignKey({
      name: 'suggestion_review_heads_scope_decision_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.encounterId,
        table.suggestionId,
        table.currentDecisionId,
      ],
      foreignColumns: [
        reviewDecisions.organizationId,
        reviewDecisions.facilityId,
        reviewDecisions.encounterId,
        reviewDecisions.suggestionId,
        reviewDecisions.id,
      ],
    }),
    check('suggestion_review_heads_lock_positive', sql`${table.lockVersion} > 0`),
    check(
      'suggestion_review_heads_decision_consistency',
      sql`(${table.state} in ('proposed', 'expired') and ${table.currentDecisionId} is null) or (${table.state} not in ('proposed', 'expired') and ${table.currentDecisionId} is not null)`,
    ),
    enumCheck('suggestion_review_heads_state_enum', table.state, [
      'proposed',
      'accepted',
      'edited_and_accepted',
      'rejected',
      'expired',
    ]),
  ],
);

export const protocolVersions = sqliteTable(
  'protocol_versions',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id),
    version: integer('version').notNull(),
    status: text('status', { enum: ['draft', 'signed'] })
      .notNull()
      .default('draft'),
    contentJson: text('content_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    sourceHash: text('source_hash').notNull(),
    createdByMembershipId: text('created_by_membership_id')
      .notNull()
      .references(() => memberships.id),
    signedByMembershipId: text('signed_by_membership_id').references(
      () => memberships.id,
    ),
    signedAt: integer('signed_at', { mode: 'timestamp_ms' }),
    supersedesProtocolVersionId: text('supersedes_protocol_version_id').references(
      (): AnySQLiteColumn => protocolVersions.id,
    ),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('protocol_versions_encounter_version_uidx').on(
      table.encounterId,
      table.version,
    ),
    index('protocol_versions_encounter_status_idx').on(
      table.encounterId,
      table.status,
    ),
    uniqueIndex('protocol_versions_scope_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.id,
    ),
    uniqueIndex('protocol_versions_scope_encounter_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.encounterId,
      table.id,
    ),
    uniqueIndex('protocol_versions_supersedes_once_uidx').on(
      table.supersedesProtocolVersionId,
    ),
    foreignKey({
      name: 'protocol_versions_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'protocol_versions_scope_encounter_fk',
      columns: [table.organizationId, table.facilityId, table.encounterId],
      foreignColumns: [
        encounters.organizationId,
        encounters.facilityId,
        encounters.id,
      ],
    }),
    foreignKey({
      name: 'protocol_versions_scope_created_by_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.createdByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    foreignKey({
      name: 'protocol_versions_scope_signed_by_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.signedByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    check('protocol_versions_version_positive', sql`${table.version} > 0`),
    check(
      'protocol_versions_signature_consistent',
      sql`(${table.status} = 'signed' and ${table.signedByMembershipId} is not null and ${table.signedAt} is not null) or (${table.status} = 'draft' and ${table.signedByMembershipId} is null and ${table.signedAt} is null)`,
    ),
    enumCheck('protocol_versions_status_enum', table.status, ['draft', 'signed']),
    jsonCheck('protocol_versions_content_json', table.contentJson),
  ],
);

export const protocolHeads = sqliteTable(
  'protocol_heads',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id),
    currentProtocolVersionId: text('current_protocol_version_id')
      .notNull()
      .references(() => protocolVersions.id),
    currentSignedProtocolVersionId: text(
      'current_signed_protocol_version_id',
    ).references(() => protocolVersions.id),
    lockVersion: integer('lock_version').notNull().default(1),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('protocol_heads_scope_encounter_uidx').on(
      table.organizationId,
      table.facilityId,
      table.encounterId,
    ),
    foreignKey({
      name: 'protocol_heads_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'protocol_heads_scope_encounter_fk',
      columns: [table.organizationId, table.facilityId, table.encounterId],
      foreignColumns: [
        encounters.organizationId,
        encounters.facilityId,
        encounters.id,
      ],
    }),
    foreignKey({
      name: 'protocol_heads_scope_current_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.encounterId,
        table.currentProtocolVersionId,
      ],
      foreignColumns: [
        protocolVersions.organizationId,
        protocolVersions.facilityId,
        protocolVersions.encounterId,
        protocolVersions.id,
      ],
    }),
    foreignKey({
      name: 'protocol_heads_scope_signed_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.encounterId,
        table.currentSignedProtocolVersionId,
      ],
      foreignColumns: [
        protocolVersions.organizationId,
        protocolVersions.facilityId,
        protocolVersions.encounterId,
        protocolVersions.id,
      ],
    }),
    check('protocol_heads_lock_positive', sql`${table.lockVersion} > 0`),
  ],
);

export const protocolAmendments = sqliteTable(
  'protocol_amendments',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id),
    baseProtocolVersionId: text('base_protocol_version_id')
      .notNull()
      .references(() => protocolVersions.id),
    amendedProtocolVersionId: text('amended_protocol_version_id')
      .notNull()
      .references(() => protocolVersions.id),
    reason: text('reason').notNull(),
    amendmentText: text('amendment_text').notNull(),
    createdByMembershipId: text('created_by_membership_id')
      .notNull()
      .references(() => memberships.id),
    createdAt: createdAt(),
  },
  (table) => [
    index('protocol_amendments_encounter_time_idx').on(
      table.encounterId,
      table.createdAt,
    ),
    uniqueIndex('protocol_amendments_amended_protocol_uidx').on(
      table.amendedProtocolVersionId,
    ),
    uniqueIndex('protocol_amendments_scope_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.id,
    ),
    foreignKey({
      name: 'protocol_amendments_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'protocol_amendments_scope_encounter_fk',
      columns: [table.organizationId, table.facilityId, table.encounterId],
      foreignColumns: [
        encounters.organizationId,
        encounters.facilityId,
        encounters.id,
      ],
    }),
    foreignKey({
      name: 'protocol_amendments_scope_base_protocol_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.encounterId,
        table.baseProtocolVersionId,
      ],
      foreignColumns: [
        protocolVersions.organizationId,
        protocolVersions.facilityId,
        protocolVersions.encounterId,
        protocolVersions.id,
      ],
    }),
    foreignKey({
      name: 'protocol_amendments_scope_amended_protocol_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.encounterId,
        table.amendedProtocolVersionId,
      ],
      foreignColumns: [
        protocolVersions.organizationId,
        protocolVersions.facilityId,
        protocolVersions.encounterId,
        protocolVersions.id,
      ],
    }),
    foreignKey({
      name: 'protocol_amendments_scope_created_by_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.createdByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    check(
      'protocol_amendments_versions_distinct',
      sql`${table.baseProtocolVersionId} <> ${table.amendedProtocolVersionId}`,
    ),
    check(
      'protocol_amendments_reason_length',
      sql`length(trim(${table.reason})) between 10 and 500`,
    ),
    check(
      'protocol_amendments_text_length',
      sql`length(trim(${table.amendmentText})) between 1 and 8000`,
    ),
  ],
);

export const documentArtifacts = sqliteTable(
  'document_artifacts',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id),
    protocolVersionId: text('protocol_version_id').references(
      () => protocolVersions.id,
    ),
    kind: text('kind', {
      enum: ['protocol_docx', 'protocol_pdf', 'transcript_txt', 'audit_json', 'bundle_zip'],
    }).notNull(),
    objectKey: text('object_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sha256: text('sha256').notNull(),
    byteSize: integer('byte_size').notNull(),
    status: text('status', { enum: ['pending', 'ready', 'failed', 'deleted'] })
      .notNull()
      .default('pending'),
    createdByMembershipId: text('created_by_membership_id')
      .notNull()
      .references(() => memberships.id),
    createdAt: createdAt(),
  },
  (table) => [
    index('documents_encounter_kind_idx').on(table.encounterId, table.kind),
    uniqueIndex('documents_scope_encounter_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.encounterId,
      table.id,
    ),
    uniqueIndex('documents_scope_object_key_uidx').on(
      table.organizationId,
      table.facilityId,
      table.objectKey,
    ),
    foreignKey({
      name: 'documents_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'documents_scope_encounter_fk',
      columns: [table.organizationId, table.facilityId, table.encounterId],
      foreignColumns: [
        encounters.organizationId,
        encounters.facilityId,
        encounters.id,
      ],
    }),
    foreignKey({
      name: 'documents_scope_protocol_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.encounterId,
        table.protocolVersionId,
      ],
      foreignColumns: [
        protocolVersions.organizationId,
        protocolVersions.facilityId,
        protocolVersions.encounterId,
        protocolVersions.id,
      ],
    }),
    foreignKey({
      name: 'documents_scope_created_by_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.createdByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    check('documents_byte_size_valid', sql`${table.byteSize} >= 0`),
    enumCheck('documents_kind_enum', table.kind, [
      'protocol_docx',
      'protocol_pdf',
      'transcript_txt',
      'audit_json',
      'bundle_zip',
    ]),
    enumCheck('documents_status_enum', table.status, [
      'pending',
      'ready',
      'failed',
      'deleted',
    ]),
  ],
);

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    sequence: integer('sequence').notNull(),
    actorType: text('actor_type', { enum: ['user', 'service'] }).notNull(),
    actorId: text('actor_id').notNull(),
    actorMembershipId: text('actor_membership_id').references(
      () => memberships.id,
    ),
    action: text('action').notNull(),
    outcome: text('outcome', { enum: ['succeeded', 'denied', 'failed'] })
      .notNull(),
    purpose: text('purpose').notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    requestId: text('request_id').notNull(),
    metadataJson: text('metadata_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    previousHash: text('previous_hash'),
    eventHash: text('event_hash').notNull(),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('audit_scope_sequence_uidx').on(
      table.organizationId,
      table.facilityId,
      table.sequence,
    ),
    index('audit_scope_time_idx').on(
      table.organizationId,
      table.facilityId,
      table.occurredAt,
    ),
    index('audit_entity_time_idx').on(
      table.entityType,
      table.entityId,
      table.occurredAt,
    ),
    uniqueIndex('audit_event_hash_uidx').on(table.eventHash),
    uniqueIndex('audit_scope_sequence_hash_uidx').on(
      table.organizationId,
      table.facilityId,
      table.sequence,
      table.eventHash,
    ),
    foreignKey({
      name: 'audit_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'audit_scope_actor_membership_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.actorMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    check('audit_sequence_positive', sql`${table.sequence} > 0`),
    check('audit_schema_version_positive', sql`${table.schemaVersion} > 0`),
    check(
      'audit_genesis_consistent',
      sql`(${table.sequence} = 1 and ${table.previousHash} is null) or (${table.sequence} > 1 and ${table.previousHash} is not null)`,
    ),
    check(
      'audit_actor_consistent',
      sql`(${table.actorType} = 'user' and ${table.actorMembershipId} is not null) or (${table.actorType} = 'service' and ${table.actorMembershipId} is null)`,
    ),
    enumCheck('audit_actor_type_enum', table.actorType, ['user', 'service']),
    enumCheck('audit_outcome_enum', table.outcome, [
      'succeeded',
      'denied',
      'failed',
    ]),
    jsonCheck('audit_metadata_json', table.metadataJson),
  ],
);

export const auditStreamHeads = sqliteTable(
  'audit_stream_heads',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    lastSequence: integer('last_sequence').notNull().default(0),
    lastEventHash: text('last_event_hash'),
    lockVersion: integer('lock_version').notNull().default(1),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('audit_stream_heads_scope_uidx').on(
      table.organizationId,
      table.facilityId,
    ),
    foreignKey({
      name: 'audit_stream_heads_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'audit_stream_heads_last_event_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.lastSequence,
        table.lastEventHash,
      ],
      foreignColumns: [
        auditEvents.organizationId,
        auditEvents.facilityId,
        auditEvents.sequence,
        auditEvents.eventHash,
      ],
    }),
    check(
      'audit_stream_heads_sequence_nonnegative',
      sql`${table.lastSequence} >= 0`,
    ),
    check('audit_stream_heads_lock_positive', sql`${table.lockVersion} > 0`),
    check(
      'audit_stream_heads_genesis_consistent',
      sql`(${table.lastSequence} = 0 and ${table.lastEventHash} is null) or (${table.lastSequence} > 0 and ${table.lastEventHash} is not null)`,
    ),
  ],
);

export const accessAuditEvents = sqliteTable(
  'access_audit_events',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    streamKey: text('stream_key').notNull(),
    sequence: integer('sequence').notNull(),
    actorUserId: text('actor_user_id').notNull(),
    actorMembershipId: text('actor_membership_id').notNull(),
    actorRole: text('actor_role', { enum: ['clinician'] }).notNull(),
    action: text('action', {
      enum: ['workspace.read', 'document.download'],
    }).notNull(),
    outcome: text('outcome', {
      enum: ['succeeded', 'denied', 'failed'],
    }).notNull(),
    purposeCode: text('purpose_code', {
      enum: [
        'synthetic_direct_patient_care',
        'synthetic_clinical_export_download',
      ],
    }).notNull(),
    routeCode: text('route_code', {
      enum: ['workspace', 'document_export_download'],
    }).notNull(),
    decisionCode: text('decision_code').notNull(),
    responseStatus: integer('response_status').notNull(),
    encounterId: text('encounter_id').notNull(),
    documentArtifactId: text('document_artifact_id'),
    artifactKind: text('artifact_kind', {
      enum: [
        'protocol_docx',
        'protocol_pdf',
        'transcript_txt',
        'audit_json',
        'bundle_zip',
      ],
    }),
    requestId: text('request_id').notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    previousHash: text('previous_hash'),
    eventHash: text('event_hash').notNull(),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('access_audit_stream_sequence_uidx').on(
      table.organizationId,
      table.facilityId,
      table.streamKey,
      table.sequence,
    ),
    uniqueIndex('access_audit_request_uidx').on(table.requestId),
    uniqueIndex('access_audit_event_hash_uidx').on(table.eventHash),
    uniqueIndex('access_audit_stream_sequence_hash_uidx').on(
      table.organizationId,
      table.facilityId,
      table.streamKey,
      table.sequence,
      table.eventHash,
    ),
    index('access_audit_scope_time_idx').on(
      table.organizationId,
      table.facilityId,
      table.occurredAt,
    ),
    index('access_audit_actor_time_idx').on(
      table.organizationId,
      table.facilityId,
      table.actorMembershipId,
      table.occurredAt,
    ),
    index('access_audit_encounter_time_idx').on(
      table.organizationId,
      table.facilityId,
      table.encounterId,
      table.occurredAt,
    ),
    index('access_audit_document_time_idx').on(
      table.organizationId,
      table.facilityId,
      table.documentArtifactId,
      table.occurredAt,
    ),
    foreignKey({
      name: 'access_audit_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'access_audit_actor_membership_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.actorMembershipId,
        table.actorUserId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
        memberships.userId,
      ],
    }),
    foreignKey({
      name: 'access_audit_scope_encounter_fk',
      columns: [table.organizationId, table.facilityId, table.encounterId],
      foreignColumns: [
        encounters.organizationId,
        encounters.facilityId,
        encounters.id,
      ],
    }),
    foreignKey({
      name: 'access_audit_scope_document_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.encounterId,
        table.documentArtifactId,
      ],
      foreignColumns: [
        documentArtifacts.organizationId,
        documentArtifacts.facilityId,
        documentArtifacts.encounterId,
        documentArtifacts.id,
      ],
    }),
    check('access_audit_sequence_positive', sql`${table.sequence} > 0`),
    check(
      'access_audit_schema_version_positive',
      sql`${table.schemaVersion} > 0`,
    ),
    check(
      'access_audit_stream_matches_actor',
      sql`${table.streamKey} = 'membership:' || ${table.actorMembershipId}`,
    ),
    check(
      'access_audit_genesis_consistent',
      sql`(${table.sequence} = 1 and ${table.previousHash} is null) or (${table.sequence} > 1 and ${table.previousHash} is not null)`,
    ),
    check(
      'access_audit_action_resource_consistent',
      sql`(
        ${table.action} = 'workspace.read'
        and ${table.routeCode} = 'workspace'
        and ${table.purposeCode} = 'synthetic_direct_patient_care'
        and ${table.documentArtifactId} is null
        and ${table.artifactKind} is null
      ) or (
        ${table.action} = 'document.download'
        and ${table.routeCode} = 'document_export_download'
        and ${table.purposeCode} = 'synthetic_clinical_export_download'
        and ${table.documentArtifactId} is not null
        and ${table.artifactKind} is not null
      )`,
    ),
    check(
      'access_audit_success_decision_consistent',
      sql`(${table.outcome} = 'succeeded' and ${table.responseStatus} between 200 and 299 and ${table.decisionCode} = 'authorized_response_prepared') or (${table.outcome} <> 'succeeded' and ${table.decisionCode} <> 'authorized_response_prepared')`,
    ),
    check(
      'access_audit_response_status_valid',
      sql`${table.responseStatus} between 100 and 599`,
    ),
    enumCheck('access_audit_actor_role_enum', table.actorRole, ['clinician']),
    enumCheck('access_audit_action_enum', table.action, [
      'workspace.read',
      'document.download',
    ]),
    enumCheck('access_audit_outcome_enum', table.outcome, [
      'succeeded',
      'denied',
      'failed',
    ]),
    enumCheck('access_audit_purpose_enum', table.purposeCode, [
      'synthetic_direct_patient_care',
      'synthetic_clinical_export_download',
    ]),
    enumCheck('access_audit_route_enum', table.routeCode, [
      'workspace',
      'document_export_download',
    ]),
    enumCheck('access_audit_artifact_kind_enum', table.artifactKind, [
      'protocol_docx',
      'protocol_pdf',
      'transcript_txt',
      'audit_json',
      'bundle_zip',
    ]),
  ],
);

export const accessAuditStreamHeads = sqliteTable(
  'access_audit_stream_heads',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    streamKey: text('stream_key').notNull(),
    actorMembershipId: text('actor_membership_id').notNull(),
    lastSequence: integer('last_sequence').notNull().default(0),
    lastEventHash: text('last_event_hash'),
    lockVersion: integer('lock_version').notNull().default(1),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('access_audit_stream_heads_scope_uidx').on(
      table.organizationId,
      table.facilityId,
      table.streamKey,
    ),
    foreignKey({
      name: 'access_audit_stream_heads_actor_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.actorMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    foreignKey({
      name: 'access_audit_stream_heads_last_event_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.streamKey,
        table.lastSequence,
        table.lastEventHash,
      ],
      foreignColumns: [
        accessAuditEvents.organizationId,
        accessAuditEvents.facilityId,
        accessAuditEvents.streamKey,
        accessAuditEvents.sequence,
        accessAuditEvents.eventHash,
      ],
    }),
    check(
      'access_audit_stream_heads_match_actor',
      sql`${table.streamKey} = 'membership:' || ${table.actorMembershipId}`,
    ),
    check(
      'access_audit_stream_heads_sequence_nonnegative',
      sql`${table.lastSequence} >= 0`,
    ),
    check(
      'access_audit_stream_heads_lock_positive',
      sql`${table.lockVersion} > 0`,
    ),
    check(
      'access_audit_stream_heads_genesis_consistent',
      sql`(${table.lastSequence} = 0 and ${table.lastEventHash} is null) or (${table.lastSequence} > 0 and ${table.lastEventHash} is not null)`,
    ),
  ],
);

export const commandIdempotency = sqliteTable(
  'command_idempotency',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    actorMembershipId: text('actor_membership_id')
      .notNull()
      .references(() => memberships.id),
    operation: text('operation').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status', { enum: ['processing', 'succeeded', 'failed'] })
      .notNull()
      .default('processing'),
    resultResourceType: text('result_resource_type'),
    resultResourceId: text('result_resource_id'),
    responseJson: text('response_json', { mode: 'json' }).$type<
      Record<string, unknown>
    >(),
    createdAt: createdAt(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('command_idempotency_scope_operation_key_uidx').on(
      table.organizationId,
      table.facilityId,
      table.actorMembershipId,
      table.operation,
      table.idempotencyKey,
    ),
    uniqueIndex('command_idempotency_scope_id_uidx').on(
      table.organizationId,
      table.facilityId,
      table.id,
    ),
    foreignKey({
      name: 'command_idempotency_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'command_idempotency_scope_actor_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.actorMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    check(
      'command_idempotency_completion_consistent',
      sql`(${table.status} = 'processing' and ${table.completedAt} is null) or (${table.status} <> 'processing' and ${table.completedAt} is not null)`,
    ),
    enumCheck('command_idempotency_status_enum', table.status, [
      'processing',
      'succeeded',
      'failed',
    ]),
    jsonCheck('command_idempotency_response_json', table.responseJson, true),
  ],
);

export const diagnosticResultUploadIntents = sqliteTable(
  'diagnostic_result_upload_intents',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    commandId: text('command_id')
      .notNull()
      .references(() => commandIdempotency.id),
    serviceRequestId: text('service_request_id')
      .notNull()
      .references(() => serviceRequests.id),
    artifactId: text('artifact_id').notNull(),
    objectKey: text('object_key').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type', {
      enum: ['application/pdf', 'image/jpeg', 'image/png'],
    }).notNull(),
    sha256: text('sha256').notNull(),
    byteSize: integer('byte_size').notNull(),
    status: text('status', {
      enum: [
        'reserved',
        'object_stored',
        'committed',
        'cleanup_pending',
        'cleaned',
      ],
    })
      .notNull()
      .default('reserved'),
    failureCode: text('failure_code'),
    createdByMembershipId: text('created_by_membership_id')
      .notNull()
      .references(() => memberships.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('diagnostic_result_upload_intents_scope_command_uidx').on(
      table.organizationId,
      table.facilityId,
      table.commandId,
    ),
    uniqueIndex('diagnostic_result_upload_intents_scope_object_uidx').on(
      table.organizationId,
      table.facilityId,
      table.objectKey,
    ),
    index('diagnostic_result_upload_intents_reconcile_idx').on(
      table.organizationId,
      table.facilityId,
      table.status,
      table.updatedAt,
    ),
    foreignKey({
      name: 'diagnostic_result_upload_intents_scope_command_fk',
      columns: [table.organizationId, table.facilityId, table.commandId],
      foreignColumns: [
        commandIdempotency.organizationId,
        commandIdempotency.facilityId,
        commandIdempotency.id,
      ],
    }),
    foreignKey({
      name: 'diagnostic_result_upload_intents_scope_request_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.serviceRequestId,
      ],
      foreignColumns: [
        serviceRequests.organizationId,
        serviceRequests.facilityId,
        serviceRequests.id,
      ],
    }),
    foreignKey({
      name: 'diagnostic_result_upload_intents_scope_creator_fk',
      columns: [
        table.organizationId,
        table.facilityId,
        table.createdByMembershipId,
      ],
      foreignColumns: [
        memberships.organizationId,
        memberships.facilityId,
        memberships.id,
      ],
    }),
    enumCheck('diagnostic_result_upload_intents_mime_enum', table.mimeType, [
      'application/pdf',
      'image/jpeg',
      'image/png',
    ]),
    enumCheck('diagnostic_result_upload_intents_status_enum', table.status, [
      'reserved',
      'object_stored',
      'committed',
      'cleanup_pending',
      'cleaned',
    ]),
    check(
      'diagnostic_result_upload_intents_sha256_length',
      sql`length(${table.sha256}) = 64`,
    ),
    check(
      'diagnostic_result_upload_intents_size_positive',
      sql`${table.byteSize} > 0`,
    ),
    check(
      'diagnostic_result_upload_intents_file_name_length',
      sql`length(trim(${table.fileName})) between 1 and 180`,
    ),
    check(
      'diagnostic_result_upload_intents_failure_consistent',
      sql`(${table.status} in ('cleanup_pending', 'cleaned') and ${table.failureCode} is not null) or (${table.status} not in ('cleanup_pending', 'cleaned') and ${table.failureCode} is null)`,
    ),
  ],
);

export const outboxEvents = sqliteTable(
  'outbox_events',
  {
    id: text('id').primaryKey(),
    ...tenantScope(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    aggregateVersion: integer('aggregate_version').notNull(),
    commandId: text('command_id').references(() => commandIdempotency.id),
    eventType: text('event_type').notNull(),
    payloadJson: text('payload_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    eventIdempotencyKey: text('event_idempotency_key').notNull(),
    status: text('status', {
      enum: ['pending', 'processing', 'succeeded', 'failed', 'dead_letter'],
    })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp_ms' }).notNull(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp_ms' }),
    claimedAt: integer('claimed_at', { mode: 'timestamp_ms' }),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    lastErrorCode: text('last_error_code'),
    lastErrorAt: integer('last_error_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('outbox_scope_event_idempotency_uidx').on(
      table.organizationId,
      table.facilityId,
      table.eventIdempotencyKey,
    ),
    index('outbox_dispatch_idx').on(table.status, table.nextAttemptAt),
    index('outbox_aggregate_idx').on(table.aggregateType, table.aggregateId),
    foreignKey({
      name: 'outbox_scope_facility_fk',
      columns: [table.organizationId, table.facilityId],
      foreignColumns: [facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'outbox_scope_command_fk',
      columns: [table.organizationId, table.facilityId, table.commandId],
      foreignColumns: [
        commandIdempotency.organizationId,
        commandIdempotency.facilityId,
        commandIdempotency.id,
      ],
    }),
    check('outbox_attempts_nonnegative', sql`${table.attempts} >= 0`),
    check('outbox_aggregate_version_positive', sql`${table.aggregateVersion} > 0`),
    check(
      'outbox_lease_consistent',
      sql`(${table.status} = 'processing' and ${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null and ${table.claimedAt} is not null) or (${table.status} <> 'processing')`,
    ),
    check(
      'outbox_completion_consistent',
      sql`(${table.status} = 'succeeded' and ${table.completedAt} is not null) or (${table.status} <> 'succeeded')`,
    ),
    enumCheck('outbox_status_enum', table.status, [
      'pending',
      'processing',
      'succeeded',
      'failed',
      'dead_letter',
    ]),
    jsonCheck('outbox_payload_json', table.payloadJson),
  ],
);
