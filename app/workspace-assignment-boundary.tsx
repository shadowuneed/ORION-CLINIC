import { env } from 'cloudflare:workers';
import type { ReactNode } from 'react';
import { resolveEncounterAssignmentAccess, EncounterAccessSelectionRequiredError } from '@/lib/auth/encounter-assignment-access';
import { AccessAssignmentNotFoundError, AccessMembershipRequiredError, AccessPermissionRequiredError } from '@/lib/auth/access-governance';
import { toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { workspaceRequestSelection, InvalidWorkspaceAccessSelectionError } from '@/lib/auth/workspace-request-access';
import { D1AccessGovernanceRepository } from '@/lib/repositories/access-governance';
import { WorkspaceAccessProvider } from '@/lib/workspace-access-context';
import type { ChatGPTUser } from './chatgpt-auth';
import styles from './authenticated-clinic-page.module.css';

export async function WorkspaceAssignmentBoundary({ user, returnTo, children }: {
  user: ChatGPTUser;
  returnTo: string;
  children: ReactNode;
}) {
  let selected;
  try {
    const selection = workspaceRequestSelection(new Request(`https://orion.invalid${returnTo}`));
    selected = await resolveEncounterAssignmentAccess(
      new D1AccessGovernanceRepository(env.DB),
      toSiteIdentityPrincipal({ id: user.userId, email: user.email }),
      'encounter.read', selection,
    );
  } catch (error) {
    const current = new URL(returnTo, 'https://orion.invalid');
    if (error instanceof EncounterAccessSelectionRequiredError) {
      return <main className={styles.state}>
        <h1>Выберите рабочее назначение</h1>
        <p>Приём откроется только в выбранном назначении врача. Права разных отделений не объединяются.</p>
        <form method="get" action={current.pathname}>
          {current.searchParams.get('encounterId') && <input type="hidden" name="encounterId" value={current.searchParams.get('encounterId')!} />}
          <label>Клиника и отделение <select name="accessAssignmentId" required defaultValue="">
            <option value="" disabled>Выберите назначение</option>
            {error.assignments.map((item) => <option key={item.assignmentId} value={item.assignmentId}>
              {item.organizationName} · {item.facilityName} · {item.departmentName}
            </option>)}
          </select></label>
          <button type="submit">Открыть рабочее место</button>
        </form>
      </main>;
    }
    const denied = error instanceof AccessAssignmentNotFoundError || error instanceof AccessMembershipRequiredError ||
      error instanceof AccessPermissionRequiredError || error instanceof InvalidWorkspaceAccessSelectionError;
    return <main className={styles.state}>
      <h1>{denied ? 'Рабочее назначение недоступно' : 'Не удалось проверить доступ'}</h1>
      <p>Клинические данные не открыты. Проверьте назначение или повторите загрузку.</p>
      <a href={`${current.pathname}${current.searchParams.get('encounterId') ? `?encounterId=${encodeURIComponent(current.searchParams.get('encounterId')!)}` : ''}`}>Выбрать рабочее назначение</a>
    </main>;
  }
  const canManage = selected.effectivePermissions.includes('encounter.manage') && !selected.denyPermissions.includes('encounter.manage');
  return <WorkspaceAccessProvider key={`${returnTo}:${selected.assignmentId}`} selection={{
    accessAssignmentId: selected.assignmentId, facilityId: selected.facility.id,
    canManage,
  }}>{!canManage && <p role="status" className={styles.readOnly}>Только просмотр: в этом назначении нет права изменять приём, запускать запись или подписывать документы.</p>}{children}</WorkspaceAccessProvider>;
}
