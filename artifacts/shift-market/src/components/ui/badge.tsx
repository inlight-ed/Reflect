import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export type BadgeProps = {
  tone?: BadgeTone;
  /** The status in words. Required: colour alone never carries the meaning. */
  children: ReactNode;
  /** Decorative icon before the text (hidden from assistive tech). Without it a dot is shown. */
  icon?: ReactNode;
  /** Longer explanation for screen readers and the tooltip, e.g. "Data source: demo snapshot". */
  description?: string;
  className?: string;
  testId?: string;
};

/** A short status label: decision, data source, connection state. */
export function Badge({ tone = 'neutral', children, icon, description, className, testId }: BadgeProps) {
  return (
    <span className={cn('rf-badge', `rf-badge--${tone}`, className)} title={description} data-testid={testId}>
      {icon ? <span aria-hidden className="rf-badge__icon">{icon}</span> : <span aria-hidden className="rf-badge__dot" />}
      <span>{children}</span>
      {description && <span className="visually-hidden">{` — ${description}`}</span>}
    </span>
  );
}
