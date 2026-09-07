'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { scopedWorkspaceUrl, type SelectedWorkspaceAccess } from './workspace-access-url';

const AccessContext = createContext<SelectedWorkspaceAccess | null>(null);

export function WorkspaceAccessProvider({ selection, children }: {
  selection: SelectedWorkspaceAccess;
  children: ReactNode;
}) {
  return <AccessContext.Provider value={selection}>{children}</AccessContext.Provider>;
}

export function useWorkspaceUrl() {
  const selection = useContext(AccessContext);
  return useMemo(() => (url: string) => scopedWorkspaceUrl(url, selection), [selection]);
}

export function useWorkspaceCanManage() {
  return useContext(AccessContext)?.canManage === true;
}

export function useWorkspaceFetch() {
  const url = useWorkspaceUrl();
  return useMemo(() => (input: string, init?: RequestInit) => fetch(url(input), init), [url]);
}
