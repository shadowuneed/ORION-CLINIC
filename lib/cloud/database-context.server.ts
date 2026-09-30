import { cache } from 'react';
import { headers } from 'next/headers';
import type { IdentityPrincipal } from '@/lib/auth/workspace-access';
import { readCloudAccessToken, readCloudAuthSession } from './auth-session.server';
import { parseSupabaseCloudConfig } from './supabase-config.server';
import { callCloudRpc, CloudRpcError, type CloudRpcName } from './supabase-rpc.server';

if (typeof window !== 'undefined') throw new Error('Cloud database context is server-only.');

export type CloudDatabaseContext = Readonly<{
  principal: IdentityPrincipal;
  sessionId: string;
  call: (name: CloudRpcName, args?: Record<string, unknown>) => Promise<unknown>;
}>;

export class CloudSessionChangedError extends Error {}

/** Request-bound transport, not a service-role connection or client credential. */
export async function cloudDatabaseForRequest(request: Pick<Request, 'headers' | 'signal'>, requireGeneration = true): Promise<CloudDatabaseContext> {
  const session = await readCloudAuthSession(request.headers);
  const accessToken = readCloudAccessToken(request.headers);
  if (!session || !accessToken) throw new CloudRpcError('unauthenticated');
  if (requireGeneration && request.headers.get('orion-session-generation') !== session.sessionId.replaceAll('-', '')) {
    throw new CloudSessionChangedError();
  }
  const config = parseSupabaseCloudConfig(process.env);
  return Object.freeze({ principal: session.principal, sessionId: session.sessionId,
    call: (name: CloudRpcName, args?: Record<string, unknown>) => callCloudRpc({
      config, accessToken, name, args, signal: request.signal,
    }),
  });
}

// React cache is scoped to one SSR request; there is no process-wide user cache.
export const cloudDatabaseForPage = cache(async () => {
  const database = await cloudDatabaseForRequest({
    headers: new Headers(await headers()), signal: new AbortController().signal,
  }, false);
  let accessOverview: Promise<unknown> | undefined;
  return Object.freeze({ ...database,
    call: (name: CloudRpcName, args?: Record<string, unknown>) => {
      // Shell capabilities and the access picker consume the same checked SSR
      // snapshot. The one RPC still checks live session/grants and commits audit.
      // Keep its failure too: never retry into a different authority snapshot.
      // API contexts, patient reads, writes and calls with args stay uncached.
      if (name !== 'orion_access_overview' || args !== undefined) return database.call(name, args);
      return accessOverview ??= database.call(name);
    },
  });
});
