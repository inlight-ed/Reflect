import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger';
export type ButtonSize = 'sm' | 'md';

type NativeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'>;

export type ButtonProps = NativeButtonProps & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Work in progress: the button is disabled, shows a spinner and reports aria-busy. */
  pending?: boolean;
  /** Icon before the text; decorative, hidden from assistive tech. */
  icon?: ReactNode;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

function classes(variant: ButtonVariant, size: ButtonSize, extra?: string) {
  return cn('rf-button', `rf-button--${variant}`, size === 'sm' && 'rf-button--sm', extra);
}

/** The app's button. Defaults to type="button" so it never submits a form by accident. */
export function Button({ variant = 'primary', size = 'md', pending = false, icon, disabled, className, children, type = 'button', ref, ...rest }: ButtonProps) {
  return (
    <button {...rest} ref={ref} type={type} className={classes(variant, size, className)} disabled={disabled || pending} aria-busy={pending || undefined}>
      {pending ? <Loader2 className="rf-button__spinner" aria-hidden /> : icon && <span aria-hidden className="rf-button__icon">{icon}</span>}
      {children}
    </button>
  );
}

export type IconButtonProps = Omit<NativeButtonProps, 'title'> & {
  /** Required: read by screen readers and shown as the tooltip. */
  label: string;
  icon: ReactNode;
  variant?: Exclude<ButtonVariant, 'primary'>;
  size?: ButtonSize;
  pending?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

/** A button that shows only an icon. The label is mandatory, so it is never announced as just "button". */
export function IconButton({ label, icon, variant = 'tertiary', size = 'md', pending = false, disabled, className, type = 'button', ref, ...rest }: IconButtonProps) {
  if (import.meta.env?.DEV && !label.trim()) console.error('IconButton needs a non-empty label');
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={classes(variant, size, cn('rf-icon-button', className))}
      aria-label={label}
      title={label}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
    >
      {pending ? <Loader2 className="rf-button__spinner" aria-hidden /> : <span aria-hidden className="rf-button__icon">{icon}</span>}
    </button>
  );
}
