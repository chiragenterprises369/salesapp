import { cloneElement, isValidElement, useId, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

const fieldBase = [
  'w-full min-w-0 rounded-md border border-input bg-surface text-fg shadow-card',
  'placeholder:text-muted transition-[border-color,box-shadow] duration-150 ease-standard',
  'hover:border-fg-secondary focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60',
  'aria-invalid:border-danger-text aria-invalid:focus-visible:ring-danger-text',
];

export type InputProps = Omit<ComponentProps<'input'>, 'size'> & { size?: 'sm' | 'md' };

export function Input({ className, size = 'md', type = 'text', ...props }: InputProps) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(fieldBase, size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-2.5 text-sm', 'file:border-0 file:bg-transparent file:text-sm file:font-medium', className)}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn(fieldBase, 'min-h-20 px-2.5 py-2 text-sm', className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label data-slot="label" className={cn('text-xs font-medium text-fg-secondary', className)} {...props} />;
}

export interface FormFieldProps {
  label: ReactNode;
  /** Single control element (Input, Textarea, select trigger...). id/aria props are injected. */
  children: ReactElement<Record<string, unknown>>;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
}

/** Label + control + hint/error with correct id, aria-describedby and aria-invalid wiring. */
export function FormField({ label, children, hint, error, required, className }: FormFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required || undefined,
      })
    : children;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span aria-hidden className="ml-0.5 text-danger-text">
            *
          </span>
        )}
      </Label>
      {control}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}
