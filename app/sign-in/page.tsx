import { headers } from 'next/headers';
import { AuthAccessScreen } from '../auth-access-screen';
import { getChatGPTUser } from '../chatgpt-auth';
import { getAuthenticatedClinicContext } from '../authenticated-clinic-page';

// Public by design: protected pages lead here; only the explicit provider link logs in.
export default async function SignInPage({ searchParams }: {
  searchParams: Promise<{ return_to?: string | string[] }>;
}) {
  const [parameters, requestHeaders, currentUser] = await Promise.all([searchParams, headers(), getChatGPTUser()]);
  const returnTo = typeof parameters.return_to === 'string' ? parameters.return_to : '/';
  // Presentation only. This label never authorizes a request or changes the provider.
  const localDevelopment = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(requestHeaders.get('host') ?? '');
  if (currentUser) {
    const context = await getAuthenticatedClinicContext('/access');
    return <AuthAccessScreen mode="recognized" localDevelopment={localDevelopment}
      currentProfile={{ staffName: context.profile.staffName, roles: context.profile.roles, providerName: currentUser.displayName }} />;
  }
  return <AuthAccessScreen mode="signin" returnTo={returnTo} localDevelopment={localDevelopment} />;
}
