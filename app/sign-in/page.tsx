import { headers } from 'next/headers';
import { getChatGPTUser } from '../chatgpt-auth';
import { CloudSignInScreen } from './cloud-sign-in-screen';
import { hasCloudSessionCookies } from '@/lib/cloud/auth-session.server';

export default async function SignInPage() {
  const user = await getChatGPTUser();
  const requestHeaders = await headers();
  const hasStoredSession = hasCloudSessionCookies(requestHeaders);
  return <CloudSignInScreen authenticated={Boolean(user)} email={user?.email ?? null} hasStoredSession={hasStoredSession} />;
}
