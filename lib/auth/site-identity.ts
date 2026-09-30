import { localAccountModeEnabled } from '../local-account-mode';

export type SiteIdentity = {
  id: string;
  email: string | null;
  issuer?: string;
};

export const SITE_IDENTITY_ISSUER = 'openai:sites';

export function getSiteIdentity(request: Request): SiteIdentity | null {
  const id = request.headers.get('oai-authenticated-user-id')?.trim();
  const local = localAccountModeEnabled();
  const issuer = request.headers.get('x-orion-local-issuer')?.trim();

  if (!id || (local && (!issuer || !/^[a-f0-9]{32}$/.test(request.headers.get('x-orion-local-generation') ?? '')))) {
    return null;
  }

  return {
    id,
    email: request.headers.get('oai-authenticated-user-email')?.trim() || null,
    ...(local ? { issuer } : {}),
  };
}

export function toSiteIdentityPrincipal(identity: SiteIdentity) {
  return {
    issuer: localAccountModeEnabled() ? identity.issuer ?? '' : SITE_IDENTITY_ISSUER,
    subject: identity.id,
    email: identity.email,
  } as const;
}
