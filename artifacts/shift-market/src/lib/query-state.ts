import { useCallback, useRef, useState } from 'react';
import { ApiError } from '@workspace/api-client-react';

/**
 * What went wrong with a request, as far as the client can tell. Only what the error itself shows is
 * used: the HTTP status of an ApiError, a body that could not be parsed, or a failed fetch.
 */
export type ErrorKind = 'network' | 'auth' | 'rateLimit' | 'timeout' | 'server' | 'request' | 'parse' | 'unexpected';

export function classifyError(error: unknown): ErrorKind {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return 'auth';
    if (error.status === 429) return 'rateLimit';
    if (error.status === 408 || error.status === 504) return 'timeout';
    if (error.status >= 500) return 'server';
    return 'request';
  }
  // Not exported by the API client, so recognised by name.
  if (error instanceof Error && error.name === 'ResponseParseError') return 'parse';
  // fetch rejects with a TypeError when the request never got an answer (offline, DNS, CORS, reset).
  // Other TypeErrors are bugs in the page, not the network.
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) return 'network';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'network';
  return 'unexpected';
}

/** Whether repeating the same request can help. A rejected sign-in or a bad request will fail the same way. */
export function canRetry(kind: ErrorKind) {
  return kind !== 'auth' && kind !== 'request';
}

/**
 * Runs `refetch` at most once at a time: a call while one is in flight returns that same promise
 * instead of starting another request. Plain logic, so it can be tested without a browser.
 */
export function createRetryGuard(refetch: () => Promise<unknown> | unknown, onChange?: (pending: boolean) => void) {
  let inFlight: Promise<void> | null = null;
  return {
    get pending() { return inFlight !== null; },
    run(): Promise<void> {
      if (inFlight) return inFlight;
      onChange?.(true);
      inFlight = (async () => {
        try { await refetch(); } catch { /* the query keeps the error; the state shows it */ } finally {
          inFlight = null;
          onChange?.(false);
        }
      })();
      return inFlight;
    },
  };
}

/**
 * Retry for a state's button: the query's own refetch behind createRetryGuard, plus a pending flag for
 * the button. It never starts requests of its own.
 */
export function useRetry(refetch: () => Promise<unknown> | unknown) {
  const [pending, setPending] = useState(false);
  const latest = useRef(refetch);
  latest.current = refetch;
  const guard = useRef<ReturnType<typeof createRetryGuard> | null>(null);
  guard.current ??= createRetryGuard(() => latest.current(), setPending);
  const retry = useCallback(() => guard.current!.run(), []);
  return { retry, pending };
}

/**
 * The error a block should show. React Query clears `error` as soon as a retry starts when there is no
 * data yet, which would make the block vanish mid-retry; this keeps the last error until the retry ends.
 */
export function nextShownError(previous: unknown, state: { error: unknown; isFetching: boolean }): unknown {
  if (state.error) return state.error;
  return state.isFetching ? previous : null;
}

export function useShownError(state: { error: unknown; isFetching: boolean }) {
  const shown = useRef<unknown>(null);
  shown.current = nextShownError(shown.current, state);
  return shown.current;
}

/**
 * The last successful answer. React Query drops the earlier data it showed as a placeholder when the
 * request for a new key (a new period) fails; this keeps it so the page can show it as stale instead
 * of replacing everything with an error.
 */
export function useLastData<T>(data: T | undefined): T | undefined {
  const last = useRef<T | undefined>(undefined);
  if (data !== undefined) last.current = data;
  return last.current;
}
