// Synthetic browser fixture only; never imported by the application.
// Usage: node scripts/d-r3-persona-fixture.mjs work/personas/run-XXXXXX 3214
import assert from 'node:assert/strict';
import { realpath, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
assert(process.argv[2], 'Specify the fresh isolated work/personas/run-* directory');
const base = await realpath(join(root, 'work/personas'));
const target = await realpath(resolve(root, process.argv[2]));
const within = relative(base, target);
assert(within && !within.startsWith('..') && !isAbsolute(within), 'Isolated persona directory required');
const port = Number(process.argv[3]);
assert(Number.isInteger(port) && port >= 3213 && port <= 3299, 'Isolated test port required');
const origin = `http://127.0.0.1:${port}`;
const configPath = join(target, 'wrangler.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
assert.equal(config.name, 'orion-persona-test');
assert.equal(config.vars?.ORION_ENV, 'test');
assert.equal(config.vars?.ORION_SYNTHETIC_DATA_ONLY, 'true');
assert.equal(config.d1_databases?.length, 1);
assert.equal(config.d1_databases[0].database_name, 'orion-persona-test');
assert.equal(config.d1_databases[0].database_id, '00000000-0000-4000-8000-000000000000');
const manifestPath = join(target, 'd-r3-fixture.json');
await assert.rejects(access(manifestPath), 'Fixture already exists; use a fresh run');
const childEnv = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !/GROQ|SONIOX|OPENAI|API_KEY|TOKEN|SECRET|PASSWORD|^ORION_/i.test(key)));
Object.assign(childEnv, { WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' });
function sql(statement) {
  const result = spawnSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'),
    'd1', 'execute', 'orion-persona-test', '--config', configPath, '--local',
    '--persist-to', join(target, 'state'), '--command', statement, '--json'],
  { cwd: target, env: childEnv, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || 'Isolated fixture SQL failed');
  return JSON.parse(result.stdout);
}
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const empty = sql('SELECT (SELECT COUNT(*) FROM patients) AS patients, (SELECT COUNT(*) FROM encounters) AS encounters;')[0].results[0];
assert.deepEqual(empty, { patients: 0, encounters: 0 }, 'Fresh empty persona database required');
let cookie;
async function request(path, body) {
  const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { origin, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      'x-orion-facility-id': 'fac-a', 'x-orion-access-assignment-id': 'persona-doctor-assignment' },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(90_000) });
  const data = await response.json();
  assert(response.ok, `${path}: HTTP ${response.status} ${data.error?.code ?? 'request failed'}`);
  return data;
}
const login = await fetch(`${origin}/__test/select?persona=doctor`, {
  method: 'POST', headers: { origin }, redirect: 'manual', signal: AbortSignal.timeout(15_000),
});
assert.equal(login.status, 303);
cookie = login.headers.get('set-cookie')?.split(';')[0];
assert(cookie, 'Isolated persona cookie missing');
// Cross-check that the HTTP port serves the same fresh empty synthetic fixture.
const before = await request('/api/patients?facilityId=fac-a&accessAssignmentId=persona-doctor-assignment');
assert.equal(before.patients?.length, 0, 'HTTP runtime must also have an empty registry');
const { created } = await request('/api/workspace/encounters/create', {
  patient: { displayName: 'Искусственный пациент D-R3 — техническая проверка', birthDate: null, sexAtBirth: 'not_recorded' },
  reasonForVisit: 'Технический тест связи рекомендации с черновиком. Не клинический приём.',
  syntheticDataAcknowledged: true, idempotencyKey: randomUUID(),
});
const patientId = created.patient.id;
const encounterId = created.encounter.id;
// Exact cross-check prevents seeding an unrelated running persona database.
const createdInTarget = sql(`SELECT id FROM encounters WHERE id=${quote(encounterId)} AND patient_id=${quote(patientId)};`)[0].results;
assert.equal(createdInTarget.length, 1, 'HTTP runtime and isolated SQL target differ');
await request('/api/workspace/consents/command', { encounterId, consentType: 'care', decision: 'granted',
  noticeLanguage: 'ru', source: 'digital', expectedVersion: 0, idempotencyKey: randomUUID() });
await request('/api/workspace/encounters/transition', { encounterId, nextStatus: 'ready', expectedVersion: 1, idempotencyKey: randomUUID() });
await request('/api/workspace/encounters/transition', { encounterId, nextStatus: 'in_progress', expectedVersion: 2, idempotencyKey: randomUUID() });
const recommendationId = `d-r3-recommendation-${randomUUID()}`;
const analysisRunId = `d-r3-synthetic-analysis-${randomUUID()}`;
const now = Date.now();
const title = 'Тестовое обследование D-R3 — не медицинское назначение';
const content = 'Только техническая проверка: создать черновик тестового обследования и проверить сохранение происхождения. Реальное обследование не требуется.';
// The analysis/source is visibly synthetic. Acceptance uses the real API below.
sql(`INSERT INTO analysis_runs (id, organization_id, facility_id, encounter_id, kind, provider, model,
  model_version, policy_version, input_hash, source_record_ids_json, status, started_at, completed_at)
  VALUES (${quote(analysisRunId)}, 'org-a', 'fac-a', ${quote(encounterId)}, 'suggestions', 'synthetic', 'technical-fixture',
  '1', 'synthetic-policy-d-r3', ${quote('0'.repeat(64))}, '[]', 'succeeded', ${now}, ${now});
  INSERT INTO clinical_suggestions (id, organization_id, facility_id, encounter_id, analysis_run_id,
  category, risk_level, title, original_content, evidence_json)
  VALUES (${quote(recommendationId)}, 'org-a', 'fac-a', ${quote(encounterId)}, ${quote(analysisRunId)},
  'action', 'informational', ${quote(title)}, ${quote(content)}, '[]');
  INSERT INTO suggestion_review_heads (id, organization_id, facility_id, encounter_id, suggestion_id, state, current_decision_id, lock_version)
  VALUES (${quote('head-' + recommendationId)}, 'org-a', 'fac-a', ${quote(encounterId)}, ${quote(recommendationId)}, 'proposed', NULL, 1);`);
const accepted = await request('/api/workspace/recommendations/decision', { encounterId, recommendationId,
  decision: 'accept', derivativeVersionId: null, expectedVersion: 1, idempotencyKey: randomUUID() });
assert.equal(accepted.recommendation.review.state, 'accepted');
assert.equal(accepted.recommendation.review.version, 2);
const proof = sql(`SELECT h.suggestion_id AS recommendationId, h.state, h.lock_version AS version,
  d.id AS decisionId, d.access_assignment_id AS assignmentId, a.action AS auditAction,
  (SELECT COUNT(*) FROM service_requests) AS orderCount
  FROM suggestion_review_heads h JOIN review_decisions d ON d.id=h.current_decision_id
  JOIN audit_events a ON a.action='suggestion.accept' AND json_extract(a.metadata_json,'$.decisionId')=d.id
  WHERE h.suggestion_id=${quote(recommendationId)};`)[0].results;
assert.equal(proof.length, 1, 'Accepted decision audit proof missing');
assert.equal(proof[0].orderCount, 0, 'Fixture must not create an order');
const manifest = { syntheticOnly: true, runRoot: target, port, loginSelectionUrl: `${origin}/__test/personas`,
  patientId, encounterId, recommendationId, recommendationVersion: 2, derivativeVersionId: null, analysisRunId,
  accessAssignmentId: 'persona-doctor-assignment', facilityId: 'fac-a',
  workspaceUrl: `${origin}/?encounterId=${encodeURIComponent(encounterId)}&facilityId=fac-a&accessAssignmentId=persona-doctor-assignment`,
  proof };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
// Only the artificial fixture identifiers are printed; never the session cookie.
console.log(JSON.stringify(manifest, null, 2));
