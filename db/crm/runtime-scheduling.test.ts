import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { availableSlots, clinicDay } from '../../lib/crm/scheduling';
import type { CrmCommand, CrmCommandResult } from '../../lib/crm/contracts';
import { readCrmLocalConfig } from '../../scripts/crm-local-config';
import { createCrmPostgresRepository } from '../../scripts/crm-postgres-repository';

// A second explicit opt-in: this proof RETAINS exactly one synthetic appointment
// and its automatically linked preparation task in the dedicated demo clinic.
it.runIf(process.env.ORION_CRM_RUNTIME_TEST === '1')('committed parallel booking has one winner, exact replay and durable frozen duration', async () => {
  const localBase = process.env.LOCALAPPDATA;
  if (!localBase) throw new Error('Dedicated CRM runtime required');
  const base = join(localBase, 'ORION-Clinic-CRM');
  const marker = JSON.parse(readFileSync(join(base, 'cluster-owner.json'), 'utf8'));
  if (marker.kind !== 'orion-crm-local-v1' || marker.port !== 55432 ||
    resolve(marker.data).toLowerCase() !== resolve(base, 'data').toLowerCase()) throw new Error('Owned CRM marker mismatch');
  const admin = JSON.parse(readFileSync(join(base, 'admin.json'), 'utf8'));
  if (admin.host !== '127.0.0.1' || admin.port !== 55432 || admin.user !== 'postgres' ||
    typeof admin.password !== 'string') throw new Error('Owned CRM admin configuration mismatch');
  const { password } = admin;
  const pool = new Pool({ host: '127.0.0.1', port: 55432, database: 'orion_crm_local', user: 'postgres',
    password, ssl: false, max: 1, connectionTimeoutMillis: 3000, statement_timeout: 5000,
    application_name: 'orion-crm-explicit-runtime-proof' });
  const runtime = readCrmLocalConfig();
  if (!runtime) { await pool.end(); throw new Error('Dedicated CRM app configuration required'); }
  const repository = createCrmPostgresRepository(runtime);
  try {
    const directory = await pool.query('SHOW data_directory');
    if (realpathSync(directory.rows[0].data_directory).toLowerCase() !== realpathSync(marker.data).toLowerCase()) {
      throw new Error('Unexpected CRM database directory');
    }
    const owner = await pool.query("SELECT issuer,subject FROM orion_crm.actor_grants WHERE id='crm-local-operator' AND active AND can_read AND can_manage");
    const actor = owner.rows[0];
    if (!actor) throw new Error('Exact authorised CRM simulation operator required');
    const before = await repository.snapshot(actor);
    const resources = { patientId: 'patient-test-12', staffId: 'staff-nurse', roomId: 'room-treatment', serviceId: 'service-preparation' };
    const patient = before.patients.find(row=>row.id===resources.patientId);
    const service = before.services.find(row=>row.id===resources.serviceId);
    if (!patient?.mrn.startsWith('CRM-TEST-') || !service || !before.calendar) throw new Error('Exact synthetic calendar/records required');
    const day = clinicDay(before.generatedAt, before.calendar.timeZone);
    if (!day) throw new Error('Clinic date unavailable');
    let scheduledAt: string | undefined;
    for (let offset=1; offset<=14 && !scheduledAt; offset++) {
      const candidateDay = new Date(Date.parse(`${day}T00:00:00.000Z`) + offset*86_400_000).toISOString().slice(0,10);
      scheduledAt = availableSlots(before, { ...resources, day: candidateDay }).find(slot=>slot.available)?.scheduledAt;
    }
    if (!scheduledAt) throw new Error('No free future synthetic slot; refusing overwrite');
    const left: CrmCommand = { type: 'visit.create', ...resources, scheduledAt, testDataAcknowledged: true, idempotencyKey: randomUUID() };
    const right: CrmCommand = { ...left, idempotencyKey: randomUUID() };
    const commands = [left, right];
    const results = await Promise.allSettled(commands.map(command=>repository.command(actor,command)));
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    const winnerIndex = results.findIndex(result=>result.status==='fulfilled');
    const winner = (results[winnerIndex] as PromiseFulfilledResult<CrmCommandResult>).value;
    const loser = results.find(result=>result.status==='rejected') as PromiseRejectedResult;
    expect(loser.reason).toMatchObject({ code: 'CRM_SCHEDULE_CONFLICT', status: 409 });
    expect(await repository.command(actor,commands[winnerIndex])).toEqual({ ...winner, replayed: true });
    const committed = await repository.snapshot(actor);
    expect(committed.visits).toHaveLength(before.visits.length+1);
    expect(committed.tasks).toHaveLength(before.tasks.length+1);
    expect(committed.visits.find(visit=>visit.id===winner.resourceId)).toMatchObject({ ...resources, scheduledAt,
      durationMinutes: service.durationMinutes, bookingSource: 'booking', status: 'scheduled', version: 1 });
    expect(committed.tasks.filter(task=>task.visitId===winner.resourceId)).toHaveLength(1);
    await repository.close();
    const reopened = createCrmPostgresRepository(runtime);
    try {
      const fresh = await reopened.snapshot(actor);
      expect(fresh.visits.find(visit=>visit.id===winner.resourceId)).toMatchObject({ status: 'scheduled', durationMinutes: service.durationMinutes });
    } finally { await reopened.close(); }
    // Do not delete/reset this durable, labelled synthetic demonstration record.
  } finally { await repository.close(); await pool.end(); }
}, 30000);
