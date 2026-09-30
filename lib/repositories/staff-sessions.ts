import {
  STAFF_SESSION_ABSOLUTE_MS,
  STAFF_SESSION_IDLE_MS,
  type CreateStaffSessionInput,
  type StaffSession,
  type StaffSessionRepository,
} from '@/lib/auth/staff-session';

const tokenHashPattern = /^[a-f0-9]{64}$/;
const databaseNow = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";

function isTokenHash(value: string): boolean {
  return typeof value === 'string' && value.length === 64 && tokenHashPattern.test(value);
}

type SessionRow = {
  sessionId: string;
  userId: string;
  displayName: string;
  issuer: string;
  subject: string;
  email: string | null;
  createdAt: number;
  lastSeenAt: number;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
};

/**
 * Durable authentication foundation, not a credential verifier or role resolver.
 * All liveness decisions use the DB clock and exact current individual identity.
 * Database failures propagate; no process-local session or identity fallback exists.
 */
export class D1StaffSessionRepository implements StaffSessionRepository {
  constructor(private readonly database: D1Database) {}

  async create(input: CreateStaffSessionInput): Promise<StaffSession | null> {
    if (!isTokenHash(input.tokenHash) ||
      !input.sessionId || input.sessionId.length > 128 || input.sessionId.trim() !== input.sessionId ||
      !input.userId || !input.expectedIssuer?.trim() || !input.expectedSubject?.trim() ||
      !Number.isSafeInteger(input.expectedUserVersion) || input.expectedUserVersion < 1) {
      return null;
    }

    // The grant is rechecked in the insertion statement, not trusted from a
    // previous password/identity-provider lookup. Collisions never replay a login.
    const result = await this.database.prepare(`
      insert into staff_sessions (
        id, token_hash, user_id, user_version, identity_issuer, identity_subject,
        created_at, last_seen_at, idle_expires_at, absolute_expires_at, version
      )
      select ?1, ?2, user.id, user.version, user.external_issuer, user.external_subject,
        ${databaseNow}, ${databaseNow}, ${databaseNow} + ?7, ${databaseNow} + ?8, 1
      from users user
      where user.id = ?3 and user.status = 'active' and user.version = ?4
        and user.external_issuer = ?5 and user.external_subject = ?6
        and not exists (select 1 from staff_sessions existing where existing.id = ?1 or existing.token_hash = ?2)
      on conflict do nothing
    `).bind(input.sessionId, input.tokenHash, input.userId, input.expectedUserVersion,
      input.expectedIssuer, input.expectedSubject, STAFF_SESSION_IDLE_MS, STAFF_SESSION_ABSOLUTE_MS).run();
    if (result.meta.changes !== 1) return null;

    // A concurrent disable/revoke after insertion must not return an authenticated
    // principal. The insertion remains durable, with any revocation tombstone.
    return this.readCurrent(input.tokenHash);
  }

  async resolve(tokenHash: string): Promise<StaffSession | null> {
    if (!isTokenHash(tokenHash)) return null;

    // A single guarded statement serializes touch with logout/account changes.
    // Expired or revoked rows cannot be extended or resurrected. The trigger also
    // applies these rules to direct SQL, independently of this WHERE clause.
    const result = await this.database.prepare(`
      update staff_sessions
      set last_seen_at = max(last_seen_at, ${databaseNow}),
        idle_expires_at = min(absolute_expires_at, max(last_seen_at, ${databaseNow}) + ?2),
        version = version + 1
      where token_hash = ?1 and revoked_at is null
        and created_at <= ${databaseNow}
        and idle_expires_at > ${databaseNow} and absolute_expires_at > ${databaseNow}
        and exists (
          select 1 from users user where user.id = staff_sessions.user_id and user.status = 'active'
            and user.version = staff_sessions.user_version
            and user.external_issuer = staff_sessions.identity_issuer
            and user.external_subject = staff_sessions.identity_subject
        )
    `).bind(tokenHash, STAFF_SESSION_IDLE_MS).run();
    if (result.meta.changes !== 1) return null;

    // Do not return a cached/pre-touch principal: logout or a user change can win
    // between the conditional update and this final current-state read.
    return this.readCurrent(tokenHash);
  }

  async revoke(tokenHash: string): Promise<void> {
    if (!isTokenHash(tokenHash)) return;
    await this.database.batch([
      this.database.prepare(`
        update staff_sessions set revoked_at = ${databaseNow}, version = version + 1
        where token_hash = ?1 and revoked_at is null
      `).bind(tokenHash),
      this.database.prepare(`
        select case when not exists (
          select 1 from staff_sessions where token_hash = ?1 and revoked_at is null
        ) then 1 else json('staff_session_revocation_not_published') end as verified
      `).bind(tokenHash),
    ]);
  }

  /** Revoke existing sessions; a future verified login is a separate operation. */
  async revokeAll(userId: string): Promise<void> {
    if (!userId) return;
    // Verify publication before commit, so a valid new login after this batch
    // cannot be mistaken for a session that the revocation failed to invalidate.
    await this.database.batch([
      this.database.prepare(`
        update staff_sessions set revoked_at = ${databaseNow}, version = version + 1
        where user_id = ?1 and revoked_at is null
      `).bind(userId),
      this.database.prepare(`
        select case when not exists (
          select 1 from staff_sessions where user_id = ?1 and revoked_at is null
        ) then 1 else json('staff_session_revocation_not_published') end as verified
      `).bind(userId),
    ]);
  }

  private async readCurrent(tokenHash: string): Promise<StaffSession | null> {
    const row = await this.database.prepare(`
      select session.id as sessionId, user.id as userId, user.display_name as displayName,
        user.external_issuer as issuer, user.external_subject as subject, user.email_normalized as email,
        session.created_at as createdAt, session.last_seen_at as lastSeenAt,
        session.idle_expires_at as idleExpiresAt, session.absolute_expires_at as absoluteExpiresAt
      from staff_sessions session
      join users user on user.id = session.user_id and user.status = 'active'
        and user.version = session.user_version and user.external_issuer = session.identity_issuer
        and user.external_subject = session.identity_subject
      where session.token_hash = ?1 and session.revoked_at is null
        and session.created_at <= ${databaseNow}
        and session.idle_expires_at > ${databaseNow} and session.absolute_expires_at > ${databaseNow}
    `).bind(tokenHash).first<SessionRow>();
    if (!row) return null;
    const { issuer, subject, email, ...session } = row;
    return { ...session, principal: { issuer, subject, email } };
  }
}
