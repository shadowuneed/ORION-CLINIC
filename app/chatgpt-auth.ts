import { redirect } from 'next/navigation';
import { chatGPTSignInPath } from '@/lib/auth/chatgpt-navigation';
import { cloudDatabaseForPage } from '@/lib/cloud/database-context.server';

export {
  chatGPTSignInPath,
  chatGPTSignOutPath,
} from '@/lib/auth/chatgpt-navigation';

export type ChatGPTUser = {
  userId: string;
  displayName: string;
  email: string | null;
  fullName: string | null;
  issuer?: string;
};

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  // Cloud-only adapter: legacy gateway headers and profile metadata never verify
  // identity. This still grants no membership, role or clinical permission.
  try {
    // Reuse the request-scoped context used by layout and clinical repositories;
    // verification is never cached across requests or accounts.
    const session = await cloudDatabaseForPage();
    return { userId: session.principal.subject, displayName: session.principal.email ?? 'Сотрудник',
      email: session.principal.email, fullName: null, issuer: session.principal.issuer };
  } catch { return null; }
}

export async function requireChatGPTUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;

  redirect(chatGPTSignInPath(returnTo));
}
