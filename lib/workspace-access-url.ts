export type SelectedWorkspaceAccess = { accessAssignmentId: string; facilityId: string; canManage?: boolean };

export function scopedWorkspaceUrl(path: string, selection: SelectedWorkspaceAccess | null) {
  if (!selection) return path;
  // Scope is only propagated to same-origin clinical routes, never provider URLs.
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  const url = new URL(path, 'https://orion.invalid');
  const allowed = url.pathname === '/' || url.pathname === '/live' || url.pathname === '/encounters/new' ||
    url.pathname === '/api/workspace' || url.pathname.startsWith('/api/workspace/') ||
    url.pathname.startsWith('/api/clinical/') || url.pathname.startsWith('/api/local-speech/');
  if (!allowed) return path;
  url.searchParams.set('accessAssignmentId', selection.accessAssignmentId);
  url.searchParams.set('facilityId', selection.facilityId);
  return `${url.pathname}${url.search}${url.hash}`;
}

export type WorkspacePageQuery = {
  encounterId?: string | string[];
  accessAssignmentId?: string | string[];
  facilityId?: string | string[];
};

export function workspacePageUrl(path: '/' | '/live' | '/encounters/new', query: WorkspacePageQuery) {
  const params = new URLSearchParams();
  for (const key of ['encounterId', 'accessAssignmentId', 'facilityId'] as const) {
    const value = query[key];
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else if (value !== undefined) params.set(key, value);
  }
  return `${path}${params.size ? `?${params}` : ''}`;
}
/** Preserve explicit selectors, including malformed duplicates, for server validation. */
export function workspaceNavigationUrl(target: string, currentPath: string, search: string): string {
  if (!['/', '/live'].includes(target) || !['/', '/live', '/encounters/new'].includes(currentPath)) return target;
  const source = new URLSearchParams(search);
  const query = new URLSearchParams();
  for (const key of ['encounterId', 'accessAssignmentId', 'facilityId']) {
    for (const value of source.getAll(key)) query.append(key, value);
  }
  return query.size ? `${target}?${query}` : target;
}
