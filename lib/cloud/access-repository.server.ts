import type { AccessGovernanceRepository } from '@/lib/auth/access-governance';
import type { IdentityPrincipal } from '@/lib/auth/workspace-access';
import type { CloudDatabaseContext } from './database-context.server';
import { cloudDatabaseForPage } from './database-context.server';
import { parseCloudAccessOverview } from './response-contracts';
import { CloudRpcError } from './supabase-rpc.server';

export class CloudAccessGovernanceRepository implements AccessGovernanceRepository {
  constructor(private readonly context: CloudDatabaseContext) {}

  async listPrincipalAssignments(principal: IdentityPrincipal) {
    if (principal.issuer !== this.context.principal.issuer || principal.subject !== this.context.principal.subject) {
      throw new CloudRpcError('forbidden');
    }
    // SQL verifies the current auth.sessions row and writes access audit atomically.
    return parseCloudAccessOverview(await this.context.call('orion_access_overview')).assignments;
  }
}

export async function cloudAccessRepositoryForPage() {
  return new CloudAccessGovernanceRepository(await cloudDatabaseForPage());
}
