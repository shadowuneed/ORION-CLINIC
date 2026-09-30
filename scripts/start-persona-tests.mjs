import { mkdtemp, mkdir, writeFile, realpath, access } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] ?? 3213);
if (!Number.isInteger(port) || port < 3213 || port > 3299) throw new Error('Test port must be 3213-3299');
const base = join(root, 'work', 'personas');
await mkdir(base, { recursive: true });
const resume = process.argv[3];
const runRoot = resume ? await realpath(resolve(root, resume)) : await mkdtemp(join(base, 'run-'));
const within = relative(await realpath(base), runRoot);
if (!within || within.startsWith('..') || isAbsolute(within)) throw new Error('Resume directory must be inside work/personas');
const config = join(runRoot, 'wrangler.json');
const state = join(runRoot, 'state');
if (resume) {
  await access(config);
  await access(state);
}
if (!resume) {
await writeFile(config, JSON.stringify({
  name: 'orion-persona-test', main: fileURLToPath(import.meta.resolve('vinext/server/app-router-entry')),
  compatibility_date: '2026-05-22', compatibility_flags: ['nodejs_compat'],
  vars: { ORION_ENV: 'test', ORION_BUILD_ID: 'persona-test', ORION_SYNTHETIC_DATA_ONLY: 'true' },
  d1_databases: [{ binding: 'DB', database_name: 'orion-persona-test', database_id: '00000000-0000-4000-8000-000000000000', migrations_dir: join(root, 'drizzle') }],
  r2_buckets: [{ binding: 'FILES', bucket_name: 'orion-persona-test' }],
}));
}
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/GROQ|SONIOX|OPENAI|API_KEY|TOKEN|SECRET|PASSWORD|^ORION_/i.test(key)));
Object.assign(childEnv, { ORION_PERSONA_TEST: '1', ORION_PERSONA_ROOT: runRoot, ORION_PERSONA_PORT: String(port),
  WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false', MINIFLARE_REGISTRY_PATH: join(runRoot, 'registry') });
function wrangler(args) {
  const result = spawnSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), ...args, '--config', config, '--local', '--persist-to', state], { cwd: runRoot, env: childEnv, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Test database setup failed');
}
if (!resume) {
wrangler(['d1', 'migrations', 'apply', 'orion-persona-test']);
wrangler(['d1', 'execute', 'orion-persona-test', '--file', join(root, 'db/bootstrap.local.sql')]);
const fixtures = ['doctor', 'nurse', 'administrator', 'registrar'].map(role => {
  const prefix = `persona-${role}`;
  const legacyRole = role === 'doctor' ? 'clinician' : role;
  return `
INSERT INTO users (id,external_issuer,external_subject,display_name,status) VALUES ('${prefix}','openai:sites','${prefix}','Test ${role}','active');
INSERT INTO memberships (id,organization_id,facility_id,user_id,role,status) VALUES ('${prefix}-member','org-a','fac-a','${prefix}','${legacyRole}','active');
INSERT INTO department_access_assignments (id,organization_id,facility_id,department_id,membership_id,created_by_membership_id,created_at) VALUES ('${prefix}-assignment','org-a','fac-a','department-a-general-medicine','${prefix}-member','membership-a',1704067200000);
INSERT INTO department_access_assignment_versions (id,organization_id,facility_id,assignment_id,department_id,membership_id,version,supersedes_version_id,status,source_type,roles_json,allow_permissions_json,deny_permissions_json,effective_from,effective_until,change_reason,changed_by_membership_id,changed_at,created_at) VALUES ('${prefix}-v1','org-a','fac-a','${prefix}-assignment','department-a-general-medicine','${prefix}-member',1,NULL,'active','bootstrap','["${role}"]','[]','[]',1704067200000,NULL,'isolated_persona_fixture','membership-a',1704067200000,1704067200000);
INSERT INTO department_access_assignment_heads (id,organization_id,facility_id,assignment_id,department_id,membership_id,current_version_id,lock_version,created_at,updated_at) VALUES ('${prefix}-head','org-a','fac-a','${prefix}-assignment','department-a-general-medicine','${prefix}-member','${prefix}-v1',1,1704067200000,1704067200000);`;
}).join('\n');
const fixtureFile = join(runRoot, 'personas.sql');
await writeFile(fixtureFile, fixtures);
wrangler(['d1', 'execute', 'orion-persona-test', '--file', fixtureFile]);
}
console.log(`Isolated state: ${runRoot}\nPersona login: http://127.0.0.1:${port}/__test/personas\nNo patient seed, provider credentials, or production authentication.`);
const child = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--config', join(root, 'vite.personas.config.ts'), '--mode', 'test'], { cwd: root, env: childEnv, stdio: 'inherit', windowsHide: true });
child.on('exit', code => { process.exitCode = code ?? 1; });
