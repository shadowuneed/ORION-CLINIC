import { existsSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

const fixtures: Array<{ database: DatabaseSync; directory: string; file: string }> = [];

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'orion-patient-link-test-'));
  const file = join(directory, 'patient-links.sqlite');
  const database = new DatabaseSync(file);
  fixtures.push({ database, directory, file });
  database.exec('pragma foreign_keys = on');
  for (const name of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) {
    database.exec(readFileSync(join('drizzle', name), 'utf8').replaceAll('--> statement-breakpoint', ''));
  }
  database.exec(`
    insert into organizations (id, name) values ('org-mobile', 'Synthetic mobile clinic');
    insert into facilities (id, organization_id, name) values ('fac-mobile', 'org-mobile', 'Synthetic facility');
    insert into users (id, external_issuer, external_subject, display_name, status)
      values ('verifier', 'test-staff', 'verifier', 'Synthetic verifier', 'active');
    insert into memberships (id, organization_id, facility_id, user_id, role, status)
      values ('membership-mobile', 'org-mobile', 'fac-mobile', 'verifier', 'clinician', 'active');
    insert into patients (id, organization_id, facility_id, medical_record_number, display_name)
      values ('patient-a', 'org-mobile', 'fac-mobile', 'SYN-MOBILE-A', 'Synthetic A');
    insert into patients (id, organization_id, facility_id, medical_record_number, display_name)
      values ('patient-b', 'org-mobile', 'fac-mobile', 'SYN-MOBILE-B', 'Synthetic B');
  `);
  return { database, file };
}

function link(database: DatabaseSync, id = 'link-a', patientId = 'patient-a', subject = 'subject-a') {
  database.prepare(`
    insert into patient_self_links (
      id, identity_issuer, identity_subject, organization_id, facility_id,
      patient_id, purpose, verification_ref, verified_by_membership_id,
      status, version, created_at, expires_at
    ) values (?, 'synthetic-patient-issuer', ?, 'org-mobile', 'fac-mobile',
      ?, 'protocol.read', 'synthetic-verification-1', 'membership-mobile',
      'active', 1, CAST(unixepoch('subsec') * 1000 AS INTEGER),
      CAST(unixepoch('subsec') * 1000 AS INTEGER) + 86400000)
  `).run(id, subject, patientId);
}

afterEach(() => {
  for (const item of fixtures.splice(0)) {
    item.database.close();
    const directory = resolve(item.directory);
    if (dirname(resolve(item.file)) !== directory || dirname(directory) !== resolve(tmpdir())) {
      throw new Error('Refusing cleanup outside isolated patient-link fixture');
    }
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const path = `${item.file}${suffix}`;
      if (existsSync(path)) unlinkSync(path);
    }
    rmdirSync(directory);
  }
});

describe('MOBILE-1 patient self-link registry (unmounted)', () => {
  it('keeps exact issuer/subject and patient scope after closing and reopening the database', () => {
    const { database, file } = fixture();
    link(database);
    database.close();
    fixtures.pop();
    const reopened = new DatabaseSync(file);
    fixtures.push({ database: reopened, directory: dirname(file), file });
    const row = reopened.prepare('select identity_issuer, identity_subject, patient_id, purpose, status from patient_self_links where id = ?').get('link-a');
    expect(row).toEqual({
      identity_issuer: 'synthetic-patient-issuer', identity_subject: 'subject-a',
      patient_id: 'patient-a', purpose: 'protocol.read', status: 'active',
    });
  });

  it('makes revocation terminal and prevents a reused link id', () => {
    const { database } = fixture();
    link(database);
    database.exec(`update patient_self_links set status = 'revoked', version = 2,
      revoked_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) where id = 'link-a'`);
    expect(() => database.exec("update patient_self_links set status = 'active', revoked_at = null, version = 3 where id = 'link-a'")).toThrow();
    expect(() => database.exec("delete from patient_self_links where id = 'link-a'")).toThrow();
    expect(() => link(database, 'link-a')).toThrow();
    expect(() => database.exec(`insert or replace into patient_self_links
      (id, identity_issuer, identity_subject, organization_id, facility_id, patient_id,
       purpose, verification_ref, verified_by_membership_id, status, version, created_at, expires_at)
      select id, identity_issuer, identity_subject, organization_id, facility_id, patient_id,
       purpose, verification_ref, verified_by_membership_id, 'active', 1,
       CAST(unixepoch('subsec') * 1000 AS INTEGER), expires_at
      from patient_self_links where id = 'link-a'`)).toThrow();
    expect(database.prepare("select status, version from patient_self_links where id = 'link-a'").get())
      .toEqual({ status: 'revoked', version: 2 });
  });

  it('rejects inactive patient/verifier and duplicate active relationship', () => {
    const { database } = fixture();
    link(database);
    expect(() => link(database, 'link-duplicate')).toThrow();
    database.exec("update memberships set status = 'disabled' where id = 'membership-mobile'");
    expect(() => link(database, 'link-b', 'patient-b', 'subject-b')).toThrow();
    database.exec("update memberships set status = 'active' where id = 'membership-mobile'");
    database.exec("update patients set status = 'inactive' where id = 'patient-b'");
    expect(() => link(database, 'link-b', 'patient-b', 'subject-b')).toThrow();
  });
});
