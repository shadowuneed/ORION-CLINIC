import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { LocalMaterialDescriptor } from '../local-materials/descriptor';
import { D1LocalMaterialRegistry } from './local-material-registry';
import { D1StaffSessionRepository } from './staff-sessions';

// Internal storage primitive only. These fixtures do not implement an action
// authorizer, key-wrapping facility, plaintext/key release, or browser storage.
type Clock = { now: number };
type Bound = { sql: string; bindings: SQLInputValue[] };
type Operation = { kind: 'first' | 'run' | 'all' | 'batch'; sql: string };
type Hooks = {
  before?: (operation: Operation) => void | Promise<void>;
  after?: (operation: Operation) => void | Promise<void>;
};
const issuer = 'orion:synthetic-material-registry-test';
const registryConfiguration = { policyId: 'synthetic-registry-policy-v1', wrappingProviderId: 'synthetic-test-wrapper' };
const opened = new Set<DatabaseSync>();
const temporary: { directory: string; path: string }[] = [];
const sessionHash = (suffix: 'a' | 'b') => createHash('sha256').update(`synthetic-registry-session-${suffix}`).digest('hex');

function close(database: DatabaseSync) { database.close(); opened.delete(database); }
afterEach(() => {
  for (const database of opened) database.close();
  opened.clear();
  for (const item of temporary.splice(0)) {
    const directory = resolve(item.directory);
    if (dirname(resolve(item.path)) !== directory || dirname(directory) !== resolve(tmpdir()) ||
      !basename(directory).startsWith('orion-material-registry-test-')) throw new Error('Unsafe registry fixture cleanup');
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      if (existsSync(item.path + suffix)) unlinkSync(item.path + suffix);
    }
    rmdirSync(directory);
  }
});

function adapter(database: DatabaseSync, hooks: Hooks = {}): D1Database {
  const execute = (bound: Bound): D1Result => {
    const before = Number(database.prepare('select total_changes() as n').get()?.n);
    const statement = database.prepare(bound.sql);
    const results = statement.columns().length ? statement.all(...bound.bindings) : (statement.run(...bound.bindings), []);
    // Actual D1 metadata includes trigger writes; do not use run().changes.
    return { success: true, results, meta: { changes: Number(database.prepare('select total_changes() as n').get()?.n) - before } } as D1Result;
  };
  const prepare = (sql: string, bindings: SQLInputValue[] = []): D1PreparedStatement => ({
    sql, bindings,
    bind(...values: unknown[]) { return prepare(sql, values as SQLInputValue[]); },
    async first<T>(column?: string) {
      const operation = { kind: 'first', sql } as const;
      await hooks.before?.(operation);
      const row = database.prepare(sql).get(...bindings);
      await hooks.after?.(operation);
      return (column ? row?.[column] : row) as T | undefined ?? null;
    },
    async run() {
      const operation = { kind: 'run', sql } as const;
      await hooks.before?.(operation);
      const result = execute({ sql, bindings });
      await hooks.after?.(operation);
      return result;
    },
    async all() {
      const operation = { kind: 'all', sql } as const;
      await hooks.before?.(operation);
      const result = execute({ sql, bindings });
      await hooks.after?.(operation);
      return result;
    },
  } as unknown as D1PreparedStatement);
  return {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      const bound = statements as unknown as Bound[];
      const operation = { kind: 'batch', sql: bound.map(item => item.sql).join('\n') } as const;
      await hooks.before?.(operation);
      database.exec('begin immediate');
      let result: D1Result[];
      try { result = bound.map(execute); database.exec('commit'); }
      catch (error) { database.exec('rollback'); throw error; }
      // Deliberate races happen outside the atomic transaction, never mid-batch.
      await hooks.after?.(operation);
      return result;
    },
  } as unknown as D1Database;
}

function connect(path: string, clock: Clock, hooks?: Hooks) {
  const database = new DatabaseSync(path);
  opened.add(database);
  database.exec('pragma foreign_keys=on');
  database.function('unixepoch', { varargs: true }, (...args: SQLInputValue[]) =>
    args[0] === 'subsec' ? clock.now / 1000 : Math.floor(clock.now / 1000));
  const d1 = adapter(database, hooks);
  return { database, d1, sessions: new D1StaffSessionRepository(d1), registry: new D1LocalMaterialRegistry(d1, registryConfiguration) };
}

function descriptor(suffix: 'a' | 'b' = 'a', revision = 1): LocalMaterialDescriptor {
  return {
    schema: 'orion-local-material/v1',
    owner: {
      audience: 'staff', userId: `registry-user-${suffix}`, issuer, subject: `synthetic-subject-${suffix}`,
      organizationId: 'registry-org', facilityId: 'registry-facility',
      accessAssignmentId: `registry-assignment-${suffix}`, patientId: `registry-patient-${suffix}`,
      encounterId: `registry-encounter-${suffix}`,
    },
    localMaterialId: `synthetic-material-${suffix}`, recordingRunId: `synthetic-run-${suffix}`, revision,
  };
}

async function fixture(options: { disk?: boolean; hooks?: Hooks; beforeAuthorityFences?: boolean } = {}) {
  let path = ':memory:';
  if (options.disk) {
    const directory = mkdtempSync(join(tmpdir(), 'orion-material-registry-test-'));
    path = join(directory, 'registry.sqlite');
    temporary.push({ directory, path });
  }
  const clock = { now: Date.UTC(2026, 8, 24, 14) };
  const connection = connect(path, clock, options.hooks);
  const { database, sessions } = connection;
  for (const name of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) {
    if (options.beforeAuthorityFences && name === '0051_local_material_authority_fences.sql') continue;
    database.exec(readFileSync(join('drizzle', name), 'utf8').replaceAll('--> statement-breakpoint', ''));
  }
  database.exec(`insert into organizations (id,name) values ('registry-org','Synthetic registry clinic');
    insert into facilities (id,organization_id,name) values ('registry-facility','registry-org','Synthetic registry facility');`);
  for (const suffix of ['a', 'b'] as const) {
    database.prepare("insert into users (id,external_issuer,external_subject,display_name,status) values (?,?,?,?,'active')")
      .run(`registry-user-${suffix}`, issuer, `synthetic-subject-${suffix}`, `Synthetic registry doctor ${suffix}`);
    database.prepare("insert into memberships (id,organization_id,facility_id,user_id,role) values (?,'registry-org','registry-facility',?,'clinician')")
      .run(`registry-member-${suffix}`, `registry-user-${suffix}`);
  }
  database.exec(`insert into departments (id,organization_id,facility_id,code,name,kind)
      values ('registry-department','registry-org','registry-facility','synthetic','Synthetic registry department','clinical');
    insert into department_versions (id,organization_id,facility_id,department_id,version,name,kind,status,change_reason,changed_by_membership_id,changed_at)
      values ('registry-department-v1','registry-org','registry-facility','registry-department',1,'Synthetic registry department','clinical','active','synthetic fixture','registry-member-a',${clock.now});
    insert into department_heads (id,organization_id,facility_id,department_id,current_version_id)
      values ('registry-department-head','registry-org','registry-facility','registry-department','registry-department-v1');`);
  for (const suffix of ['a', 'b'] as const) {
    database.prepare(`insert into department_access_assignments (id,organization_id,facility_id,department_id,membership_id,created_by_membership_id)
      values (?,'registry-org','registry-facility','registry-department',?,'registry-member-a')`)
      .run(`registry-assignment-${suffix}`, `registry-member-${suffix}`);
    database.prepare(`insert into department_access_assignment_versions
      (id,organization_id,facility_id,assignment_id,department_id,membership_id,version,status,source_type,roles_json,effective_from,change_reason,changed_by_membership_id,changed_at)
      values (?,'registry-org','registry-facility',?,'registry-department',?,1,'active','bootstrap','["doctor"]',?,'synthetic fixture','registry-member-a',?)`)
      .run(`registry-assignment-${suffix}-v1`, `registry-assignment-${suffix}`, `registry-member-${suffix}`, clock.now - 1000, clock.now);
    database.prepare(`insert into department_access_assignment_heads (id,organization_id,facility_id,assignment_id,department_id,membership_id,current_version_id)
      values (?,'registry-org','registry-facility',?,'registry-department',?,?)`)
      .run(`registry-assignment-head-${suffix}`, `registry-assignment-${suffix}`, `registry-member-${suffix}`, `registry-assignment-${suffix}-v1`);
    database.prepare(`insert into patients (id,organization_id,facility_id,medical_record_number,display_name)
      values (?,'registry-org','registry-facility',?,?)`)
      .run(`registry-patient-${suffix}`, `SYN-REGISTRY-${suffix}`, `Synthetic registry patient ${suffix}`);
    database.prepare(`insert into encounters (id,organization_id,facility_id,patient_id,clinician_membership_id,status,reason_for_visit)
      values (?,'registry-org','registry-facility',?,?,'in_progress','Synthetic storage fixture only')`)
      .run(`registry-encounter-${suffix}`, `registry-patient-${suffix}`, `registry-member-${suffix}`);
    expect(await sessions.create({
      sessionId: `registry-session-${suffix}`, tokenHash: sessionHash(suffix), userId: `registry-user-${suffix}`,
      expectedIssuer: issuer, expectedSubject: `synthetic-subject-${suffix}`, expectedUserVersion: 1,
    })).not.toBeNull();
  }
  return { ...connection, path, clock };
}

function reserveCommand(overrides: Record<string, unknown> = {}) {
  return {
    operationId: 'synthetic-operation-a', descriptor: descriptor(), payloadKind: 'audio',
    expectedReceiptId: null, authorityFingerprint: 'a'.repeat(64), sessionId: 'registry-session-a',
    keyId: 'synthetic-key-0001', ...overrides,
  };
}
type RegistryResult = Awaited<ReturnType<D1LocalMaterialRegistry['reserve']>>;
function successful(result: RegistryResult, status: 'stored' | 'replayed' = 'stored') {
  expect(result.status).toBe(status);
  if (result.status !== 'stored' && result.status !== 'replayed') throw new Error('Synthetic registry operation failed');
  return result.operation;
}
function preparedCommand(operation: { operationId: string; requestHash: string }, overrides: Record<string, unknown> = {}) {
  return {
    operationId: operation.operationId, requestHash: operation.requestHash,
    wrappingKeyRef: 'synthetic-wrapping-reference-v1', wrappedKey: 'synthetic-wrapped-reference-not-a-real-key',
    ...overrides,
  };
}
function finalCommand(operation: { operationId: string; requestHash: string }, overrides: Record<string, unknown> = {}) {
  return {
    operationId: operation.operationId, requestHash: operation.requestHash, receiptId: 'synthetic-receipt-a',
    envelopeHash: 'b'.repeat(64), envelopeBytes: 512, ...overrides,
  };
}
async function prepare(registry: D1LocalMaterialRegistry, overrides: Record<string, unknown> = {}) {
  const operation = successful(await registry.reserve(reserveCommand(overrides)));
  return successful(await registry.prepare(preparedCommand(operation)));
}
const registryTables = ['local_material_reservations', 'local_material_receipts', 'local_material_heads', 'local_material_registry_events'] as const;
function snapshot(database: DatabaseSync) {
  return Object.fromEntries(registryTables.map(table => [table, database.prepare(`select * from ${table} order by 1,2`).all()]));
}
function events(database: DatabaseSync, id = 'synthetic-operation-a') {
  return database.prepare('select event_type from local_material_registry_events where reservation_id=? order by event_type').all(id).map(row => row.event_type);
}
function selectOperation(operation: { operationId: string; requestHash: string }) {
  return { operationId: operation.operationId, requestHash: operation.requestHash };
}

// These database fences invalidate existing pending work. They intentionally do
// not turn this storage primitive into an authorizer or a key-release service.
const authoritySources = [
  { table: 'organizations', id: 'registry-org', denied: 'suspended' },
  { table: 'facilities', id: 'registry-facility', denied: 'suspended' },
  { table: 'memberships', id: 'registry-member-a', denied: 'disabled' },
] as const;

describe('pending material retirement on mutable authority changes', () => {
  it('installation retires pre-fence pending work whose past authority cannot be proven', async () => {
    const { registry, database } = await fixture({ beforeAuthorityFences: true });
    const committed = await prepare(registry);
    successful(await registry.finalize(finalCommand(committed)));
    const preparing = successful(await registry.reserve(reserveCommand({ operationId: 'synthetic-pre-fence-a', payloadKind: 'transcript', keyId: 'synthetic-pre-fence-key-a' })));
    const prepared = await prepare(registry, { operationId: 'synthetic-pre-fence-b', descriptor: descriptor('b'), sessionId: 'registry-session-b', keyId: 'synthetic-pre-fence-key-b' });
    const receipts = database.prepare('select * from local_material_receipts').all();
    const migration = readFileSync('drizzle/0051_local_material_authority_fences.sql', 'utf8').replaceAll('--> statement-breakpoint', '');
    database.exec(`begin immediate; ${migration} commit;`);
    for (const pending of [preparing, prepared]) {
      expect(successful(await registry.inspect(selectOperation(pending)), 'replayed'))
        .toMatchObject({ state: 'retired', retireReason: 'authority_changed' });
    }
    expect(database.prepare('select * from local_material_receipts').all()).toEqual(receipts);
    expect(successful(await registry.inspect(selectOperation(committed)), 'replayed')).toMatchObject({ state: 'committed', currentHead: true });
  });

  for (const source of authoritySources) {
    it.each(['preparing', 'prepared'] as const)(`${source.table}: same-version disable/reactivate cannot revive %s work`, async state => {
      const { registry, database } = await fixture();
      const operation = state === 'prepared' ? await prepare(registry) : successful(await registry.reserve(reserveCommand()));
      database.prepare(`update ${source.table} set status=? where id=?`).run(source.denied, source.id);
      database.prepare(`update ${source.table} set status='active' where id=?`).run(source.id);
      expect(database.prepare(`select version from ${source.table} where id=?`).get(source.id)?.version).toBe(1);
      expect(successful(await registry.inspect(selectOperation(operation)), 'replayed'))
        .toMatchObject({ state: 'retired', retireReason: 'authority_changed', currentHead: false });
      expect(await registry.reserve(reserveCommand())).toEqual({ status: 'conflict' });
      expect(await registry.prepare(preparedCommand(operation))).toEqual({ status: 'conflict' });
      expect(await registry.finalize(finalCommand(operation))).toEqual({ status: 'conflict' });
      expect(events(database)).toEqual(state === 'prepared' ? ['prepared', 'reserved', 'retired'] : ['reserved', 'retired']);
      expect(database.prepare('select * from local_material_heads').all()).toEqual([]);
      // A new operation is distinct; its future broker must authorize it afresh.
      expect(successful(await registry.reserve(reserveCommand({ operationId: 'synthetic-new-authority-operation', keyId: 'synthetic-key-new-authority' }))).state).toBe('preparing');
    });

    it.each([0, 1])(`${source.table}: identical-row REPLACE retires pending work with recursive_triggers=%i`, async recursive => {
      const { registry, database } = await fixture();
      const operation = await prepare(registry);
      database.exec(`pragma recursive_triggers=${recursive}`);
      database.prepare(`insert or replace into ${source.table} select * from ${source.table} where id=?`).run(source.id);
      expect(successful(await registry.inspect(selectOperation(operation)), 'replayed'))
        .toMatchObject({ state: 'retired', retireReason: 'authority_changed' });
      expect(events(database)).toEqual(['prepared', 'reserved', 'retired']);
      expect(database.prepare('pragma foreign_key_check').all()).toEqual([]);
    });

    it(`${source.table}: ignored duplicate insertion and no-op updates do not revoke pending work`, async () => {
      const { registry, database } = await fixture();
      await prepare(registry);
      const before = snapshot(database);
      database.prepare(`insert or ignore into ${source.table} select * from ${source.table} where id=?`).run(source.id);
      database.prepare(`update ${source.table} set status=status,version=version where id=?`).run(source.id);
      expect(snapshot(database)).toEqual(before);
    });

    it(`${source.table}: a foreign-key-blocked deletion leaves authority and pending work unchanged`, async () => {
      const { registry, database } = await fixture();
      await prepare(registry);
      const before = snapshot(database);
      expect(() => database.prepare(`delete from ${source.table} where id=?`).run(source.id)).toThrow();
      expect(database.prepare(`select id from ${source.table} where id=?`).get(source.id)?.id).toBe(source.id);
      expect(snapshot(database)).toEqual(before);
    });

    it(`${source.table}: epoch changes retire pending work without rewriting committed history`, async () => {
      const { registry, database } = await fixture();
      const committed = await prepare(registry);
      successful(await registry.finalize(finalCommand(committed)));
      const pending = successful(await registry.reserve(reserveCommand({ operationId: 'synthetic-pending-transcript', payloadKind: 'transcript', keyId: 'synthetic-text-key-0002' })));
      const receipt = database.prepare('select * from local_material_receipts').all();
      const head = database.prepare('select * from local_material_heads').all();
      database.prepare(`update ${source.table} set version=version+1 where id=?`).run(source.id);
      expect(successful(await registry.inspect(selectOperation(pending)), 'replayed').state).toBe('retired');
      // Registry status is INTERNAL metadata, not permission to release a key.
      expect(successful(await registry.inspect(selectOperation(committed)), 'replayed').state).toBe('committed');
      expect(database.prepare('select * from local_material_receipts').all()).toEqual(receipt);
      expect(database.prepare('select * from local_material_heads').all()).toEqual(head);
      expect(events(database)).toEqual(['committed', 'prepared', 'reserved']);
    });

    it.each(['ignore-retirement', 'ignore-event', 'abort-event'] as const)(`${source.table}: %s rolls back the authority mutation too`, async fault => {
      const { registry, database } = await fixture();
      await prepare(registry);
      const before = snapshot(database);
      if (fault === 'ignore-retirement') database.exec(`create trigger synthetic_ignore_retirement before update on local_material_reservations
        when NEW.state='retired' begin select raise(ignore); end;`);
      else database.exec(`create trigger synthetic_fail_retirement_event before insert on local_material_registry_events
        when NEW.event_type='retired' begin select raise(${fault === 'ignore-event' ? 'ignore' : "abort, 'synthetic audit failure'"}); end;`);
      expect(() => database.prepare(`update ${source.table} set status=? where id=?`).run(source.denied, source.id)).toThrow();
      expect(database.prepare(`select status from ${source.table} where id=?`).get(source.id)?.status).toBe('active');
      expect(snapshot(database)).toEqual(before);
    });
  }

  it('membership retirement is scoped and a role change is a material authority change', async () => {
    const { registry, database } = await fixture();
    const left = await prepare(registry);
    const right = await prepare(registry, { operationId: 'synthetic-operation-b', descriptor: descriptor('b'), sessionId: 'registry-session-b', keyId: 'synthetic-key-0002' });
    database.exec("update memberships set role='nurse' where id='registry-member-a'");
    expect(successful(await registry.inspect(selectOperation(left)), 'replayed').state).toBe('retired');
    expect(successful(await registry.inspect(selectOperation(right)), 'replayed').state).toBe('prepared');
  });

  it('unrelated authority mutations and cosmetic edits leave the selected operation untouched', async () => {
    const { registry, database } = await fixture();
    await prepare(registry);
    const before = snapshot(database);
    database.exec(`insert into organizations (id,name) values ('unrelated-org','Unrelated synthetic clinic');
      insert into facilities (id,organization_id,name) values ('unrelated-facility','unrelated-org','Unrelated synthetic facility');
      insert into memberships (id,organization_id,facility_id,user_id,role) values ('unrelated-member','unrelated-org','unrelated-facility','registry-user-b','nurse');
      update organizations set status='suspended' where id='unrelated-org';
      update facilities set status='suspended' where id='unrelated-facility';
      update memberships set status='disabled' where id='unrelated-member';
      update organizations set name='Changed synthetic name' where id='registry-org';
      update facilities set name='Changed synthetic name',timezone='UTC' where id='registry-facility';
      update memberships set updated_at=updated_at+1 where id='registry-member-a';`);
    expect(snapshot(database)).toEqual(before);
  });

  it.each([0, 1])('facility unique-name replacement fences displaced selectors even with recursive_triggers=%i', async recursive => {
    const { registry, database } = await fixture();
    database.exec("insert into facilities (id,organization_id,name) values ('pending-only-facility','registry-org','Synthetic replace target');");
    // Deliberately metadata-only selector: storage does not prove a clinical grant.
    const target = { ...descriptor(), owner: { ...descriptor().owner, facilityId: 'pending-only-facility' } };
    const operation = await prepare(registry, { descriptor: target });
    database.exec(`pragma recursive_triggers=${recursive};
      insert or replace into facilities (id,organization_id,name) values ('replacement-facility','registry-org','Synthetic replace target');`);
    expect(database.prepare("select id from facilities where id='pending-only-facility'").get()).toBeUndefined();
    expect(successful(await registry.inspect(selectOperation(operation)), 'replayed').state).toBe('retired');
  });

  it.each([0, 1])('membership unique-scope replacement fences displaced selectors even with recursive_triggers=%i', async recursive => {
    const { registry, database } = await fixture();
    database.exec(`insert into facilities (id,organization_id,name) values ('pending-only-facility','registry-org','Synthetic pending facility');
      insert into memberships (id,organization_id,facility_id,user_id,role) values ('pending-only-member','registry-org','pending-only-facility','registry-user-a','clinician');`);
    const target = { ...descriptor(), owner: { ...descriptor().owner, facilityId: 'pending-only-facility', accessAssignmentId: 'unbound-metadata-selector' } };
    const operation = await prepare(registry, { descriptor: target });
    database.exec(`pragma recursive_triggers=${recursive};
      insert or replace into memberships (id,organization_id,facility_id,user_id,role) values ('replacement-member','registry-org','pending-only-facility','registry-user-a','clinician');`);
    expect(database.prepare("select id from memberships where id='pending-only-member'").get()).toBeUndefined();
    expect(successful(await registry.inspect(selectOperation(operation)), 'replayed').state).toBe('retired');
  });

  it('an ignored unique-tuple update does not invalidate the still-present original authority', async () => {
    const { registry, database } = await fixture();
    await prepare(registry);
    const before = snapshot(database);
    database.exec("update or ignore memberships set user_id='registry-user-b' where id='registry-member-a'");
    expect(database.prepare("select user_id from memberships where id='registry-member-a'").get()?.user_id).toBe('registry-user-a');
    expect(snapshot(database)).toEqual(before);
  });

  it('an explicit rollback undoes retirement and its audit together', async () => {
    const { registry, database } = await fixture();
    await prepare(registry);
    const before = snapshot(database);
    database.exec("begin immediate; update organizations set status='suspended' where id='registry-org'; rollback;");
    expect(snapshot(database)).toEqual(before);
    expect(database.prepare("select status from organizations where id='registry-org'").get()?.status).toBe('active');
  });

  it('retirement is durable across connection/reopen and a delayed finalize cannot publish', async () => {
    const first = await fixture({ disk: true });
    const operation = await prepare(first.registry);
    const second = connect(first.path, first.clock);
    second.database.exec("update facilities set status='suspended' where id='registry-facility'; update facilities set status='active' where id='registry-facility';");
    close(first.database); close(second.database);
    const reopened = connect(first.path, first.clock);
    expect(successful(await reopened.registry.inspect(selectOperation(operation)), 'replayed').state).toBe('retired');
    expect(await reopened.registry.finalize(finalCommand(operation))).toEqual({ status: 'conflict' });
    expect(events(reopened.database)).toEqual(['prepared', 'reserved', 'retired']);
    expect(reopened.database.prepare('pragma foreign_key_check').all()).toEqual([]);
  });

  it('a revoke/regrant immediately before the final SQL batch defeats a stale in-memory result', async () => {
    const first = await fixture({ disk: true });
    const operation = await prepare(first.registry);
    const second = connect(first.path, first.clock);
    let changed = false;
    const delayed = new D1LocalMaterialRegistry(adapter(first.database, { before: action => {
      if (action.kind === 'batch' && !changed) {
        changed = true;
        second.database.exec("update memberships set status='disabled' where id='registry-member-a'; update memberships set status='active' where id='registry-member-a';");
      }
    } }), registryConfiguration);
    expect(await delayed.finalize(finalCommand(operation))).toEqual({ status: 'conflict' });
    expect(first.database.prepare('select * from local_material_receipts').all()).toEqual([]);
  });
});

describe('internal non-authorizing local-material registry with full migrations and real SQL', () => {
  it('durably reserves pending metadata and a minimal event, without a head or key release', async () => {
    const { registry, database, clock } = await fixture();
    const operation = successful(await registry.reserve(reserveCommand()));
    expect(operation).toMatchObject({
      operationId: 'synthetic-operation-a', state: 'preparing', keyId: 'synthetic-key-0001',
      createdAt: clock.now, expiresAt: clock.now + 120_000, receiptId: null,
      envelopeHash: null, envelopeBytes: null, retireReason: null, currentHead: false,
    });
    expect(operation.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(events(database)).toEqual(['reserved']);
    expect(database.prepare('select * from local_material_heads').all()).toEqual([]);
    expect(database.prepare('select * from local_material_receipts').all()).toEqual([]);
    expect(database.prepare('select state,wrapped_key,wrapping_key_ref from local_material_reservations').get())
      .toEqual({ state: 'preparing', wrapped_key: null, wrapping_key_ref: null });
    expect(database.prepare('pragma foreign_key_check').all()).toEqual([]);
  });

  it('binds one wrapped reference and replays it exactly, without making it current', async () => {
    const { registry, database } = await fixture();
    const reserved = successful(await registry.reserve(reserveCommand()));
    const prepared = successful(await registry.prepare(preparedCommand(reserved)));
    expect(prepared).toMatchObject({ state: 'prepared', receiptId: null, currentHead: false });
    const before = snapshot(database);
    expect(successful(await registry.prepare(preparedCommand(reserved)), 'replayed')).toEqual(prepared);
    expect(await registry.prepare(preparedCommand(reserved, { wrappedKey: 'synthetic-different-wrap' }))).toEqual({ status: 'conflict' });
    expect(await registry.prepare(preparedCommand(reserved, { wrappingKeyRef: 'synthetic-other-wrapper-version' }))).toEqual({ status: 'conflict' });
    expect(snapshot(database)).toEqual(before);
    expect(events(database)).toEqual(['prepared', 'reserved']);
    expect(JSON.stringify(prepared)).not.toContain('synthetic-wrapped-reference');
    expect(prepared).not.toHaveProperty('wrappingKeyRef');
    expect(prepared).not.toHaveProperty('wrappedKey');
  });

  it('commits one head/receipt/event atomically and replays only identical finalize commands', async () => {
    const { registry, database } = await fixture();
    const operation = await prepare(registry);
    const committed = successful(await registry.finalize(finalCommand(operation)));
    expect(committed).toMatchObject({ state: 'committed', currentHead: true, receiptId: 'synthetic-receipt-a', envelopeHash: 'b'.repeat(64), envelopeBytes: 512 });
    const before = snapshot(database);
    expect(successful(await registry.finalize(finalCommand(operation)), 'replayed')).toEqual(committed);
    for (const change of [{ receiptId: 'different-receipt' }, { envelopeHash: 'c'.repeat(64) }, { envelopeBytes: 513 }]) {
      expect(await registry.finalize(finalCommand(operation, change))).toEqual({ status: 'conflict' });
    }
    expect(snapshot(database)).toEqual(before);
    expect(events(database)).toEqual(['committed', 'prepared', 'reserved']);
    expect(database.prepare('select * from local_material_heads').get()).toEqual({
      material_id: 'synthetic-material-a', payload_kind: 'audio', receipt_id: 'synthetic-receipt-a', revision: 1,
    });
  });

  it('advances only the expected head and retains historical receipt replay without current-head status', async () => {
    const { registry, database, clock } = await fixture();
    const first = await prepare(registry);
    successful(await registry.finalize(finalCommand(first)));
    const next = await prepare(registry, { operationId: 'synthetic-operation-next', descriptor: descriptor('a', 2), expectedReceiptId: 'synthetic-receipt-a', keyId: 'synthetic-key-0002' });
    successful(await registry.finalize(finalCommand(next, { receiptId: 'synthetic-receipt-next', envelopeHash: 'c'.repeat(64) })));
    clock.now += 120_000;
    expect(successful(await registry.inspect(selectOperation(first)), 'replayed')).toMatchObject({ state: 'committed', currentHead: false });
    expect(successful(await registry.finalize(finalCommand(first)), 'replayed')).toMatchObject({ currentHead: false });
    expect(successful(await registry.inspect(selectOperation(next)), 'replayed')).toMatchObject({ state: 'committed', currentHead: true });
    expect(database.prepare('select revision,receipt_id from local_material_heads').get()).toEqual({ revision: 2, receipt_id: 'synthetic-receipt-next' });
    expect(database.prepare('select count(*) as n from local_material_receipts').get()?.n).toBe(2);
  });

  it('keeps audio and transcript heads independent, with distinct immutable key identities', async () => {
    const { registry, database } = await fixture();
    const audio = await prepare(registry);
    const transcript = await prepare(registry, { operationId: 'synthetic-transcript-operation', payloadKind: 'transcript', keyId: 'synthetic-key-text-0001' });
    successful(await registry.finalize(finalCommand(audio)));
    successful(await registry.finalize(finalCommand(transcript, { receiptId: 'synthetic-transcript-receipt' })));
    expect(database.prepare('select payload_kind,revision from local_material_heads order by payload_kind').all())
      .toEqual([{ payload_kind: 'audio', revision: 1 }, { payload_kind: 'transcript', revision: 1 }]);
    expect(successful(await registry.inspect(selectOperation(audio)), 'replayed').currentHead).toBe(true);
    expect(successful(await registry.inspect(selectOperation(transcript)), 'replayed').currentHead).toBe(true);
  });

  it('does not relabel an existing material owner/run across operations or payload kinds', async () => {
    const { registry, database } = await fixture();
    successful(await registry.reserve(reserveCommand()));
    const before = snapshot(database);
    const other = descriptor('b');
    for (const changed of [
      { ...other, localMaterialId: 'synthetic-material-a' },
      { ...descriptor(), recordingRunId: 'synthetic-new-run' },
      { ...descriptor(), owner: { ...descriptor().owner, accessAssignmentId: 'registry-assignment-b' } },
    ]) {
      expect(await registry.reserve(reserveCommand({ operationId: 'synthetic-owner-conflict', descriptor: changed,
        payloadKind: 'transcript', keyId: 'synthetic-key-other-0001', sessionId: changed.owner.userId === other.owner.userId ? 'registry-session-b' : 'registry-session-a' }))).toEqual({ status: 'conflict' });
    }
    expect(snapshot(database)).toEqual(before);
  });

  it('replays an identical reservation without renewing TTL or allocating another key/event', async () => {
    const { registry, database, clock } = await fixture();
    const first = successful(await registry.reserve(reserveCommand()));
    const before = snapshot(database);
    clock.now += 10;
    expect(successful(await registry.reserve(reserveCommand()), 'replayed')).toEqual(first);
    for (const changed of [
      { payloadKind: 'transcript' }, { keyId: 'synthetic-another-key-0001' }, { authorityFingerprint: 'b'.repeat(64) },
      { sessionId: 'registry-session-b' }, { descriptor: descriptor('a', 2), expectedReceiptId: 'synthetic-missing-receipt' },
    ]) expect(await registry.reserve(reserveCommand(changed))).toEqual({ status: 'conflict' });
    expect(snapshot(database)).toEqual(before);
  });

  it('rejects duplicate key ids and first-revision/head mismatches without partial reservations', async () => {
    const { registry, database } = await fixture();
    successful(await registry.reserve(reserveCommand()));
    const before = snapshot(database);
    for (const changed of [
      { operationId: 'synthetic-key-collision' },
      { operationId: 'synthetic-missing-head', keyId: 'synthetic-key-0002', descriptor: descriptor('a', 2), expectedReceiptId: 'synthetic-missing-receipt' },
    ]) expect(await registry.reserve(reserveCommand(changed))).toEqual({ status: 'conflict' });
    expect(snapshot(database)).toEqual(before);
  });

  it('allows competing pending revisions but serializes final CAS with only one current head', async () => {
    const first = await fixture({ disk: true });
    const second = connect(first.path, first.clock);
    const left = await prepare(first.registry);
    const right = await prepare(second.registry, { operationId: 'synthetic-competing-operation', keyId: 'synthetic-key-0002' });
    const results = await Promise.all([
      first.registry.finalize(finalCommand(left)),
      second.registry.finalize(finalCommand(right, { receiptId: 'synthetic-competing-receipt' })),
    ]);
    expect(results.map(item => item.status).sort()).toEqual(['conflict', 'stored']);
    const states = [successful(await first.registry.inspect(selectOperation(left)), 'replayed'), successful(await second.registry.inspect(selectOperation(right)), 'replayed')];
    expect(states.filter(item => item.currentHead)).toHaveLength(1);
    expect(states.map(item => item.state).sort()).toEqual(['committed', 'prepared']);
    expect(first.database.prepare('select count(*) as n from local_material_receipts').get()?.n).toBe(1);
    expect(first.database.prepare("select count(*) as n from local_material_registry_events where event_type='committed'").get()?.n).toBe(1);
  });

  it('preserves pending/prepared/committed state through close/reopen and another connection', async () => {
    const first = await fixture({ disk: true });
    const committed = await prepare(first.registry);
    successful(await first.registry.finalize(finalCommand(committed)));
    const pending = successful(await first.registry.reserve(reserveCommand({ operationId: 'synthetic-pending-text', payloadKind: 'transcript', keyId: 'synthetic-key-text-0001' })));
    close(first.database);
    const reopened = connect(first.path, first.clock);
    const second = connect(first.path, first.clock);
    expect(successful(await reopened.registry.inspect(selectOperation(committed)), 'replayed')).toMatchObject({ state: 'committed', currentHead: true });
    expect(successful(await second.registry.inspect(selectOperation(pending)), 'replayed')).toMatchObject({ state: 'preparing', currentHead: false });
    successful(await second.registry.prepare(preparedCommand(pending)));
    expect(successful(await reopened.registry.inspect(selectOperation(pending)), 'replayed')).toMatchObject({ state: 'prepared', currentHead: false });
    expect(reopened.database.prepare('pragma foreign_key_check').all()).toEqual([]);
    expect(reopened.database.prepare('pragma quick_check').get()?.quick_check).toBe('ok');
  });

  it.each([119_999, 120_000, 120_001])('uses the database deadline, including exact expiry at %i ms', async elapsed => {
    const { registry, clock, database } = await fixture();
    const operation = successful(await registry.reserve(reserveCommand()));
    clock.now += elapsed;
    const result = await registry.prepare(preparedCommand(operation));
    expect(result.status).toBe(elapsed < 120_000 ? 'stored' : 'conflict');
    expect((await registry.reserve(reserveCommand())).status).toBe(elapsed < 120_000 ? 'replayed' : 'conflict');
    expect(successful(await registry.inspect(selectOperation(operation)), 'replayed').state).toBe(elapsed < 120_000 ? 'prepared' : 'preparing');
    expect(database.prepare('select * from local_material_heads').all()).toEqual([]);
  });

  it('does not finalize an expired prepared reservation or extend its database deadline', async () => {
    const { registry, clock, database } = await fixture();
    const operation = await prepare(registry);
    clock.now += 120_000;
    const before = snapshot(database);
    expect(await registry.finalize(finalCommand(operation))).toEqual({ status: 'conflict' });
    expect(snapshot(database)).toEqual(before);
  });

  it.each(['expired', 'cancelled', 'authority_changed', 'preparation_failed'] as const)('retires a pending operation once with reason %s and cannot resurrect it', async reason => {
    const { registry, clock, database } = await fixture();
    const operation = await prepare(registry);
    if (reason === 'expired') clock.now += 120_000;
    const command = { ...selectOperation(operation), reason };
    expect(successful(await registry.retire(command))).toMatchObject({ state: 'retired', retireReason: reason, currentHead: false });
    const before = snapshot(database);
    expect(successful(await registry.retire(command), 'replayed')).toMatchObject({ state: 'retired', retireReason: reason });
    expect(await registry.prepare(preparedCommand(operation))).toEqual({ status: 'conflict' });
    expect(await registry.finalize(finalCommand(operation))).toEqual({ status: 'conflict' });
    expect(snapshot(database)).toEqual(before);
    expect(events(database)).toEqual(['prepared', 'reserved', 'retired']);
  });

  it('does not retire a committed receipt or change a terminal retirement reason', async () => {
    const { registry } = await fixture();
    const committed = await prepare(registry);
    successful(await registry.finalize(finalCommand(committed)));
    expect(await registry.retire({ ...selectOperation(committed), reason: 'cancelled' })).toEqual({ status: 'conflict' });
    const pending = successful(await registry.reserve(reserveCommand({ operationId: 'synthetic-retired-text', payloadKind: 'transcript', keyId: 'synthetic-key-text-0001' })));
    successful(await registry.retire({ ...selectOperation(pending), reason: 'cancelled' }));
    expect(await registry.retire({ ...selectOperation(pending), reason: 'authority_changed' })).toEqual({ status: 'conflict' });
  });

  it('pins configured policy/provider on every lookup instead of following a changed default', async () => {
    const { registry, d1, database } = await fixture();
    const operation = successful(await registry.reserve(reserveCommand()));
    const before = snapshot(database);
    for (const changed of [{ policyId: 'synthetic-other-policy' }, { wrappingProviderId: 'synthetic-other-wrapper' }]) {
      const other = new D1LocalMaterialRegistry(d1, { ...registryConfiguration, ...changed });
      expect(await other.inspect(selectOperation(operation))).toEqual({ status: 'conflict' });
      expect(await other.prepare(preparedCommand(operation))).toEqual({ status: 'conflict' });
      expect(await other.finalize(finalCommand(operation))).toEqual({ status: 'conflict' });
      expect(await other.retire({ ...selectOperation(operation), reason: 'cancelled' })).toEqual({ status: 'conflict' });
    }
    expect(snapshot(database)).toEqual(before);
  });

  it('snapshots mutable caller/configuration fields before the first asynchronous hash boundary', async () => {
    const { d1, database } = await fixture();
    const config = { ...registryConfiguration };
    const registry = new D1LocalMaterialRegistry(d1, config);
    const source = { ...reserveCommand(), descriptor: { ...descriptor(), owner: { ...descriptor().owner } } };
    const pending = registry.reserve(source);
    source.operationId = 'synthetic-mutated-operation';
    source.keyId = 'synthetic-mutated-key';
    source.descriptor.localMaterialId = 'synthetic-mutated-material';
    source.descriptor.owner.userId = 'registry-user-b';
    config.policyId = 'synthetic-mutated-policy';
    config.wrappingProviderId = 'synthetic-mutated-provider';
    const operation = successful(await pending);
    expect(operation.operationId).toBe('synthetic-operation-a');
    expect(operation.keyId).toBe('synthetic-key-0001');
    const row = database.prepare('select descriptor_json,policy_id,wrapping_provider_id from local_material_reservations').get()!;
    expect(JSON.parse(String(row.descriptor_json))).toEqual(descriptor());
    expect(row.policy_id).toBe(registryConfiguration.policyId);
    expect(row.wrapping_provider_id).toBe(registryConfiguration.wrappingProviderId);
  });

  it('rejects malformed exact commands and config before SQL, with no default custody/policy', async () => {
    const { d1, database } = await fixture();
    for (const config of [undefined, null, {}, { policyId: 'synthetic' }, { ...registryConfiguration, wrappingProviderId: '' }, { ...registryConfiguration, extra: true }]) {
      expect(() => new D1LocalMaterialRegistry(d1, config)).toThrow('Local material registry configuration required.');
    }
    const calls: string[] = [];
    const registry = new D1LocalMaterialRegistry(adapter(database, { before: operation => { calls.push(operation.sql); } }), registryConfiguration);
    for (const malformed of [
      null, {}, [], reserveCommand({ extra: 'forbidden' }), reserveCommand({ operationId: 'x'.repeat(129) }),
      reserveCommand({ keyId: 'synthetic-key-0001\n' }), reserveCommand({ keyId: 'short' }),
      reserveCommand({ authorityFingerprint: 'A'.repeat(64) }), reserveCommand({ sessionId: 'bad\u0000session' }),
      reserveCommand({ descriptor: descriptor('a', 2) }), reserveCommand({ expectedReceiptId: 'synthetic-receipt' }),
      reserveCommand({ payloadKind: 'unknown' }),
    ]) expect(await registry.reserve(malformed)).toEqual({ status: 'invalid' });
    const reference = { operationId: 'synthetic-operation-a', requestHash: 'a'.repeat(64) };
    for (const malformed of [
      preparedCommand(reference, { wrappedKey: '' }), preparedCommand(reference, { wrappedKey: 'x'.repeat(16_385) }),
      preparedCommand(reference, { wrappingKeyRef: '' }), preparedCommand(reference, { wrappedKey: 'bad\nwrapped' }),
    ]) expect(await registry.prepare(malformed)).toEqual({ status: 'invalid' });
    for (const malformed of [
      finalCommand(reference, { receiptId: 'x'.repeat(129) }), finalCommand(reference, { envelopeHash: 'A'.repeat(64) }),
      finalCommand(reference, { envelopeBytes: 0 }), finalCommand(reference, { envelopeBytes: 2_097_153 }),
      finalCommand(reference, { envelopeBytes: 1.5 }), finalCommand(reference, { payload: 'forbidden' }),
    ]) expect(await registry.finalize(malformed)).toEqual({ status: 'invalid' });
    expect(await registry.inspect({ ...reference, key: 'forbidden' })).toEqual({ status: 'invalid' });
    expect(await registry.retire({ ...reference, reason: 'erased' })).toEqual({ status: 'invalid' });
    expect(calls).toEqual([]);
    expect(database.prepare('select * from local_material_reservations').all()).toEqual([]);
  });

  it('does not invoke accessors or leak thrown Proxy details through command/config validation', async () => {
    const { registry, d1, database } = await fixture();
    let getterCalls = 0;
    const getter = { ...reserveCommand() };
    Object.defineProperty(getter, 'operationId', { enumerable: true, get() { getterCalls++; throw new Error('synthetic-sensitive-detail'); } });
    const proxy = new Proxy(reserveCommand(), { getOwnPropertyDescriptor() { throw new Error('synthetic-sensitive-detail'); } });
    expect(await registry.reserve(getter)).toEqual({ status: 'invalid' });
    expect(await registry.reserve(proxy)).toEqual({ status: 'invalid' });
    expect(getterCalls).toBe(0);
    expect(() => new D1LocalMaterialRegistry(d1, new Proxy(registryConfiguration, { ownKeys() { throw new Error('synthetic-sensitive-detail'); } })))
      .toThrow('Local material registry configuration required.');
    expect(database.prepare('select * from local_material_reservations').all()).toEqual([]);
  });

  it('treats request-hash knowledge as only an internal lookup and never exposes wrapped bytes', async () => {
    const { registry, database } = await fixture();
    const operation = await prepare(registry);
    const before = snapshot(database);
    const wrong = { operationId: operation.operationId, requestHash: 'f'.repeat(64) };
    expect(await registry.inspect(wrong)).toEqual({ status: 'conflict' });
    expect(await registry.prepare(preparedCommand(wrong))).toEqual({ status: 'conflict' });
    expect(await registry.finalize(finalCommand(wrong))).toEqual({ status: 'conflict' });
    expect(await registry.retire({ ...wrong, reason: 'cancelled' })).toEqual({ status: 'conflict' });
    const inspected = successful(await registry.inspect(selectOperation(operation)), 'replayed');
    expect(Object.isFrozen(inspected)).toBe(true);
    for (const forbidden of ['wrappedKey', 'wrappingKeyRef', 'descriptor', 'sessionId', 'authorityFingerprint', 'plaintext', 'keyBytes']) {
      expect(inspected).not.toHaveProperty(forbidden);
    }
    expect(snapshot(database)).toEqual(before);
  });

  it('demonstrates the deliberate non-authorizing boundary: session ownership is a relation, not current login permission', async () => {
    const { registry, sessions } = await fixture();
    await sessions.revoke(sessionHash('a'));
    expect(await sessions.resolve(sessionHash('a'))).toBeNull();
    // A future broker MUST deny before calling this primitive. Its relation-only
    // storage operation intentionally does not impersonate an authorization gate.
    const operation = successful(await registry.reserve(reserveCommand()));
    expect(operation.state).toBe('preparing');
  });

  it.each(['prepare', 'bind', 'batch'] as const)('sanitizes %s database failures for all mutating operations', async stage => {
    const { database } = await fixture();
    const real = adapter(database);
    const unavailable = () => { throw new Error('synthetic-sensitive-database-detail'); };
    const broken = {
      ...real,
      prepare(sql: string) {
        if (stage === 'prepare') return unavailable();
        const statement = real.prepare(sql);
        return stage === 'bind' ? { ...statement, bind: unavailable } : statement;
      },
      batch: stage === 'batch' ? unavailable : real.batch.bind(real),
    } as D1Database;
    const registry = new D1LocalMaterialRegistry(broken, registryConfiguration);
    const reference = { operationId: 'synthetic-operation-a', requestHash: 'a'.repeat(64) };
    for (const invoke of [
      () => registry.reserve(reserveCommand()), () => registry.prepare(preparedCommand(reference)),
      () => registry.finalize(finalCommand(reference)), () => registry.retire({ ...reference, reason: 'cancelled' }),
    ]) await expect(invoke()).rejects.toThrow(/^Local material registry unavailable\.$/);
    expect(database.prepare('select * from local_material_reservations').all()).toEqual([]);
  });

  it.each(['reserved', 'prepared', 'retired'] as const)('rolls back a silently ignored %s transition event', async eventType => {
    const { registry, database } = await fixture();
    const operation = eventType === 'reserved' ? null : successful(await registry.reserve(reserveCommand()));
    const before = snapshot(database);
    database.exec(`create trigger synthetic_ignore_event before insert on local_material_registry_events
      when new.event_type='${eventType}' begin select raise(ignore); end;`);
    const result = eventType === 'reserved' ? registry.reserve(reserveCommand())
      : eventType === 'prepared' ? registry.prepare(preparedCommand(operation!))
        : registry.retire({ ...selectOperation(operation!), reason: 'cancelled' });
    await expect(result).rejects.toThrow(/^Local material registry unavailable\.$/);
    expect(snapshot(database)).toEqual(before);
  });

  it.each(['initial-head', 'advance-head', 'commit-state', 'commit-event'] as const)('rolls back the entire receipt/CAS when %s publication is silently ignored', async stage => {
    const { registry, database } = await fixture();
    let operation = await prepare(registry);
    if (stage === 'advance-head') {
      successful(await registry.finalize(finalCommand(operation)));
      operation = await prepare(registry, { operationId: 'synthetic-next-operation', keyId: 'synthetic-key-0002', descriptor: descriptor('a', 2), expectedReceiptId: 'synthetic-receipt-a' });
    }
    const before = snapshot(database);
    const target = stage === 'initial-head' ? 'before insert on local_material_heads'
      : stage === 'advance-head' ? 'before update on local_material_heads'
        : stage === 'commit-state' ? "before update on local_material_reservations when new.state='committed'"
          : "before insert on local_material_registry_events when new.event_type='committed'";
    database.exec(`create trigger synthetic_ignore_publication ${target} begin select raise(ignore); end;`);
    await expect(registry.finalize(finalCommand(operation, { receiptId: 'synthetic-new-receipt' })))
      .rejects.toThrow(/^Local material registry unavailable\.$/);
    expect(snapshot(database)).toEqual(before);
  });

  it('rolls back a failed audit insertion and preserves a prior head rather than claiming success', async () => {
    const { registry, database } = await fixture();
    const operation = await prepare(registry);
    const before = snapshot(database);
    database.exec(`create trigger synthetic_audit_failure before insert on local_material_registry_events
      when new.event_type='committed' begin select raise(abort,'synthetic-sensitive-audit-detail'); end;`);
    await expect(registry.finalize(finalCommand(operation))).rejects.toThrow(/^Local material registry unavailable\.$/);
    expect(snapshot(database)).toEqual(before);
  });

  it.each([0, 1])('prevents SQL REPLACE/delete/history edits with recursive_triggers=%i', async recursive => {
    const { registry, database } = await fixture();
    database.exec(`pragma recursive_triggers=${recursive}`);
    const operation = await prepare(registry);
    successful(await registry.finalize(finalCommand(operation)));
    const before = snapshot(database);
    for (const table of registryTables) {
      const row = database.prepare(`select * from ${table} limit 1`).get()!;
      const columns = Object.keys(row);
      const sql = `insert or replace into ${table} (${columns.map(name => `"${name}"`).join(',')}) values (${columns.map(() => '?').join(',')})`;
      expect(() => database.prepare(sql).run(...Object.values(row) as SQLInputValue[])).toThrow();
      expect(() => database.exec(`delete from ${table}`)).toThrow();
    }
    expect(() => database.exec("update local_material_reservations set state='prepared'")).toThrow();
    expect(() => database.exec("update local_material_receipts set envelope_hash='" + 'c'.repeat(64) + "'")).toThrow();
    expect(() => database.exec('update local_material_heads set revision=revision+1')).toThrow();
    expect(() => database.exec('update local_material_registry_events set occurred_at=occurred_at+1')).toThrow();
    expect(snapshot(database)).toEqual(before);
    expect(database.prepare('pragma foreign_key_check').all()).toEqual([]);
  });

  it('keeps every reservation binding immutable, including wrapped reference after preparation', async () => {
    const { registry, database, clock } = await fixture();
    const operation = successful(await registry.reserve(reserveCommand()));
    const before = snapshot(database);
    const edits: Record<string, SQLInputValue> = {
      id: 'synthetic-other-operation', request_hash: 'c'.repeat(64), descriptor_json: JSON.stringify(descriptor('b')),
      payload_kind: 'transcript', material_id: 'synthetic-other-material', recording_run_id: 'synthetic-other-run',
      owner_user_id: 'registry-user-b', revision: 2, expected_receipt_id: 'synthetic-other-receipt',
      authority_fingerprint: 'd'.repeat(64), session_id: 'registry-session-b', key_id: 'synthetic-other-key-0002',
      policy_id: 'synthetic-other-policy', wrapping_provider_id: 'synthetic-other-provider',
      created_at: clock.now + 1, expires_at: clock.now + 120_001,
    };
    for (const [column, value] of Object.entries(edits)) {
      expect(() => database.prepare(`update local_material_reservations set ${column}=? where id=?`).run(value, operation.operationId)).toThrow();
    }
    expect(() => database.exec("update local_material_reservations set state='committed'")).toThrow();
    expect(snapshot(database)).toEqual(before);
    successful(await registry.prepare(preparedCommand(operation)));
    const prepared = snapshot(database);
    expect(() => database.exec("update local_material_reservations set wrapping_key_ref='synthetic-other-key-version'")).toThrow();
    expect(() => database.exec("update local_material_reservations set wrapped_key='synthetic-other-wrapped-key'")).toThrow();
    expect(snapshot(database)).toEqual(prepared);
  });
});
