export type SiteIdentity = {
  id: string;
  email: string | null;
};

export const SITE_IDENTITY_ISSUER = 'openai:sites';

export function getSiteIdentity(request: Request): SiteIdentity | null {
  const id = request.headers.get('oai-authenticated-user-id')?.trim();

  if (!id) {
    return null;
  }

  return {
    id,
    email: request.headers.get('oai-authenticated-user-email')?.trim() || null,
  };
}

export function toSiteIdentityPrincipal(identity: SiteIdentity) {
  return {
    issuer: SITE_IDENTITY_ISSUER,
    subject: identity.id,
    email: identity.email,
  } as const;
}
