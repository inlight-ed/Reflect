import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

const icons = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: OctagonAlert } satisfies Record<NoticeTone, unknown>;

export type InlineNoticeProps = {
  tone?: NoticeTone;
  title?: ReactNode;
  children: ReactNode;
  /** One fitting action, e.g. a Button or a link. */
  action?: ReactNode;
  /**
   * How the notice is announced. Defaults: danger → "alert" (interrupts), others → "status" (polite).
   * Use "none" for notices that are part of the page from the start and need no announcement.
   */
  announce?: 'alert' | 'status' | 'none';
  className?: string;
  testId?: string;
};

/** A message inside the page: explanation, warning, error or confirmation. The tone also has its own icon. */
export function InlineNotice({ tone = 'info', title, children, action, announce, className, testId }: InlineNoticeProps) {
  const Icon = icons[tone];
  const mode = announce ?? (tone === 'danger' ? 'alert' : 'status');
  return (
    <div className={cn('rf-notice', `rf-notice--${tone}`, className)} role={mode === 'none' ? undefined : mode} data-testid={testId}>
      <Icon className="rf-notice__icon" aria-hidden />
      <div className="rf-notice__body">
        {title && <strong className="rf-notice__title">{title}</strong>}
        {children}
      </div>
      {action && <div className="rf-notice__action">{action}</div>}
    </div>
  );
}
