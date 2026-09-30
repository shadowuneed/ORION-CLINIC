import { getChatGPTUser } from '../chatgpt-auth';
import { AuthAccessScreen } from '../auth-access-screen';

// Deliberately public: redirecting logout into a protected page signs in again.
export default async function SignedOutPage() {
  const user = await getChatGPTUser();
  return <AuthAccessScreen mode={user ? 'active' : 'signedout'} />;
}
