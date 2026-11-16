import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetSessionQueryKey, useGetSession, useLogoutAccount, type SessionState } from '@workspace/api-client-react';

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

  const value = useMemo<SessionContextValue>(() => ({
    session: query.data,
    loading: query.isLoading,
    signedIn,
    demo: !signedIn && demoFlag,
    enterDemo,
    leaveDemo,
    signOut,
    refresh,
  }), [query.data, query.isLoading, signedIn, demoFlag, enterDemo, leaveDemo, signOut, refresh]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession outside SessionProvider');
  return value;
}
