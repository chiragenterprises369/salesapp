'use client';

import {
  fieldAccessFor,
  type CustomFieldValue,
  type CustomFieldValues,
  type FieldTarget,
} from '@vistar/shared';
import { AlertCircle, Lock } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fieldErrorMap, isApiRequestError, useVisibleFields } from '@/lib/customization';
import { useMe } from '@/lib/session/session';
import { cn } from '@/lib/cn';
import { CustomFieldInput, isGroupControl } from './custom-field-input';
import {
  changedKeys,
  fieldError,
  isEmptyValue,
  serverFieldErrors,
  validatePayload,
  type FieldDef,
} from './field-utils';

const WIDE_TYPES = new Set(['multi_select', 'geo_point', 'file']);

export interface FieldShellProps {
  def: FieldDef;
  /** Control id (deterministic so the form can focus the first invalid field). */
  id: string;
  readOnly?: boolean;
  error?: string | null;
  children: (a: {
    id: string;
    labelId: string;
    describedBy: string | undefined;
    invalid: boolean;
  }) => ReactNode;
  className?: string;
}

/** Label, required marker, read-only lock hint, help text and error around one field control. */
export function FieldShell({ def, id, readOnly, error, children, className }: FieldShellProps) {
  const labelId = `${id}-label`;
  const helpId = def.helpText ? `${id}-help` : undefined;
  const lockId = readOnly ? `${id}-lock` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, helpId, lockId].filter(Boolean).join(' ') || undefined;
  const group = isGroupControl(def);
  const labelBody = (
    <>
      {def.label}
      {def.required && !readOnly && (
        <>
          <span aria-hidden className="ml-0.5 text-danger-text">
            *
          </span>
          {group && <span className="sr-only"> (required)</span>}
        </>
      )}
    </>
  );
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)} data-field={def.key}>
      <div className="flex items-center justify-between gap-2">
        {group ? (
          <span id={labelId} className="text-xs font-medium text-fg-secondary">
            {labelBody}
          </span>
        ) : (
          <label id={labelId} htmlFor={id} className="text-xs font-medium text-fg-secondary">
            {labelBody}
          </label>
        )}
        {readOnly && (
          <span id={lockId} className="inline-flex shrink-0 items-center gap-1 text-2xs text-muted">
            <Lock aria-hidden className="size-3" />
            Read-only for your role
          </span>
        )}
      </div>
      {children({ id, labelId, describedBy, invalid: !!error })}
      {def.helpText && (
        <p id={helpId} className="text-xs text-muted">
          {def.helpText}
        </p>
      )}
      <div aria-live="polite">
        {error && (
          <p id={errorId} className="flex items-start gap-1 text-xs text-danger-text">
            <AlertCircle aria-hidden className="mt-px size-3.5 shrink-0" />
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export interface CustomFieldsFormProps {
  target: FieldTarget;
  mode: 'create' | 'update';
  initialValues?: CustomFieldValues;
  /** Receives the payload (create: filled fields; update: changed fields, null = cleared). Throw ApiRequestError on failure. */
  onSubmit: (payload: CustomFieldValues) => Promise<unknown>;
  onCancel?: () => void;
  /** Update mode with nothing changed. Defaults to onCancel. */
  onNoChanges?: () => void;
  /** Return true when the error was handled (e.g. a version conflict banner). */
  onError?: (e: unknown) => boolean | void;
  submitLabel?: string;
  /** Render only the fields; the caller renders buttons with form={formId}. */
  formId?: string;
  hideActions?: boolean;
  columns?: 1 | 2;
  /** Extra content above the fields (owner picker, notices). */
  before?: ReactNode;
  className?: string;
  /** Called on every change with the dirty state (unsaved-changes guards). */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * Form for the custom fields of a target (core entity or object:<key>). Renders the fields the role
 * may see; read-only fields are disabled with a lock hint. Validates with the shared rules on blur
 * and submit, then maps server errors (`values.<key>` / `customFields.<key>`) back to the fields.
 */
export function CustomFieldsForm(props: CustomFieldsFormProps) {
  const fields = useVisibleFields(props.target);
  if (fields.isPending) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading fields"
        className="flex flex-col gap-4"
      >
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    );
  }
  if (fields.isError || !fields.data) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-2 rounded-md border border-status-red-border bg-status-red-bg p-3 text-sm text-status-red-fg"
      >
        Fields did not load. Check your connection and try again.
        <Button size="sm" onClick={() => void fields.refetch()} loading={fields.isRefetching}>
          Try again
        </Button>
      </div>
    );
  }
  return <FormBody {...props} defs={fields.data} />;
}

function FormBody({
  defs,
  mode,
  initialValues,
  onSubmit,
  onCancel,
  onNoChanges,
  onError,
  submitLabel,
  formId,
  hideActions,
  columns = 1,
  before,
  className,
  onDirtyChange,
}: CustomFieldsFormProps & { defs: FieldDef[] }) {
  const me = useMe();
  const roleKey = me?.role.key ?? null;
  const base = useId().replace(/:/g, '');
  const [initial] = useState<CustomFieldValues>(() => ({ ...(initialValues ?? {}) }));
  const [values, setValues] = useState<CustomFieldValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const controlId = (key: string) => `${base}-f-${key}`;
  const writable = (d: FieldDef) => fieldAccessFor(d, roleKey) === 'write';

  const setValue = (key: string, v: CustomFieldValue) => {
    const next = { ...values, [key]: v };
    setValues(next);
    if (!touched.has(key)) setTouched(new Set(touched).add(key));
    if (errors[key]) setErrors(({ [key]: _gone, ...rest }) => rest);
    setFormError(null);
    onDirtyChange?.(changedKeys(initial, next).length > 0);
  };

  /** Blur check, only once the person has changed the field (no errors for tabbing past). */
  const check = (d: FieldDef) => {
    if (!touched.has(d.key) && !errors[d.key]) return;
    const msg = fieldError(d, values[d.key]);
    setErrors((e) => {
      if (msg) return { ...e, [d.key]: msg };
      const { [d.key]: _gone, ...rest } = e;
      return rest;
    });
  };

  const focusFirst = (errs: Record<string, string>) => {
    const first = defs.find((d) => errs[d.key]);
    if (!first) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(controlId(first.key));
      const target = el?.matches('button, input, textarea, select, [tabindex]')
        ? el
        : el?.querySelector<HTMLElement>('button, input, textarea, select');
      target?.focus();
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const editable = defs.filter(writable);
    const clientErrors: Record<string, string> = {};
    for (const d of editable) {
      const msg = fieldError(d, values[d.key]);
      if (msg) clientErrors[d.key] = msg;
    }
    const payload: CustomFieldValues = {};
    if (mode === 'create') {
      for (const d of editable) if (!isEmptyValue(values[d.key])) payload[d.key] = values[d.key]!;
    } else {
      const changed = new Set(changedKeys(initial, values));
      for (const d of editable)
        if (changed.has(d.key))
          payload[d.key] = isEmptyValue(values[d.key]) ? null : values[d.key]!;
    }
    const all = { ...validatePayload(defs, payload, { mode, roleKey }), ...clientErrors };
    if (Object.keys(all).length) {
      setErrors(all);
      setFormError(
        Object.keys(all).length === 1
          ? 'Fix the highlighted field to save.'
          : `Fix the ${Object.keys(all).length} highlighted fields to save.`,
      );
      focusFirst(all);
      return;
    }
    if (mode === 'update' && Object.keys(payload).length === 0) {
      (onNoChanges ?? onCancel)?.();
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await onSubmit(payload);
      onDirtyChange?.(false);
    } catch (err) {
      const fieldErrs = serverFieldErrors(fieldErrorMap(err));
      if (Object.keys(fieldErrs).length) {
        setErrors(fieldErrs);
        setFormError(
          isApiRequestError(err) && err.code !== 'VALIDATION_FAILED'
            ? err.message
            : 'Fix the highlighted fields to save.',
        );
        focusFirst(fieldErrs);
      } else if (!onError?.(err)) {
        setFormError(
          isApiRequestError(err)
            ? err.message
            : 'Changes were not saved. Check your connection and try again.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      id={formId}
      noValidate
      onSubmit={(e) => void submit(e)}
      className={cn('flex flex-col gap-4', className)}
      aria-busy={submitting || undefined}
    >
      {formError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-sm text-status-red-fg"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {formError}
        </div>
      )}
      {before}
      {defs.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">
          No fields yet. A company admin can add fields in Settings.
        </p>
      ) : (
        <div className={cn('grid gap-4', columns === 2 && 'sm:grid-cols-2')}>
          {defs.map((d) => {
            const readOnly = !writable(d);
            return (
              <FieldShell
                key={d.key}
                def={d}
                id={controlId(d.key)}
                readOnly={readOnly}
                error={errors[d.key]}
                className={cn(
                  columns === 2 &&
                    (WIDE_TYPES.has(d.type) ||
                      (d.type === 'text' && (d.config as { multiline?: boolean }).multiline)) &&
                    'sm:col-span-2',
                )}
              >
                {(a) => (
                  <CustomFieldInput
                    def={d}
                    value={values[d.key]}
                    onChange={(v) => setValue(d.key, v)}
                    onBlur={() => check(d)}
                    id={a.id}
                    labelId={a.labelId}
                    describedBy={a.describedBy}
                    invalid={a.invalid}
                    disabled={readOnly || submitting}
                    required={d.required && !readOnly}
                  />
                )}
              </FieldShell>
            );
          })}
        </div>
      )}
      {!hideActions && (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {onCancel && (
            <Button type="button" onClick={onCancel} disabled={submitting} className="h-11 sm:h-8">
              Cancel
            </Button>
          )}
          <Button type="submit" variant="primary" loading={submitting} className="h-11 sm:h-8">
            {submitLabel ?? (mode === 'create' ? 'Save' : 'Save changes')}
          </Button>
        </div>
      )}
    </form>
  );
}
