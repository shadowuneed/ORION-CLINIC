import type { StaffSessionGrant } from '@/lib/auth/staff-session';
import { normalizeStaffLogin } from '@/lib/auth/staff-login-policy';

const databaseNow = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const passwordHashPattern = /^orion\$scrypt\$v1\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{64}$/;

export type StaffCredentialState = {
  credentialId: string;
  userId: string;
  normalizedLogin: string;
  status: 'active' | 'disabled';
  credentialVersion: number;
  userVersion: number;
};

export type StaffCredentialCommand = {
  credentialId: string;
  eventId: string;
  target: StaffSessionGrant;
  actor: StaffSessionGrant;
};
export type ProvisionStaffCredentialInput = StaffCredentialCommand & { normalizedLogin: string; passwordHash: string };
export type ChangeStaffCredentialInput = StaffCredentialCommand & { expectedCredentialVersion: number };
export type ResetStaffCredentialInput = ChangeStaffCredentialInput & { passwordHash: string };

export type StaffLoginReservation =
  | { status: 'reserved'; attemptId: string; credential: null | { passwordHash: string; credentialVersion: number } }
  | { status: 'throttled'; retryAfterSeconds: number };

export interface StaffCredentialRepository {
  reserveAttempt(normalizedLogin: string, serverGeneratedAttemptId: string): Promise<StaffLoginReservation>;
  finishAttempt(attemptId: string, outcome: 'failure' | 'success', expectedCredentialVersion?: number): Promise<StaffSessionGrant | null>;
}

function validId(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
}

function validGrant(grant: StaffSessionGrant): boolean {
  return Boolean(grant && validId(grant.userId) && grant.expectedIssuer?.trim() && grant.expectedSubject?.trim()
    && Number.isSafeInteger(grant.expectedUserVersion) && grant.expectedUserVersion > 0);
}

function validCommand(input: StaffCredentialCommand): boolean {
  return validId(input.credentialId) && validId(input.eventId) && validGrant(input.target) && validGrant(input.actor);
}

function validHash(value: string): boolean {
  return typeof value === 'string' && value.length === 123 && passwordHashPattern.test(value);
}

const currentAttempt = `exists (
  select 1 from staff_credentials credential join users user on user.id = credential.user_id
  where credential.id = staff_login_attempts.credential_id and credential.version = staff_login_attempts.credential_version
    and credential.status = 'active' and user.id = staff_login_attempts.user_id and user.status = 'active'
    and user.version = staff_login_attempts.user_version and user.version = credential.user_version
    and user.external_issuer = staff_login_attempts.identity_issuer and user.external_subject = staff_login_attempts.identity_subject
    and credential.identity_issuer = user.external_issuer and credential.identity_subject = user.external_subject
)`;

/**
 * Internal persistence, NOT a public administration authorization boundary.
 * A trusted caller must authorize provisioning/reset/disable before passing its
 * exact verified actor. No HTTP route, role grant, plaintext password or clock input.
 * Five admissions per rolling 300 seconds; abandoned and successful attempts count.
 * Retention/purge and restore invalidation require a separate reviewed policy.
 */
export class D1StaffCredentialRepository implements StaffCredentialRepository {
  constructor(private readonly database: D1Database) {}

  async provision(input: ProvisionStaffCredentialInput): Promise<StaffCredentialState | null> {
    if (!validCommand(input) || !validHash(input.passwordHash)
      || normalizeStaffLogin(input.normalizedLogin) !== input.normalizedLogin) return null;
    return this.publish(this.database.prepare(`
      insert into staff_credentials (
        id, user_id, login_normalized, identity_issuer, identity_subject, password_hash, status,
        version, user_version, created_at, updated_at, event_id, actor_id, actor_version, actor_issuer, actor_subject
      )
      select ?1, target.id, ?2, target.external_issuer, target.external_subject, ?3, 'active',
        1, target.version + 1, ${databaseNow}, ${databaseNow}, ?4, actor.id, actor.version, actor.external_issuer, actor.external_subject
      from users target join users actor on actor.id = ?9 and actor.status = 'active' and actor.version = ?10
        and actor.external_issuer = ?11 and actor.external_subject = ?12
      where target.id = ?5 and target.status = 'active' and target.version = ?6
        and target.external_issuer = ?7 and target.external_subject = ?8
        and not exists (select 1 from staff_credentials where id = ?1 or user_id = target.id or login_normalized = ?2)
        and not exists (select 1 from staff_credential_events where id = ?4)
    `).bind(input.credentialId, input.normalizedLogin, input.passwordHash, input.eventId,
      input.target.userId, input.target.expectedUserVersion, input.target.expectedIssuer, input.target.expectedSubject,
      input.actor.userId, input.actor.expectedUserVersion, input.actor.expectedIssuer, input.actor.expectedSubject), input);
  }

  async reset(input: ResetStaffCredentialInput): Promise<StaffCredentialState | null> {
    if (!validHash(input.passwordHash)) return null;
    return this.change(input, input.passwordHash);
  }

  async disable(input: ChangeStaffCredentialInput): Promise<StaffCredentialState | null> {
    return this.change(input, null);
  }

  private async change(input: ChangeStaffCredentialInput, passwordHash: string | null): Promise<StaffCredentialState | null> {
    if (!validCommand(input) || !Number.isSafeInteger(input.expectedCredentialVersion) || input.expectedCredentialVersion < 1) return null;
    return this.publish(this.database.prepare(`
      update staff_credentials set password_hash = coalesce(?1, password_hash), status = ?2,
        version = version + 1, user_version = ?3 + 1, updated_at = ${databaseNow}, event_id = ?4,
        actor_id = ?5, actor_version = ?6, actor_issuer = ?7, actor_subject = ?8
      where id = ?9 and version = ?10 and user_id = ?11 and identity_issuer = ?12 and identity_subject = ?13
        and (?1 is not null or status = 'active')
        and exists (select 1 from users where id = ?11 and status = 'active' and version = ?3
          and external_issuer = ?12 and external_subject = ?13)
        and exists (select 1 from users where id = ?5 and status = 'active' and version = ?6
          and external_issuer = ?7 and external_subject = ?8)
        and not exists (select 1 from staff_credential_events where id = ?4)
    `).bind(passwordHash, passwordHash === null ? 'disabled' : 'active', input.target.expectedUserVersion, input.eventId,
      input.actor.userId, input.actor.expectedUserVersion, input.actor.expectedIssuer, input.actor.expectedSubject,
      input.credentialId, input.expectedCredentialVersion, input.target.userId, input.target.expectedIssuer, input.target.expectedSubject), input);
  }

  private async publish(statement: D1PreparedStatement, input: StaffCredentialCommand): Promise<StaffCredentialState | null> {
    // The credential triggers publish audit + advance the user epoch + revoke all
    // prior sessions in this batch. Any skipped publication must roll back everything.
    const results = await this.database.batch([
      statement,
      this.database.prepare(`
        select case when changes() = 0 or exists (
          select 1 from staff_credentials credential join staff_credential_events event on event.id = credential.event_id
          join users user on user.id = credential.user_id
          where credential.id = ?1 and credential.event_id = ?2 and event.credential_id = credential.id
            and event.version = credential.version and user.version = credential.user_version
        ) then 1 else json('credential_publication_incomplete') end as verified,
          changes() as directChanges
      `).bind(input.credentialId, input.eventId),
    ]);
    // D1 meta.changes includes trigger writes (audit, epoch and session revokes).
    // SQLite changes() counts only the preceding direct credential statement.
    const receipt = results[1]?.results[0] as { directChanges: number } | undefined;
    if (receipt?.directChanges !== 1) return null;
    return this.database.prepare(`
      select credential.id as credentialId, credential.user_id as userId, credential.login_normalized as normalizedLogin,
        credential.status, credential.version as credentialVersion, credential.user_version as userVersion
      from staff_credentials credential join users user on user.id = credential.user_id and user.status = 'active'
        and user.version = credential.user_version and user.external_issuer = credential.identity_issuer
        and user.external_subject = credential.identity_subject
      where credential.id = ?1 and credential.event_id = ?2
    `).bind(input.credentialId, input.eventId).first<StaffCredentialState>();
  }

  async reserveAttempt(normalizedLogin: string, serverGeneratedAttemptId: string): Promise<StaffLoginReservation> {
    if (!validId(serverGeneratedAttemptId) || normalizeStaffLogin(normalizedLogin) !== normalizedLogin) {
      throw new Error('Invalid staff login reservation');
    }
    const results = await this.database.batch([
      this.database.prepare(`
        insert into staff_login_attempts (id, login_normalized, credential_id, credential_version, user_id,
          user_version, identity_issuer, identity_subject, created_at, expires_at, status)
        select ?1, ?2, case when user.id is not null then credential.id end,
          case when user.id is not null then credential.version end,
          user.id, user.version, user.external_issuer, user.external_subject,
          ${databaseNow}, ${databaseNow} + 120000, 'pending'
        from (select 1) seed
        left join staff_credentials credential on credential.login_normalized = ?2 and credential.status = 'active'
        left join users user on user.id = credential.user_id and user.status = 'active' and user.version = credential.user_version
          and user.external_issuer = credential.identity_issuer and user.external_subject = credential.identity_subject
        where (select count(*) from staff_login_attempts where login_normalized = ?2 and created_at > ${databaseNow} - 300000) < 5
          and not exists (select 1 from staff_login_attempts where id = ?1)
      `).bind(serverGeneratedAttemptId, normalizedLogin),
      this.database.prepare(`
        select attempt.id as attemptId, credential.password_hash as passwordHash, credential.version as credentialVersion
        from staff_login_attempts attempt left join staff_credentials credential
          on credential.id = attempt.credential_id and credential.version = attempt.credential_version
        where attempt.id = ?1 and attempt.login_normalized = ?2 and attempt.status = 'pending'
      `).bind(serverGeneratedAttemptId, normalizedLogin),
    ]);
    if (results[0]?.meta.changes === 1) {
      const row = results[1]?.results[0] as { attemptId: string; passwordHash: string | null; credentialVersion: number | null } | undefined;
      if (!row) throw new Error('Staff login reservation was not published');
      return { status: 'reserved', attemptId: row.attemptId, credential: row.passwordHash && row.credentialVersion
        ? { passwordHash: row.passwordHash, credentialVersion: row.credentialVersion } : null };
    }
    if (await this.database.prepare('select id from staff_login_attempts where id = ?1').bind(serverGeneratedAttemptId).first()) {
      throw new Error('Staff login reservation cannot be replayed');
    }
    const retry = await this.database.prepare(`
      select max(1, cast((min(created_at) + 300000 - ${databaseNow} + 999) / 1000 as integer)) as seconds
      from staff_login_attempts where login_normalized = ?1 and created_at > ${databaseNow} - 300000
    `).bind(normalizedLogin).first<{ seconds: number | null }>();
    return { status: 'throttled', retryAfterSeconds: retry?.seconds ?? 1 };
  }

  async finishAttempt(attemptId: string, outcome: 'failure' | 'success', expectedCredentialVersion?: number): Promise<StaffSessionGrant | null> {
    if (!validId(attemptId) || (outcome !== 'failure' && outcome !== 'success')) return null;
    const version = Number.isSafeInteger(expectedCredentialVersion) && expectedCredentialVersion! > 0 ? expectedCredentialVersion! : null;
    const result = await this.database.prepare(`
      update staff_login_attempts set status = case when ?2 = 'success' and credential_version = ?3
        and expires_at > ${databaseNow} and ${currentAttempt} then 'verified' else 'failed' end,
        completed_at = ${databaseNow}
      where id = ?1 and status = 'pending'
    `).bind(attemptId, outcome, version).run();
    if (result.meta.changes !== 1 || outcome !== 'success') return null;
    // Never substitute a newer user/credential version after checking an old hash.
    // The grant is the reservation snapshot and must still be current right now.
    return this.database.prepare(`
      select user_id as userId, user_version as expectedUserVersion,
        identity_issuer as expectedIssuer, identity_subject as expectedSubject
      from staff_login_attempts where id = ?1 and status = 'verified'
        and expires_at > ${databaseNow} and ${currentAttempt}
    `).bind(attemptId).first<StaffSessionGrant>();
  }
}
