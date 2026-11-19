import { useId, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes } from 'react';
import { AlertCircle, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type FieldText = {
  /** Visible label, always rendered and tied to the control. */
  label: ReactNode;
  /** Help text under the label, read after the label by screen readers. */
  description?: ReactNode;
  /** Error message; marks the control invalid and is read with it. */
  error?: ReactNode;
};

/** Ids that tie a control to its description and error. Exported for tests and custom controls. */
export function fieldIds(base: string, hasDescription: boolean, hasError: boolean, extraDescribedBy?: string) {
  const descriptionId = `${base}-description`;
  const errorId = `${base}-error`;
  const describedBy = [extraDescribedBy, hasDescription ? descriptionId : undefined, hasError ? errorId : undefined].filter(Boolean).join(' ') || undefined;
  return { descriptionId, errorId, describedBy };
}

function FieldShell({ id, label, description, error, required, descriptionId, errorId, className, children }: FieldText & { id: string; required?: boolean; descriptionId: string; errorId: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('rf-field', className)}>
      <label className="rf-field__label" htmlFor={id}>
        {label}
        {required && <span className="rf-field__required" aria-hidden> *</span>}
      </label>
      {description && <p className="rf-field__description" id={descriptionId}>{description}</p>}
      {children}
      {error && <p className="rf-field__error" id={errorId}><AlertCircle aria-hidden />{error}</p>}
    </div>
  );
}

export type TextFieldProps = FieldText & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & {
  /** Class for the wrapper, not the input. */
  className?: string;
  ref?: Ref<HTMLInputElement>;
};

/** A labelled text input. Pass any native input props (type, autoComplete, inputMode, value…). */
export function TextField({ label, description, error, id, className, required, ref, 'aria-describedby': extra, ...input }: TextFieldProps) {
  const generated = useId();
  const controlId = id ?? generated;
  const ids = fieldIds(controlId, Boolean(description), Boolean(error), extra);
  return (
    <FieldShell id={controlId} label={label} description={description} error={error} required={required} descriptionId={ids.descriptionId} errorId={ids.errorId} className={className}>
      <input {...input} ref={ref} id={controlId} required={required} className="rf-field__control" aria-invalid={error ? true : undefined} aria-describedby={ids.describedBy} />
    </FieldShell>
  );
}

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = FieldText & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'children' | 'multiple'> & {
  options: SelectOption[];
  /** Optional first option with an empty value, e.g. "Not selected". */
  placeholder?: string;
  className?: string;
  ref?: Ref<HTMLSelectElement>;
};

/** A labelled native select: keeps the platform picker on phones and full keyboard support. */
export function Select({ label, description, error, id, className, required, options, placeholder, ref, 'aria-describedby': extra, ...select }: SelectProps) {
  const generated = useId();
  const controlId = id ?? generated;
  const ids = fieldIds(controlId, Boolean(description), Boolean(error), extra);
  return (
    <FieldShell id={controlId} label={label} description={description} error={error} required={required} descriptionId={ids.descriptionId} errorId={ids.errorId} className={className}>
      <div className="rf-select">
        <select {...select} ref={ref} id={controlId} required={required} className="rf-field__control" aria-invalid={error ? true : undefined} aria-describedby={ids.describedBy}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
        </select>
        <ChevronDown className="rf-select__chevron" aria-hidden />
      </div>
    </FieldShell>
  );
}
