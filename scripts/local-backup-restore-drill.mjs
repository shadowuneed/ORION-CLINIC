import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workRoot = join(projectRoot, 'work');
const wranglerPath = join(
  projectRoot,
  'node_modules',
  'wrangler',
  'bin',
  'wrangler.js',
);
const projectConfigPath = join(projectRoot, 'wrangler.jsonc');
const databaseName = 'orion-clinic-local';
const bucketName = 'orion-clinic-local';
const keepArtifacts = process.argv.includes('--keep');
const minimumFreeBytes = 64 * 1024 * 1024;

const recommendationDerivativeContent =
  'Врач уточнил: перечислить названия, дозировки, кратность и время последнего приёма всех препаратов.';
const recommendationDerivativeFixture = {
  id: 'backup-derivative-rec-1-v1',
  headId: 'backup-derivative-head-rec-1',
  decisionId: 'backup-review-decision-rec-1',
  suggestionId: 'rec-1',
  title: 'Уточнить текущую лекарственную терапию',
  content: recommendationDerivativeContent,
  reason: 'Клинически уточнена формулировка вопроса',
  contentHash: sha256(recommendationDerivativeContent),
  evidence: [
    {
      sourceId: 'conversation-gap',
      quote: 'В разговоре лекарства ещё не обсуждались',
    },
  ],
  provenance: {
    provider: 'synthetic',
    model: 'fixture',
    modelVersion: '1',
    policyVersion: 'synthetic-policy-1',
    inputHash: 'synthetic-workspace-input',
    sourceRecordIds: ['seg-002', 'seg-004'],
  },
  createdAt: Date.now() + 60_000,
};
recommendationDerivativeFixture.decidedAt =
  recommendationDerivativeFixture.createdAt + 1_000;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function quoteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQLite identifier: ${value}`);
  }
  return `"${value}"`;
}

function isInside(childPath, parentPath) {
  const pathFromParent = relative(resolve(parentPath), resolve(childPath));
  return (
    pathFromParent.length > 0 &&
    !pathFromParent.startsWith(`..${sep}`) &&
    pathFromParent !== '..' &&
    !isAbsolute(pathFromParent)
  );
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function assertFreshDirectory(path, allowedParent) {
  if (!isInside(path, allowedParent)) {
    throw new Error(`Refusing directory outside the drill root: ${path}`);
  }
  if (await pathExists(path)) {
    const entries = await readdir(path);
    if (entries.length > 0) {
      throw new Error(`Refusing non-empty restore target: ${path}`);
    }
  } else {
    await mkdir(path, { recursive: true });
  }
}

async function safeRemove(path, allowedParent) {
  if (!isInside(path, allowedParent)) {
    throw new Error(`Refusing removal outside the drill root: ${path}`);
  }
  await rm(path, { recursive: true, force: true });
}

function runWrangler(args) {
  const result = spawnSync(process.execPath, [wranglerPath, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: 'true',
      ORION_ENV: 'test',
      ORION_BUILD_ID: 'backup-restore-drill',
      ORION_SYNTHETIC_DATA_ONLY: 'true',
      WRANGLER_SEND_METRICS: 'false',
    },
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.error || result.status !== 0) {
    const detail = `${result.stderr ?? ''}\n${result.stdout ?? ''}`
      .trim()
      .slice(-8000);
    throw new Error(
      `Wrangler command failed (${args.slice(0, 3).join(' ')})${
        detail ? `:\n${detail}` : ''
      }`,
      { cause: result.error },
    );
  }

  return result.stdout;
}

function parseWranglerJson(output) {
  const starts = [output.indexOf('['), output.indexOf('{')].filter(
    (index) => index >= 0,
  );
  if (starts.length === 0) throw new Error('Wrangler returned no JSON payload');
  const start = Math.min(...starts);
  return JSON.parse(output.slice(start));
}

function runD1Json(statePath, configPath, command) {
  return parseWranglerJson(
    runWrangler([
      'd1',
      'execute',
      databaseName,
      '--local',
      '--persist-to',
      statePath,
      '--config',
      configPath,
      '--command',
      command,
      '--json',
    ]),
  );
}

function assertJsonResult(result, label) {
  if (!Array.isArray(result) || result.some((entry) => entry.success !== true)) {
    throw new Error(`${label} did not return successful D1 results`);
  }
}

async function databaseSnapshot(statePath, configPath) {
  const inspection = runD1Json(
    statePath,
    configPath,
    [
      // D1's local authorizer intentionally rejects the full integrity_check,
      // while quick_check is supported and still validates every table/index.
      'PRAGMA quick_check',
      'PRAGMA foreign_key_check',
      "SELECT name, type, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type, name",
      'SELECT id, name FROM d1_migrations ORDER BY id',
      `SELECT COUNT(*) AS broken_heads
       FROM audit_stream_heads head
       WHERE
         (head.last_sequence = 0 AND head.last_event_hash IS NOT NULL)
         OR (head.last_sequence > 0 AND NOT EXISTS (
           SELECT 1 FROM audit_events event
           WHERE event.organization_id = head.organization_id
             AND event.facility_id = head.facility_id
             AND event.sequence = head.last_sequence
             AND event.event_hash = head.last_event_hash
         ))`,
      `SELECT COUNT(*) AS broken_heads
       FROM access_audit_stream_heads head
       WHERE
         (head.last_sequence = 0 AND head.last_event_hash IS NOT NULL)
         OR (head.last_sequence > 0 AND NOT EXISTS (
           SELECT 1 FROM access_audit_events event
           WHERE event.organization_id = head.organization_id
             AND event.facility_id = head.facility_id
             AND event.stream_key = head.stream_key
             AND event.sequence = head.last_sequence
             AND event.event_hash = head.last_event_hash
         ))`,
    ].join(';'),
  );
  assertJsonResult(inspection, 'Database inspection');

  const integrityRows = inspection[0].results ?? [];
  const foreignKeyRows = inspection[1].results ?? [];
  const schemaRows = inspection[2].results ?? [];
  const migrationRows = inspection[3].results ?? [];
  const auditRows = inspection[4].results ?? [];
  const accessAuditRows = inspection[5].results ?? [];

  if (
    integrityRows.length !== 1 ||
    Object.values(integrityRows[0])[0] !== 'ok'
  ) {
    throw new Error('SQLite quick_check did not return ok');
  }
  if (foreignKeyRows.length !== 0) {
    throw new Error('SQLite foreign_key_check found violations');
  }
  if (Number(auditRows[0]?.broken_heads ?? -1) !== 0) {
    throw new Error('Audit stream head continuity check failed');
  }
  if (Number(accessAuditRows[0]?.broken_heads ?? -1) !== 0) {
    throw new Error('Access audit stream head continuity check failed');
  }

  const tableNames = schemaRows
    .filter((entry) => entry.type === 'table')
    .map((entry) => entry.name)
    .sort();
  const tableQueries = tableNames
    .map((tableName) => `SELECT * FROM ${quoteIdentifier(tableName)}`)
    .join(';');
  const tableResults = runD1Json(statePath, configPath, tableQueries);
  assertJsonResult(tableResults, 'Table snapshot');

  const tables = tableNames.map((tableName, index) => {
    const rows = (tableResults[index]?.results ?? [])
      .map((row) => canonicalize(row))
      .sort((left, right) =>
        canonicalJson(left).localeCompare(canonicalJson(right)),
      );
    return { tableName, rows };
  });

  return {
    schemaSha256: sha256(canonicalJson(schemaRows)),
    dataSha256: sha256(canonicalJson(tables)),
    tableCount: tableNames.length,
    rowCount: tables.reduce((total, table) => total + table.rows.length, 0),
    migrations: migrationRows.map((entry) => entry.name),
  };
}

async function copyDrillConfiguration(sourceDirectory) {
  await cp(projectConfigPath, join(sourceDirectory, 'wrangler.jsonc'));
  await cp(join(projectRoot, 'drizzle'), join(sourceDirectory, 'drizzle'), {
    recursive: true,
  });
  return join(sourceDirectory, 'wrangler.jsonc');
}

async function writeFixtureObjects(sourceDirectory, sourceState, configPath) {
  const fixtureDirectory = join(sourceDirectory, 'fixture-input');
  await mkdir(fixtureDirectory, { recursive: true });

  const fixtures = [
    {
      key: 'artifacts/encounter-a/protocol.pdf',
      contentType: 'application/pdf',
      body: Buffer.from(
        '%PDF-1.4\n% ORION synthetic backup fixture only\n%%EOF\n',
        'utf8',
      ),
      reference: 'document',
    },
    {
      // Keep CLI fixture keys URL-safe. Wrangler's local object command stores
      // non-ASCII path segments percent-encoded, which would make a D1 key
      // differ from the key visible through the local CLI.
      key: 'audio/encounter-a/kazakh-sample.raw',
      contentType: 'application/octet-stream',
      body: Buffer.from([0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144]),
      reference: 'audio',
    },
    {
      key: 'consent/encounter-a/empty.txt',
      contentType: 'text/plain; charset=utf-8',
      body: Buffer.alloc(0),
      reference: 'consent',
    },
  ].map((fixture) => ({
    ...fixture,
    sha256: sha256(fixture.body),
    byteSize: fixture.body.length,
  }));

  for (const fixture of fixtures) {
    const inputPath = join(fixtureDirectory, `${sha256(fixture.key)}.bin`);
    await writeFile(inputPath, fixture.body);
    runWrangler([
      'r2',
      'object',
      'put',
      `${bucketName}/${fixture.key}`,
      '--local',
      '--persist-to',
      sourceState,
      '--config',
      configPath,
      '--file',
      inputPath,
      '--content-type',
      fixture.contentType,
      '--force',
    ]);
  }

  return fixtures;
}

function buildCrossStoreFixtureSql(fixtures) {
  const document = fixtures.find((fixture) => fixture.reference === 'document');
  const audio = fixtures.find((fixture) => fixture.reference === 'audio');
  const consent = fixtures.find((fixture) => fixture.reference === 'consent');
  if (!document || !audio || !consent) {
    throw new Error('Backup fixtures are incomplete');
  }

  const accessAuditFixture = {
    previousHash: null,
    organizationId: 'org-a',
    facilityId: 'fac-a',
    streamKey: 'membership:membership-a',
    sequence: 1,
    actorUserId: 'user-a',
    actorMembershipId: 'membership-a',
    actorRole: 'clinician',
    action: 'workspace.read',
    outcome: 'succeeded',
    purposeCode: 'synthetic_direct_patient_care',
    routeCode: 'workspace',
    decisionCode: 'authorized_response_prepared',
    responseStatus: 200,
    encounterId: 'encounter-a',
    documentArtifactId: null,
    artifactKind: null,
    requestId: 'backup-access-workspace-read-a',
    schemaVersion: 1,
    occurredAt: 1787917000000,
  };
  const accessEventHash = sha256(
    JSON.stringify({
      hashDomain: 'orion.access-audit.v1',
      ...accessAuditFixture,
    }),
  );

  return `
    INSERT INTO document_artifacts (
      id, organization_id, facility_id, encounter_id, protocol_version_id,
      kind, object_key, mime_type, sha256, byte_size, status,
      created_by_membership_id, created_at
    ) VALUES (
      'backup-document-a', 'org-a', 'fac-a', 'encounter-a', NULL,
      'protocol_pdf', ${sqlLiteral(document.key)}, ${sqlLiteral(document.contentType)},
      ${sqlLiteral(document.sha256)}, ${document.byteSize}, 'ready',
      'membership-a', 1787917000000
    );
    INSERT INTO audio_assets (
      id, organization_id, facility_id, encounter_id, object_key, mime_type,
      sha256, byte_size, duration_ms, retention_state,
      created_by_membership_id, created_at
    ) VALUES (
      'backup-audio-a', 'org-a', 'fac-a', 'encounter-a',
      ${sqlLiteral(audio.key)}, ${sqlLiteral(audio.contentType)},
      ${sqlLiteral(audio.sha256)}, ${audio.byteSize}, 1200, 'retained',
      'membership-a', 1787917000000
    );
    INSERT INTO consent_events (
      id, organization_id, facility_id, patient_id, encounter_id, version,
      consent_type, decision, captured_by_membership_id, policy_version, policy_hash,
      notice_language, external_processor, evidence_object_key, source,
      occurred_at, effective_at, expires_at, supersedes_consent_event_id,
      created_at
    ) VALUES (
      'backup-consent-a', 'org-a', 'fac-a', 'patient-a', 'encounter-a', 1,
      'audio_retention',
      'granted', 'membership-a', 'synthetic-backup-policy-1',
      'synthetic-backup-policy-hash', 'kk', NULL, ${sqlLiteral(consent.key)},
      'digital', 1787917000000, 1787917000000, NULL, NULL, 1787917000000
    );
    INSERT INTO consent_heads (
      id, organization_id, facility_id, patient_id, encounter_id, consent_type,
      current_consent_event_id, lock_version, created_at, updated_at
    ) VALUES (
      'backup-consent-head-a', 'org-a', 'fac-a', 'patient-a', 'encounter-a',
      'audio_retention', 'backup-consent-a', 1, 1787917000000, 1787917000000
    );
    INSERT INTO access_audit_stream_heads (
      id, organization_id, facility_id, stream_key, actor_membership_id,
      last_sequence, last_event_hash, lock_version, updated_at
    ) VALUES (
      'backup-access-head-a', 'org-a', 'fac-a',
      'membership:membership-a', 'membership-a', 0, NULL, 1, 1787917000000
    );
    INSERT INTO access_audit_events (
      id, organization_id, facility_id, stream_key, sequence,
      actor_user_id, actor_membership_id, actor_role, action, outcome,
      purpose_code, route_code, decision_code, response_status, encounter_id,
      document_artifact_id, artifact_kind, request_id, schema_version,
      previous_hash, event_hash, occurred_at
    ) VALUES (
      'backup-access-event-a', 'org-a', 'fac-a',
      'membership:membership-a', 1, 'user-a', 'membership-a', 'clinician',
      'workspace.read', 'succeeded', 'synthetic_direct_patient_care',
      'workspace', 'authorized_response_prepared', 200, 'encounter-a',
      NULL, NULL, 'backup-access-workspace-read-a', 1, NULL,
      ${sqlLiteral(accessEventHash)}, 1787917000000
    );
    UPDATE access_audit_stream_heads
    SET last_sequence = 1, last_event_hash = ${sqlLiteral(accessEventHash)},
      lock_version = 2, updated_at = 1787917000000
    WHERE id = 'backup-access-head-a';
    INSERT INTO suggestion_derivative_versions (
      id, organization_id, facility_id, encounter_id, suggestion_id, version,
      title, content, reason, content_hash, evidence_json, provenance_json,
      authored_by_membership_id, supersedes_derivative_version_id, created_at
    ) VALUES (
      ${sqlLiteral(recommendationDerivativeFixture.id)},
      'org-a', 'fac-a', 'encounter-a',
      ${sqlLiteral(recommendationDerivativeFixture.suggestionId)}, 1,
      ${sqlLiteral(recommendationDerivativeFixture.title)},
      ${sqlLiteral(recommendationDerivativeFixture.content)},
      ${sqlLiteral(recommendationDerivativeFixture.reason)},
      ${sqlLiteral(recommendationDerivativeFixture.contentHash)},
      ${sqlLiteral(JSON.stringify(recommendationDerivativeFixture.evidence))},
      ${sqlLiteral(JSON.stringify(recommendationDerivativeFixture.provenance))},
      'membership-a', NULL, ${recommendationDerivativeFixture.createdAt}
    );
    INSERT INTO suggestion_derivative_heads (
      id, organization_id, facility_id, encounter_id, suggestion_id,
      current_derivative_version_id, lock_version, updated_at
    ) VALUES (
      ${sqlLiteral(recommendationDerivativeFixture.headId)},
      'org-a', 'fac-a', 'encounter-a',
      ${sqlLiteral(recommendationDerivativeFixture.suggestionId)},
      ${sqlLiteral(recommendationDerivativeFixture.id)}, 1,
      ${recommendationDerivativeFixture.createdAt}
    );
    UPDATE suggestion_review_heads
       SET lock_version = 2,
           updated_at = ${recommendationDerivativeFixture.createdAt}
     WHERE id = 'head-rec-1'
       AND state = 'proposed'
       AND current_decision_id IS NULL
       AND lock_version = 1;
    INSERT INTO review_decisions (
      id, organization_id, facility_id, encounter_id, suggestion_id,
      reviewer_membership_id, sequence, expected_version, idempotency_key,
      decision, result_state, reviewed_derivative_version_id, edited_content,
      reason, decided_at, created_at
    ) VALUES (
      ${sqlLiteral(recommendationDerivativeFixture.decisionId)},
      'org-a', 'fac-a', 'encounter-a',
      ${sqlLiteral(recommendationDerivativeFixture.suggestionId)},
      'membership-a', 2, 2, 'backup-accept-derivative-rec-1-v1',
      'accept', 'edited_and_accepted',
      ${sqlLiteral(recommendationDerivativeFixture.id)}, NULL,
      'Принята проверенная версия врача',
      ${recommendationDerivativeFixture.decidedAt},
      ${recommendationDerivativeFixture.decidedAt}
    );
    UPDATE suggestion_review_heads
       SET state = 'edited_and_accepted',
           current_decision_id = ${sqlLiteral(recommendationDerivativeFixture.decisionId)},
           lock_version = 3,
           updated_at = ${recommendationDerivativeFixture.decidedAt}
     WHERE id = 'head-rec-1'
       AND state = 'proposed'
       AND current_decision_id IS NULL
       AND lock_version = 2;
  `;
}

async function createBackup(
  sourceState,
  sourceConfig,
  backupDirectory,
  fixtures,
  sourceSnapshot,
) {
  await mkdir(join(backupDirectory, 'r2', 'objects'), { recursive: true });
  const databaseParts = [
    { kind: 'schema', file: 'd1-schema.sql', exportFlag: '--no-data' },
    { kind: 'data', file: 'd1-data.sql', exportFlag: '--no-schema' },
  ];

  for (const part of databaseParts) {
    runWrangler([
      'd1',
      'export',
      databaseName,
      '--local',
      '--config',
      sourceConfig,
      '--output',
      join(backupDirectory, part.file),
      part.exportFlag,
      '--skip-confirmation',
    ]);
  }

  const objectEntries = [];
  for (const fixture of fixtures) {
    const bodyFile = `r2/objects/${sha256(fixture.key)}.bin`;
    const absoluteBodyFile = join(backupDirectory, ...bodyFile.split('/'));
    runWrangler([
      'r2',
      'object',
      'get',
      `${bucketName}/${fixture.key}`,
      '--local',
      '--persist-to',
      sourceState,
      '--config',
      sourceConfig,
      '--file',
      absoluteBodyFile,
    ]);
    const body = await readFile(absoluteBodyFile);
    if (sha256(body) !== fixture.sha256 || body.length !== fixture.byteSize) {
      throw new Error(`Source R2 verification failed for ${fixture.key}`);
    }
    objectEntries.push({
      key: fixture.key,
      bodyFile,
      contentType: fixture.contentType,
      byteSize: fixture.byteSize,
      sha256: fixture.sha256,
    });
  }

  objectEntries.sort((left, right) => left.key.localeCompare(right.key));
  const databaseFiles = [];
  for (const part of databaseParts) {
    const body = await readFile(join(backupDirectory, part.file));
    databaseFiles.push({
      kind: part.kind,
      file: part.file,
      byteSize: body.length,
      sha256: sha256(body),
    });
  }
  const manifest = {
    format: 'orion-local-synthetic-backup-v1',
    createdAt: new Date().toISOString(),
    database: {
      name: databaseName,
      files: databaseFiles,
    },
    objectStore: {
      bucket: bucketName,
      objects: objectEntries,
    },
    sourceSnapshot,
  };
  const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(join(backupDirectory, 'manifest.json'), manifestBody, 'utf8');
  await writeFile(
    join(backupDirectory, 'COMPLETE.json'),
    `${JSON.stringify(
      {
        format: manifest.format,
        manifestSha256: sha256(manifestBody),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return manifest;
}

async function resolveBackupFile(backupDirectory, relativePath) {
  const resolvedPath = resolve(backupDirectory, ...relativePath.split('/'));
  if (!isInside(resolvedPath, backupDirectory)) {
    throw new Error(`Unsafe backup path: ${relativePath}`);
  }
  return resolvedPath;
}

async function verifyBackup(backupDirectory) {
  const markerPath = join(backupDirectory, 'COMPLETE.json');
  const manifestPath = join(backupDirectory, 'manifest.json');
  const markerBody = await readFile(markerPath, 'utf8');
  const manifestBody = await readFile(manifestPath, 'utf8');
  const marker = JSON.parse(markerBody);
  const manifest = JSON.parse(manifestBody);

  if (marker.format !== manifest.format) {
    throw new Error('Backup marker and manifest formats differ');
  }
  if (marker.manifestSha256 !== sha256(manifestBody)) {
    throw new Error('Backup manifest hash mismatch');
  }

  const databaseKinds = new Set();
  for (const databaseFile of manifest.database.files ?? []) {
    if (databaseKinds.has(databaseFile.kind)) {
      throw new Error('Backup manifest contains duplicate D1 parts');
    }
    databaseKinds.add(databaseFile.kind);
    const absoluteDatabaseFile = await resolveBackupFile(
      backupDirectory,
      databaseFile.file,
    );
    const databaseBody = await readFile(absoluteDatabaseFile);
    if (
      databaseBody.length !== databaseFile.byteSize ||
      sha256(databaseBody) !== databaseFile.sha256
    ) {
      throw new Error(`D1 ${databaseFile.kind} backup file hash mismatch`);
    }
  }
  if (!databaseKinds.has('schema') || !databaseKinds.has('data')) {
    throw new Error('Backup manifest is missing a D1 schema or data part');
  }

  const keys = new Set();
  const bodyFiles = new Set();
  for (const object of manifest.objectStore.objects) {
    if (keys.has(object.key) || bodyFiles.has(object.bodyFile)) {
      throw new Error('Backup manifest contains duplicate R2 entries');
    }
    keys.add(object.key);
    bodyFiles.add(object.bodyFile);
    const bodyFile = await resolveBackupFile(backupDirectory, object.bodyFile);
    const body = await readFile(bodyFile);
    if (body.length !== object.byteSize || sha256(body) !== object.sha256) {
      throw new Error(`R2 backup file hash mismatch for ${object.key}`);
    }
  }

  return manifest;
}

async function restoreBackup(
  backupDirectory,
  restoreState,
  restoreCheckDirectory,
  manifest,
) {
  await assertFreshDirectory(restoreState, dirname(restoreState));
  await mkdir(restoreCheckDirectory, { recursive: true });

  const databasePart = (kind) => {
    const part = manifest.database.files.find((entry) => entry.kind === kind);
    if (!part) throw new Error(`Backup is missing the D1 ${kind} part`);
    return part;
  };

  runWrangler([
    'd1',
    'execute',
    databaseName,
    '--local',
    '--persist-to',
    restoreState,
    '--config',
    projectConfigPath,
    '--file',
    await resolveBackupFile(
      backupDirectory,
      databasePart('schema').file,
    ),
    '--yes',
  ]);

  // Exported tables are alphabetical. Creating the complete schema first
  // makes every foreign-key target available, but integrity triggers must be
  // recreated after the trusted, hash-verified data import because some head
  // rows sort before their immutable version rows.
  const triggerResult = runD1Json(
    restoreState,
    projectConfigPath,
    "SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' ORDER BY name",
  );
  assertJsonResult(triggerResult, 'Restore trigger inventory');
  const triggers = triggerResult[0]?.results ?? [];
  if (triggers.length > 0) {
    const dropTriggersFile = join(
      restoreCheckDirectory,
      'drop-integrity-triggers.sql',
    );
    await writeFile(
      dropTriggersFile,
      `${triggers
        .map((trigger) => `DROP TRIGGER ${quoteIdentifier(trigger.name)};`)
        .join('\n')}\n`,
      'utf8',
    );
    runWrangler([
      'd1',
      'execute',
      databaseName,
      '--local',
      '--persist-to',
      restoreState,
      '--config',
      projectConfigPath,
      '--file',
      dropTriggersFile,
      '--yes',
    ]);
  }

  runWrangler([
    'd1',
    'execute',
    databaseName,
    '--local',
    '--persist-to',
    restoreState,
    '--config',
    projectConfigPath,
    '--file',
    await resolveBackupFile(backupDirectory, databasePart('data').file),
    '--yes',
  ]);

  for (const trigger of triggers) {
    if (typeof trigger.sql !== 'string' || trigger.sql.length === 0) {
      throw new Error(`Trigger ${trigger.name} has no SQL definition`);
    }
  }
  if (triggers.length > 0) {
    const restoreTriggersFile = join(
      restoreCheckDirectory,
      'restore-integrity-triggers.sql',
    );
    await writeFile(
      restoreTriggersFile,
      `${triggers.map((trigger) => `${trigger.sql};`).join('\n')}\n`,
      'utf8',
    );
    runWrangler([
      'd1',
      'execute',
      databaseName,
      '--local',
      '--persist-to',
      restoreState,
      '--config',
      projectConfigPath,
      '--file',
      restoreTriggersFile,
      '--yes',
    ]);
  }

  for (const object of manifest.objectStore.objects) {
    const bodyFile = await resolveBackupFile(backupDirectory, object.bodyFile);
    runWrangler([
      'r2',
      'object',
      'put',
      `${bucketName}/${object.key}`,
      '--local',
      '--persist-to',
      restoreState,
      '--config',
      projectConfigPath,
      '--file',
      bodyFile,
      '--content-type',
      object.contentType,
      '--force',
    ]);

    const restoredFile = join(
      restoreCheckDirectory,
      `${sha256(object.key)}.bin`,
    );
    runWrangler([
      'r2',
      'object',
      'get',
      `${bucketName}/${object.key}`,
      '--local',
      '--persist-to',
      restoreState,
      '--config',
      projectConfigPath,
      '--file',
      restoredFile,
    ]);
    const body = await readFile(restoredFile);
    if (body.length !== object.byteSize || sha256(body) !== object.sha256) {
      throw new Error(`Restored R2 verification failed for ${object.key}`);
    }
  }
}

function assertSnapshotsEqual(source, restored) {
  for (const key of [
    'schemaSha256',
    'dataSha256',
    'tableCount',
    'rowCount',
  ]) {
    if (source[key] !== restored[key]) {
      throw new Error(`Restored database ${key} differs from the source`);
    }
  }
  if (canonicalJson(source.migrations) !== canonicalJson(restored.migrations)) {
    throw new Error('Restored migration history differs from the source');
  }
}

async function verifyExpectedMigrationFiles(snapshot) {
  const expected = (await readdir(join(projectRoot, 'drizzle'), {
    withFileTypes: true,
  }))
    .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (canonicalJson(snapshot.migrations) !== canonicalJson(expected)) {
    throw new Error('Applied migration history does not match the repository');
  }
}

function verifyCrossStoreReferences(restoreState, manifest) {
  const result = runD1Json(
    restoreState,
    projectConfigPath,
    `SELECT 'document' AS source, object_key,
            sha256 AS expected_sha256, byte_size AS expected_byte_size
       FROM document_artifacts WHERE status = 'ready'
     UNION ALL
     SELECT 'audio' AS source, object_key,
            sha256 AS expected_sha256, byte_size AS expected_byte_size
       FROM audio_assets WHERE retention_state <> 'deleted'
     UNION ALL
     SELECT 'consent' AS source, evidence_object_key AS object_key,
            NULL AS expected_sha256, NULL AS expected_byte_size
       FROM consent_events WHERE evidence_object_key IS NOT NULL
     ORDER BY object_key`,
  );
  assertJsonResult(result, 'Cross-store reference query');
  const references = result[0]?.results ?? [];
  const objectsByKey = new Map(
    manifest.objectStore.objects.map((object) => [object.key, object]),
  );

  if (references.length !== 3) {
    throw new Error('Synthetic cross-store fixture count is unexpected');
  }
  for (const reference of references) {
    const object = objectsByKey.get(reference.object_key);
    if (!object) {
      throw new Error(`Missing object for ${reference.source} reference`);
    }
    if (
      reference.expected_sha256 &&
      reference.expected_sha256 !== object.sha256
    ) {
      throw new Error(`Object hash differs for ${reference.source} reference`);
    }
    if (
      reference.expected_byte_size !== null &&
      Number(reference.expected_byte_size) !== object.byteSize
    ) {
      throw new Error(`Object size differs for ${reference.source} reference`);
    }
  }
}

function verifyRecommendationDerivativeRecovery(restoreState) {
  const result = runD1Json(
    restoreState,
    projectConfigPath,
    `SELECT derivative.id AS derivative_id,
            derivative.version AS derivative_version,
            derivative.title AS derivative_title,
            derivative.content AS derivative_content,
            derivative.reason AS derivative_reason,
            derivative.content_hash,
            derivative.evidence_json,
            derivative.provenance_json,
            derivative.authored_by_membership_id,
            derivative.supersedes_derivative_version_id,
            derivative_head.current_derivative_version_id,
            derivative_head.lock_version AS derivative_lock_version,
            review_head.state AS review_state,
            review_head.current_decision_id,
            review_head.lock_version AS review_lock_version,
            decision.decision,
            decision.result_state,
            decision.reviewed_derivative_version_id,
            decision.sequence AS decision_sequence,
            decision.expected_version,
            suggestion.original_content
       FROM suggestion_derivative_versions derivative
       JOIN suggestion_derivative_heads derivative_head
         ON derivative_head.organization_id = derivative.organization_id
        AND derivative_head.facility_id = derivative.facility_id
        AND derivative_head.encounter_id = derivative.encounter_id
        AND derivative_head.suggestion_id = derivative.suggestion_id
        AND derivative_head.current_derivative_version_id = derivative.id
       JOIN suggestion_review_heads review_head
         ON review_head.organization_id = derivative.organization_id
        AND review_head.facility_id = derivative.facility_id
        AND review_head.encounter_id = derivative.encounter_id
        AND review_head.suggestion_id = derivative.suggestion_id
       JOIN review_decisions decision
         ON decision.organization_id = review_head.organization_id
        AND decision.facility_id = review_head.facility_id
        AND decision.encounter_id = review_head.encounter_id
        AND decision.suggestion_id = review_head.suggestion_id
        AND decision.id = review_head.current_decision_id
       JOIN clinical_suggestions suggestion
         ON suggestion.organization_id = derivative.organization_id
        AND suggestion.facility_id = derivative.facility_id
        AND suggestion.encounter_id = derivative.encounter_id
        AND suggestion.id = derivative.suggestion_id
      WHERE derivative.id = ${sqlLiteral(recommendationDerivativeFixture.id)}`,
  );
  assertJsonResult(result, 'Recommendation derivative recovery query');
  const rows = result[0]?.results ?? [];
  if (rows.length !== 1) {
    throw new Error('Recovered recommendation derivative fixture is missing or duplicated');
  }

  const row = rows[0];
  const expectedFields = {
    derivative_id: recommendationDerivativeFixture.id,
    derivative_version: 1,
    derivative_title: recommendationDerivativeFixture.title,
    derivative_content: recommendationDerivativeFixture.content,
    derivative_reason: recommendationDerivativeFixture.reason,
    content_hash: recommendationDerivativeFixture.contentHash,
    authored_by_membership_id: 'membership-a',
    supersedes_derivative_version_id: null,
    current_derivative_version_id: recommendationDerivativeFixture.id,
    derivative_lock_version: 1,
    review_state: 'edited_and_accepted',
    current_decision_id: recommendationDerivativeFixture.decisionId,
    review_lock_version: 3,
    decision: 'accept',
    result_state: 'edited_and_accepted',
    reviewed_derivative_version_id: recommendationDerivativeFixture.id,
    decision_sequence: 2,
    expected_version: 2,
  };
  for (const [field, expected] of Object.entries(expectedFields)) {
    if (row[field] !== expected) {
      throw new Error(`Recovered recommendation derivative ${field} differs from the source fixture`);
    }
  }
  if (
    canonicalJson(JSON.parse(row.evidence_json)) !==
      canonicalJson(recommendationDerivativeFixture.evidence) ||
    canonicalJson(JSON.parse(row.provenance_json)) !==
      canonicalJson(recommendationDerivativeFixture.provenance)
  ) {
    throw new Error('Recovered recommendation derivative evidence or provenance differs');
  }
  if (
    typeof row.original_content !== 'string' ||
    row.original_content.length === 0 ||
    row.original_content === row.derivative_content
  ) {
    throw new Error('Recovered immutable AI original is missing or was replaced by the clinician derivative');
  }
}

async function verifyRestoreGuard(runRoot) {
  const nonEmptyTarget = join(runRoot, 'guard-self-test');
  await mkdir(nonEmptyTarget, { recursive: true });
  await writeFile(join(nonEmptyTarget, 'must-not-overwrite.txt'), 'guard', 'utf8');
  let refused = false;
  try {
    await assertFreshDirectory(nonEmptyTarget, runRoot);
  } catch {
    refused = true;
  }
  if (!refused) throw new Error('Non-empty restore target guard did not fail');
}

async function main() {
  const startedAt = Date.now();
  let runRoot;
  let succeeded = false;

  try {
    await access(wranglerPath);
    await mkdir(workRoot, { recursive: true });
    const disk = await statfs(workRoot);
    if (Number(disk.bavail) * Number(disk.bsize) < minimumFreeBytes) {
      throw new Error('Insufficient free disk space for the recovery drill');
    }

    runRoot = await mkdtemp(join(workRoot, 'backup-restore-'));
    const sourceDirectory = join(runRoot, 'source');
    const sourceState = join(sourceDirectory, '.wrangler', 'state');
    const backupDirectory = join(runRoot, 'backup');
    const restoreState = join(runRoot, 'restore-state');
    const restoreCheckDirectory = join(runRoot, 'restore-check');

    await assertFreshDirectory(sourceDirectory, runRoot);
    await assertFreshDirectory(backupDirectory, runRoot);
    await verifyRestoreGuard(runRoot);
    const sourceConfig = await copyDrillConfiguration(sourceDirectory);

    console.log('[1/6] Creating an isolated synthetic D1/R2 source');
    runWrangler([
      'd1',
      'migrations',
      'apply',
      databaseName,
      '--local',
      '--persist-to',
      sourceState,
      '--config',
      sourceConfig,
    ]);
    runWrangler([
      'd1',
      'execute',
      databaseName,
      '--local',
      '--persist-to',
      sourceState,
      '--config',
      sourceConfig,
      '--file',
      join(projectRoot, 'db', 'seed.local.sql'),
      '--yes',
    ]);
    const fixtures = await writeFixtureObjects(
      sourceDirectory,
      sourceState,
      sourceConfig,
    );
    runWrangler([
      'd1',
      'execute',
      databaseName,
      '--local',
      '--persist-to',
      sourceState,
      '--config',
      sourceConfig,
      '--command',
      buildCrossStoreFixtureSql(fixtures),
      '--yes',
    ]);

    console.log('[2/6] Verifying source integrity and migration history');
    const sourceSnapshot = await databaseSnapshot(sourceState, sourceConfig);
    await verifyExpectedMigrationFiles(sourceSnapshot);

    console.log('[3/6] Writing and hashing the logical backup');
    await createBackup(
      sourceState,
      sourceConfig,
      backupDirectory,
      fixtures,
      sourceSnapshot,
    );
    const manifest = await verifyBackup(backupDirectory);

    console.log('[4/6] Removing only the isolated source environment');
    await safeRemove(sourceDirectory, runRoot);
    if (await pathExists(sourceDirectory)) {
      throw new Error('Isolated source environment still exists after removal');
    }

    console.log('[5/6] Restoring into a new empty local environment');
    await restoreBackup(
      backupDirectory,
      restoreState,
      restoreCheckDirectory,
      manifest,
    );

    console.log('[6/6] Comparing D1, R2, audit, and cross-store integrity');
    const restoredSnapshot = await databaseSnapshot(
      restoreState,
      projectConfigPath,
    );
    assertSnapshotsEqual(sourceSnapshot, restoredSnapshot);
    verifyCrossStoreReferences(restoreState, manifest);
    verifyRecommendationDerivativeRecovery(restoreState);

    const databaseBytes = manifest.database.files.reduce(
      (total, file) => total + file.byteSize,
      0,
    );
    const objectBytes = manifest.objectStore.objects.reduce(
      (total, object) => total + object.byteSize,
      0,
    );
    const result = {
      status: 'PASS',
      mode: 'local-synthetic-only',
      sourceDestroyedBeforeRestore: true,
      elapsedMs: Date.now() - startedAt,
      tables: restoredSnapshot.tableCount,
      rows: restoredSnapshot.rowCount,
      migrations: restoredSnapshot.migrations.length,
      r2Objects: manifest.objectStore.objects.length,
      backupBytes: databaseBytes + objectBytes,
      runId: randomUUID(),
    };
    console.log(JSON.stringify(result, null, 2));
    succeeded = true;

    if (keepArtifacts) {
      console.log(`Drill artifacts kept at: ${runRoot}`);
    }
  } finally {
    if (runRoot && succeeded && !keepArtifacts) {
      await safeRemove(runRoot, workRoot);
    } else if (runRoot && !succeeded) {
      console.error(`Failed drill evidence kept at: ${runRoot}`);
    }
  }
}

await main();
