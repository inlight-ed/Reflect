import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type PeriodValue = '7' | '30' | '90';
export type CompareValue = 'previous' | 'year';

type PeriodContextValue = {
  period: PeriodValue;
  compare: CompareValue;
  setPeriod: (value: PeriodValue) => void;
  setCompare: (value: CompareValue) => void;
  params: { period: PeriodValue; compare: CompareValue };
};

const STORAGE_KEY = 'reflect-period';
const PeriodContext = createContext<PeriodContextValue | null>(null);

function read(): { period: PeriodValue; compare: CompareValue } {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as { period?: string; compare?: string };
    return {
      period: saved.period === '7' || saved.period === '90' ? saved.period : '30',
      compare: saved.compare === 'year' ? 'year' : 'previous',
    };
  } catch {
    return { period: '30', compare: 'previous' };
  }
}

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(read);
  const value = useMemo<PeriodContextValue>(() => {
    const save = (next: typeof state) => {
      setState(next);
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* per-session only */ }
    };
    return {
      ...state,
      setPeriod: (period) => save({ ...state, period }),
      setCompare: (compare) => save({ ...state, compare }),
      params: state,
    };
  }, [state]);
  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function usePeriod() {
  const value = useContext(PeriodContext);
  if (!value) throw new Error('usePeriod outside PeriodProvider');
  return value;
}
