import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetSessionQueryKey, useGetSession, useLogoutAccount, useOpenWorkspace, type SessionState, type Workspace } from '@workspace/api-client-react';

const DEMO_KEY = 'reflect-demo';

type SessionContextValue = {
  session: SessionState | undefined;
  loading: boolean;
  signedIn: boolean;
  demo: boolean;
  enterDemo: () => void;
  leaveDemo: () => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  /** The open workspace (a shop or an agency) and every workspace the person can open. */
  workspace: Workspace | undefined;
  workspaces: Workspace[];
  /** Viewers only read: no imports, edits, connections or syncs. */
  canEdit: boolean;
  isOwner: boolean;
  /** Opens another workspace; every page reloads its data for it. */
  openWorkspace: (id: string) => Promise<void>;
  /** After creating or joining a workspace (the server already opened it). */
  enteredWorkspace: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

function readDemo() {
  try {
    return window.sessionStorage.getItem(DEMO_KEY) === '1';
  } catch {
    return false;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useGetSession({ query: { queryKey: getGetSessionQueryKey(), staleTime: 30_000 } });
  const logout = useLogoutAccount();
  const open = useOpenWorkspace();
  const [demoFlag, setDemoFlag] = useState(readDemo);
  const signedIn = Boolean(query.data?.user);

  const enterDemo = useCallback(() => {
    try { window.sessionStorage.setItem(DEMO_KEY, '1'); } catch { /* memory only */ }
    setDemoFlag(true);
  }, []);
  const leaveDemo = useCallback(() => {
    try { window.sessionStorage.removeItem(DEMO_KEY); } catch { /* nothing stored */ }
    setDemoFlag(false);
  }, []);
  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries();
  }, [queryClient]);
  const signOut = useCallback(async () => {
    await logout.mutateAsync();
    leaveDemo();
    queryClient.clear();
    await query.refetch();
  }, [logout, leaveDemo, queryClient, query]);

  // Another workspace means other data everywhere: drop every cached answer, then reload the session.
  const enteredWorkspace = useCallback(async () => {
    queryClient.clear();
    await query.refetch();
  }, [queryClient, query]);
  const openWorkspace = useCallback(async (id: string) => {
    await open.mutateAsync({ workspaceId: id });
    await enteredWorkspace();
  }, [open, enteredWorkspace]);
  const workspace = query.data?.workspace;

  const value = useMemo<SessionContextValue>(() => ({
    session: query.data,
    loading: query.isLoading,
    signedIn,
    demo: !signedIn && demoFlag,
    enterDemo,
    leaveDemo,
    signOut,
    refresh,
    workspace,
    workspaces: query.data?.workspaces ?? [],
    canEdit: signedIn && workspace?.role !== 'VIEWER',
    isOwner: workspace?.role === 'OWNER',
    openWorkspace,
    enteredWorkspace,
  }), [query.data, query.isLoading, signedIn, demoFlag, enterDemo, leaveDemo, signOut, refresh, workspace, openWorkspace, enteredWorkspace]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession outside SessionProvider');
  return value;
}
