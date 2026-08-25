import { getChatGPTUser } from './chatgpt-auth';
import { OrionWorkspace } from './orion-workspace';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getChatGPTUser();

  return <OrionWorkspace clinicianName={user?.displayName ?? 'Врач'} />;
}
