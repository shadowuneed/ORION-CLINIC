import { realpath, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { seedCareConsent, seedReferral, seedSchedule } from './scheduling-persona-fixture.ts';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
if (!process.argv[2]) throw new Error('Specify an isolated work/personas/run-* directory');
const base = await realpath(join(root, 'work/personas'));
const target = await realpath(resolve(root, process.argv[2]));
const part = relative(base, target);
if (!part || part.startsWith('..') || isAbsolute(part)) throw new Error('Isolated persona directory required');
const configPath = join(target, 'wrangler.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
if (config.name !== 'orion-persona-test' || config.vars?.ORION_ENV !== 'test') throw new Error('Not a persona runtime');
const quote = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const sql = [];
const recorder = {
  prepare(statement) {
    return {
      get() { return { clinicianMembershipId: 'persona-doctor-member' }; },
      run(...values) {
        let index = 0;
        const rendered = statement.replace(/\?/g, () => quote(values[index++]));
        if (index !== values.length) throw new Error('Fixture binding mismatch');
        sql.push(rendered + ';');
      },
    };
  },
};
const now = Date.now() - 5000;
sql.push(`INSERT INTO patients (id,organization_id,facility_id,medical_record_number,display_name,status)
 VALUES ('persona-schedule-patient','org-a','fac-a','TEST-SCHEDULE-01','Искусственный пациент расписания','active');
 INSERT INTO encounters (id,organization_id,facility_id,patient_id,clinician_membership_id,status,reason_for_visit,started_at)
 VALUES ('persona-schedule-encounter','org-a','fac-a','persona-schedule-patient','persona-doctor-member','in_progress','Только проверка расписания',${now});`);
seedCareConsent(recorder, 'persona-schedule', 'persona-schedule-patient', 'persona-schedule-encounter', now);
seedReferral(recorder, 'persona-schedule', 'persona-schedule-patient', 'persona-schedule-encounter', now + 1);
seedSchedule(recorder, Date.now());
const output = join(target, 'scheduling-fixture.sql');
await writeFile(output, '-- Artificial isolated fixtures. Not clinical approvals. Apply once.\n' + sql.join('\n'));
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/GROQ|SONIOX|OPENAI|API_KEY|TOKEN|SECRET|PASSWORD|^ORION_/i.test(key)));
Object.assign(childEnv, { WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' });
const run = spawnSync(process.execPath, [join(root,'node_modules/wrangler/bin/wrangler.js'), 'd1','execute','orion-persona-test',
 '--config',configPath,'--local','--persist-to',join(target,'state'),'--file',output], { cwd: target, env: childEnv, encoding: 'utf8' });
if (run.status !== 0) throw new Error(run.stderr || run.stdout);
console.log('Isolated scheduling fixture imported. TEST-SCHEDULE-01; two windows in the next two hours.');
