import { z } from 'zod';
import { resolveStaffSession, type StaffSessionRepository } from './staff-session';

if (typeof window !== 'undefined') throw new Error('Staff identity requires server execution');

/** Internal user ID is NOT the external subject and must never be recast as one. */
export type ServerStaffIdentity = Readonly<{
  user: Readonly<{ id: string; displayName: string; email: string | null }>;
  principal: Readonly<{ issuer: string; subject: string; email: string | null }>;
}>;

export type ServerStaffResolution =
  | Readonly<{ status: 'authenticated'; identity: ServerStaffIdentity }>
  | Readonly<{ status: 'unauthenticated' }>
  | Readonly<{ status: 'unavailable' }>;

const scalar = (value: string) => !/[\p{Cc}\p{Surrogate}]/u.test(value);
const id = z.string().min(1).max(256).refine(value => value.trim() === value && scalar(value));
const currentSessionProjection = z.object({
  userId: id,
  displayName: z.string().min(1).max(500).refine(value => value.trim().length > 0 && scalar(value)),
  principal: z.object({
    issuer: id, subject: id,
    email: z.string().min(1).max(320).refine(value => value.trim().length > 0 && scalar(value)).nullable(),
  }),
});

/**
 * Shared staff-only boundary for future SSR and API adapters. No Sites, forwarded
 * identity, bearer header, URL, role picker, environment switch or global cache.
 * The injected durable repository owns current-user and DB-clock expiry checks.
 * Call on EVERY request; this result is a snapshot, not a durable authorization
 * grant. Existing exact-assignment resolvers must still authorize each resource
 * and recheck around slow I/O/publication. Never serialize the raw session row.
 */
export async function resolveStaffServerPrincipal(
  headers: Headers,
  sessions: StaffSessionRepository,
): Promise<ServerStaffResolution> {
  try {
    const session = await resolveStaffSession(headers, sessions);
    if (session === null) return Object.freeze({ status: 'unauthenticated' });
    // Fail closed on an invalid adapter result instead of inventing identity or
    // exposing a database row. Parse only explicit server-controlled fields.
    const parsed = currentSessionProjection.safeParse(session);
    if (!parsed.success) return Object.freeze({ status: 'unavailable' });
    const { userId, displayName, principal } = parsed.data;
    const identity: ServerStaffIdentity = Object.freeze({
      user: Object.freeze({ id: userId, displayName, email: principal.email }),
      principal: Object.freeze({ issuer: principal.issuer, subject: principal.subject, email: principal.email }),
    });
    return Object.freeze({ status: 'authenticated', identity });
  } catch {
    // DB/crypto/adapter failure is not a login redirect or anonymous/Sites fallback.
    // Exceptions can contain identities or credentials; do not log/reflect them.
    return Object.freeze({ status: 'unavailable' });
  }
}
