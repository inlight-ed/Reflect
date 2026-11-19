import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';

/** True when the viewer asked the system for less motion; animations then jump straight to their end state. */
export function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Eases a number towards `target` (first render counts up from 0, later changes glide from the previous value).
 * The last frame is always exactly `target`, so formatted text ends up identical to the static value.
 */
export function useAnimatedNumber(target: number, duration = 650) {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));
  const from = useRef(value);
  useEffect(() => {
    if (!Number.isFinite(target) || prefersReducedMotion() || typeof requestAnimationFrame === 'undefined') { from.current = target; setValue(target); return; }
    const start = from.current;
    let frame = 0;
    let began: number | undefined;
    const step = (now: number) => {
      began ??= now;
      const progress = Math.min(1, (now - began) / duration);
      const eased = 1 - (1 - progress) ** 3; // ease-out cubic
      const next = progress === 1 ? target : start + (target - start) * eased;
      from.current = next;
      setValue(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

/**
 * A button that fires only after being held down (mouse, touch, Enter or Space) for `holdMs`.
 * Used for destructive actions instead of window.confirm: a stray click cannot trigger it,
 * and the consequence text stays visible as the tooltip and the accessible description.
 */
export function HoldButton({ onConfirm, children, description, disabled, className = '', holdMs = 1100, testId }: {
  onConfirm: () => void;
  children: ReactNode;
  description?: string;
  disabled?: boolean;
  className?: string;
  holdMs?: number;
  testId?: string;
}) {
  const { t } = useI18n();
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keyDown = useRef(false);
  const descriptionId = useId();

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    keyDown.current = false;
    setHolding(false);
  };
  const begin = () => {
    if (disabled || timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => { timer.current = undefined; keyDown.current = false; setHolding(false); onConfirm(); }, prefersReducedMotion() ? Math.min(holdMs, 600) : holdMs);
  };
  useEffect(() => cancel, []);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault(); // a plain press must not fire the click
    if (event.repeat || keyDown.current) return;
    keyDown.current = true;
    begin();
  };
  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') cancel();
  };

  return (
    <button
      type="button"
      className={`btn hold-button ${holding ? 'holding' : ''} ${className}`}
      style={{ ['--hold-ms' as string]: `${holdMs}ms` }}
      disabled={disabled}
      title={description ? `${description}\n${t('motion.hold')}` : t('motion.hold')}
      aria-describedby={descriptionId}
      onPointerDown={(event) => { if (event.button === 0) begin(); }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={cancel}
      onContextMenu={(event) => event.preventDefault()}
      data-testid={testId}
    >
      <span className="hold-fill" aria-hidden />
      <span className="hold-label">{holding ? t('motion.holding') : children}</span>
      <span id={descriptionId} className="visually-hidden">{description ? `${description} ` : ''}{t('motion.hold')}</span>
    </button>
  );
}

/** Thin progress bar for long-running work; `value` is 0..1. */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <span className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
