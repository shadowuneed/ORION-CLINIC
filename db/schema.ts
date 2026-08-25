import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const encounters = sqliteTable(
  'encounters',
  {
    id: text('id').primaryKey(),
    clinicianUserId: text('clinician_user_id').notNull(),
    patientReference: text('patient_reference'),
    mode: text('mode', { enum: ['in_person'] }).notNull().default('in_person'),
    status: text('status', {
      enum: ['draft', 'listening', 'review', 'finalized', 'cancelled'],
    })
      .notNull()
      .default('draft'),
    languageMode: text('language_mode', { enum: ['ru_kk'] })
      .notNull()
      .default('ru_kk'),
    consentStatus: text('consent_status', {
      enum: ['not_recorded', 'confirmed', 'withdrawn'],
    })
      .notNull()
      .default('not_recorded'),
    consentRecordedAt: integer('consent_recorded_at', { mode: 'timestamp_ms' }),
    audioRetention: text('audio_retention', { enum: ['none'] })
      .notNull()
      .default('none'),
    transcriptionProvider: text('transcription_provider'),
    transcriptionRegion: text('transcription_region'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index('encounters_clinician_created_idx').on(
      table.clinicianUserId,
      table.createdAt,
    ),
    index('encounters_status_idx').on(table.status),
  ],
);

export const consentEvents = sqliteTable(
  'consent_events',
  {
    id: text('id').primaryKey(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['confirmed', 'withdrawn'] }).notNull(),
    noticeVersion: text('notice_version').notNull(),
    recordedByUserId: text('recorded_by_user_id').notNull(),
    recordedAt: integer('recorded_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index('consent_events_encounter_idx').on(table.encounterId)],
);

export const speakerMappings = sqliteTable(
  'speaker_mappings',
  {
    id: text('id').primaryKey(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    providerSpeaker: text('provider_speaker').notNull(),
    role: text('role', { enum: ['doctor', 'patient', 'unknown'] })
      .notNull()
      .default('unknown'),
    method: text('method', {
      enum: ['doctor_calibration', 'manual_correction', 'unassigned'],
    })
      .notNull()
      .default('unassigned'),
    confirmedByUserId: text('confirmed_by_user_id'),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex('speaker_mappings_encounter_provider_uidx').on(
      table.encounterId,
      table.providerSpeaker,
    ),
  ],
);

export const transcriptSegments = sqliteTable(
  'transcript_segments',
  {
    id: text('id').primaryKey(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    providerSegmentId: text('provider_segment_id'),
    providerSpeaker: text('provider_speaker'),
    speakerRole: text('speaker_role', {
      enum: ['doctor', 'patient', 'unknown'],
    })
      .notNull()
      .default('unknown'),
    languageCode: text('language_code', { enum: ['ru', 'kk', 'unknown'] })
      .notNull()
      .default('unknown'),
    content: text('content').notNull(),
    startedAtMs: integer('started_at_ms').notNull(),
    endedAtMs: integer('ended_at_ms').notNull(),
    confidence: real('confidence'),
    isFinal: integer('is_final', { mode: 'boolean' }).notNull().default(false),
    clinicianVerified: integer('clinician_verified', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index('transcript_segments_encounter_time_idx').on(
      table.encounterId,
      table.startedAtMs,
    ),
    index('transcript_segments_encounter_final_idx').on(
      table.encounterId,
      table.isFinal,
    ),
  ],
);

export const suggestions = sqliteTable(
  'suggestions',
  {
    id: text('id').primaryKey(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: [
        'clarifying_question',
        'safety_signal',
        'differential',
        'investigation',
        'treatment_option',
        'protocol_fact',
      ],
    }).notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    rationale: text('rationale'),
    priority: text('priority', { enum: ['routine', 'important', 'urgent'] })
      .notNull()
      .default('routine'),
    reviewState: text('review_state', {
      enum: ['pending', 'accepted', 'edited', 'rejected'],
    })
      .notNull()
      .default('pending'),
    sourceSegmentIdsJson: text('source_segment_ids_json').notNull().default('[]'),
    modelProvider: text('model_provider').notNull(),
    modelName: text('model_name').notNull(),
    modelVersion: text('model_version'),
    reviewedByUserId: text('reviewed_by_user_id'),
    reviewedAt: integer('reviewed_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index('suggestions_encounter_state_idx').on(
      table.encounterId,
      table.reviewState,
    ),
    index('suggestions_encounter_priority_idx').on(
      table.encounterId,
      table.priority,
    ),
  ],
);

export const suggestionReviews = sqliteTable(
  'suggestion_reviews',
  {
    id: text('id').primaryKey(),
    suggestionId: text('suggestion_id')
      .notNull()
      .references(() => suggestions.id, { onDelete: 'cascade' }),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    action: text('action', {
      enum: ['accepted', 'edited', 'rejected'],
    }).notNull(),
    originalContent: text('original_content').notNull(),
    finalContent: text('final_content'),
    reason: text('reason'),
    clinicianUserId: text('clinician_user_id').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('suggestion_reviews_suggestion_idx').on(table.suggestionId),
    index('suggestion_reviews_encounter_idx').on(table.encounterId),
  ],
);

export const protocols = sqliteTable(
  'protocols',
  {
    id: text('id').primaryKey(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    status: text('status', { enum: ['draft', 'final'] })
      .notNull()
      .default('draft'),
    contentJson: text('content_json').notNull(),
    sourceReviewIdsJson: text('source_review_ids_json').notNull().default('[]'),
    generatedAt: integer('generated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    finalizedAt: integer('finalized_at', { mode: 'timestamp_ms' }),
    finalizedByUserId: text('finalized_by_user_id'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('protocols_encounter_version_uidx').on(
      table.encounterId,
      table.version,
    ),
  ],
);

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    encounterId: text('encounter_id').references(() => encounters.id, {
      onDelete: 'set null',
    }),
    actorUserId: text('actor_user_id').notNull(),
    eventType: text('event_type').notNull(),
    metadataJson: text('metadata_json').notNull().default('{}'),
    createdAt: createdAt(),
  },
  (table) => [
    index('audit_events_encounter_created_idx').on(
      table.encounterId,
      table.createdAt,
    ),
    index('audit_events_actor_created_idx').on(
      table.actorUserId,
      table.createdAt,
    ),
  ],
);
