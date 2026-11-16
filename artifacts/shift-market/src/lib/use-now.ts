import { useEffect, useState } from 'react';

/** Current time that re-renders every `intervalMs` (clocks, greetings, dates). */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(interval);
  }, [intervalMs]);
  return now;
}
