'use client';

import { renderTemplate, WORKFLOW_VARIABLES } from '@vistar/shared';
import { Braces, Plus, Search, X } from 'lucide-react';
import { Popover } from 'radix-ui';
import {
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { previewContext } from '../../lib/preview';

export const selectClass =
  'h-8 w-full min-w-0 rounded-md border border-input bg-surface px-2 text-sm text-fg shadow-card transition-[border-color,box-shadow] duration-150 ease-standard hover:border-fg-secondary focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60 aria-invalid:border-danger-text';

export interface Option {
  value: string;
  label: string;
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  error,
  hint,
  required,
  placeholder,
  className,
}: {
  label: ReactNode;
  value: string | undefined;
  options: Option[];
  onChange: (v: string | undefined) => void;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  /** Shown as the empty option (value undefined). */
  placeholder?: string;
  className?: string;
}) {
  return (
    <FormField label={label} error={error} hint={hint} required={required} className={className}>
      <select
        className={selectClass}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      >
        {(placeholder !== undefined || !value) && (
          <option value="">{placeholder ?? 'Choose…'}</option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FormField>
  );
}

export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  required,
  placeholder,
  type = 'text',
  maxLength,
}: {
  label: ReactNode;
  value: string | undefined;
  onChange: (v: string) => void;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  placeholder?: string;
  type?: ComponentProps<'input'>['type'];
  maxLength?: number;
}) {
  return (
    <FormField label={label} error={error} hint={hint} required={required}>
      <Input
        type={type}
        value={value ?? ''}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
    </FormField>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  error,
  hint,
  required,
  min,
  max,
  placeholder,
  emptyValue,
  className,
}: {
  label: ReactNode;
  value: number | null | undefined;
  onChange: (v: number | null | undefined) => void;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  min?: number;
  max?: number;
  placeholder?: string;
  /** What an empty input stores (undefined or null). */
  emptyValue?: null | undefined;
  className?: string;
}) {
  return (
    <FormField label={label} error={error} hint={hint} required={required} className={className}>
      <Input
        type="number"
        inputMode="numeric"
        value={value ?? ''}
        min={min}
        max={max}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === '' ? emptyValue : Number(raw));
        }}
      />
    </FormField>
  );
}

export function CheckboxField({
  label,
  hint,
  checked,
  onChange,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-2', className)}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="focus-ring mt-0.5 size-4 shrink-0 cursor-pointer rounded-xs accent-[var(--accent)] disabled:cursor-not-allowed"
      />
      <label htmlFor={id} className="cursor-pointer text-xs leading-5 text-fg">
        {label}
        {hint && (
          <span id={`${id}-hint`} className="block text-2xs leading-4 text-muted">
            {hint}
          </span>
        )}
      </label>
    </div>
  );
}

export function MultiCheckField({
  legend,
  options,
  value,
  onChange,
  error,
  hint,
}: {
  legend: ReactNode;
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
  error?: string;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <fieldset
      className="flex flex-col gap-1.5"
      aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
      aria-invalid={error ? true : undefined}
    >
      <legend className="mb-1.5 text-xs font-medium text-fg-secondary">{legend}</legend>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {options.map((o) => (
          <CheckboxField
            key={o.value}
            label={o.label}
            checked={value.includes(o.value)}
            onChange={(on) =>
              onChange(on ? [...value, o.value] : value.filter((v) => v !== o.value))
            }
          />
        ))}
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** String list as removable chips; Enter or comma adds. */
export function TagsField({
  label,
  value,
  onChange,
  error,
  hint,
  required,
  placeholder = 'Type and press Enter',
  suggestions = [],
  normalise,
}: {
  label: ReactNode;
  value: string[];
  onChange: (v: string[]) => void;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  placeholder?: string;
  suggestions?: readonly string[];
  normalise?: (s: string) => string;
}) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const parts = raw
      .split(',')
      .map((s) => (normalise ? normalise(s.trim()) : s.trim()))
      .filter(Boolean);
    const next = [...value];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    if (next.length !== value.length) onChange(next);
    setDraft('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (draft.trim()) add(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  const remaining = suggestions.filter((s) => !value.includes(s));
  return (
    <div className="flex flex-col gap-1.5">
      <FormField label={label} error={error} hint={hint} required={required}>
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => draft.trim() && add(draft)}
        />
      </FormField>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Added">
          {value.map((v) => (
            <li key={v}>
              <span className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-surface-2 pr-0.5 pl-2 text-xs text-fg">
                {v}
                <button
                  type="button"
                  onClick={() => onChange(value.filter((x) => x !== v))}
                  aria-label={`Remove ${v}`}
                  className="focus-ring inline-flex size-5 items-center justify-center rounded-full text-muted hover:bg-surface-3 hover:text-fg"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {remaining.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-2xs text-muted">Suggestions:</span>
          {remaining.slice(0, 8).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange([...value, s])}
              className="focus-ring inline-flex h-5 items-center gap-0.5 rounded-full border border-dashed border-border-strong px-1.5 text-2xs text-fg-secondary hover:border-accent-text hover:text-accent-text"
            >
              <Plus className="size-2.5" aria-hidden />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function KeyValueField({
  label,
  value,
  onChange,
  keyPlaceholder = 'Header',
  valuePlaceholder = 'Value',
}: {
  label: ReactNode;
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const rows = Object.entries(value);
  const setRow = (i: number, k: string, v: string) => {
    const next = rows.map((r, j) => (j === i ? ([k, v] as [string, string]) : r));
    onChange(Object.fromEntries(next));
  };
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-xs font-medium text-fg-secondary">{label}</legend>
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            size="sm"
            aria-label={`${keyPlaceholder} ${i + 1}`}
            placeholder={keyPlaceholder}
            value={k}
            onChange={(e) => setRow(i, e.target.value, v)}
          />
          <Input
            size="sm"
            aria-label={`${valuePlaceholder} ${i + 1}`}
            placeholder={valuePlaceholder}
            value={v}
            onChange={(e) => setRow(i, k, e.target.value)}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Remove row ${i + 1}`}
            onClick={() => onChange(Object.fromEntries(rows.filter((_, j) => j !== i)))}
          >
            <X aria-hidden />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="ghost"
        className="self-start"
        onClick={() =>
          onChange({
            ...value,
            [rows.some(([k]) => k === '') ? `header_${rows.length + 1}` : '']: '',
          })
        }
      >
        <Plus aria-hidden />
        Add {keyPlaceholder.toLowerCase()}
      </Button>
    </fieldset>
  );
}

/** Popover listing WORKFLOW_VARIABLES; picks insert `{{key}}`. */
export function VariablePicker({
  onPick,
  label = 'Insert variable',
}: {
  onPick: (token: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const picked = useRef(false);
  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    return WORKFLOW_VARIABLES.filter((v) => !s || `${v.label} ${v.key}`.toLowerCase().includes(s));
  }, [q]);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ('');
      }}
    >
      <Popover.Trigger asChild>
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-2xs text-accent-text">
          <Braces aria-hidden />
          {label}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          className="z-50 w-72 rounded-lg border border-border bg-surface p-1.5 text-fg shadow-overlay outline-none data-[state=open]:animate-fade-in"
          onCloseAutoFocus={(e) => {
            if (picked.current) {
              e.preventDefault();
              picked.current = false;
            }
          }}
        >
          <label className="relative mb-1 block">
            <span className="sr-only">Search variables</span>
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted"
            />
            <Input
              size="sm"
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search variables"
              className="pl-7"
            />
          </label>
          <ul className="max-h-64 overflow-y-auto" role="listbox" aria-label="Variables">
            {items.map((v) => (
              <li key={v.key} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="focus-ring flex w-full items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
                  onClick={() => {
                    picked.current = true;
                    setOpen(false);
                    onPick(`{{${v.key}}}`);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-fg">{v.label}</span>
                    <span className="block truncate font-mono text-2xs text-muted">{`{{${v.key}}}`}</span>
                  </span>
                  <span className="max-w-24 shrink-0 truncate text-2xs text-muted">
                    {v.example}
                  </span>
                </button>
              </li>
            ))}
            {items.length === 0 && (
              <li className="px-2 py-3 text-center text-xs text-muted">No variables match.</li>
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Text input or textarea with a variable picker that inserts at the cursor, and an optional preview. */
export function TemplateTextField({
  label,
  value,
  onChange,
  error,
  hint,
  required,
  multiline,
  rows = 4,
  maxLength,
  placeholder,
  preview,
  counter,
}: {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  /** Show the rendered text with example values under the field. */
  preview?: boolean;
  counter?: (v: string) => string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const insert = (token: string) => {
    const el = multiline ? areaRef.current : inputRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  };
  const rendered = preview ? renderTemplate(value, previewContext()) : '';
  return (
    <div className="relative flex flex-col gap-1">
      <div className="absolute top-[-3px] right-0">
        <VariablePicker onPick={insert} />
      </div>
      <FormField label={label} error={error} hint={hint} required={required}>
        {multiline ? (
          <Textarea
            ref={areaRef}
            rows={rows}
            value={value}
            maxLength={maxLength}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className="resize-y"
          />
        ) : (
          <Input
            ref={inputRef}
            value={value}
            maxLength={maxLength}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </FormField>
      {counter && <p className="text-right text-2xs text-muted tabular">{counter(value)}</p>}
      {preview && value.includes('{{') && (
        <p className="text-2xs text-muted">
          Preview: <span className="text-fg-secondary">{rendered || '…'}</span>
        </p>
      )}
    </div>
  );
}

export function Section({
  title,
  children,
  action,
}: {
  title: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-border px-4 py-4 first:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-fg">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Rendered message with example data. */
export function MessagePreview({
  text,
  title = 'Preview with sample data',
}: {
  text: string | null;
  title?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-fg-secondary">{title}</p>
      <div className="rounded-lg rounded-tl-xs border border-border bg-surface-2 px-3 py-2 text-sm whitespace-pre-wrap text-fg">
        {text?.trim() ? text : <span className="text-muted">Nothing to preview yet.</span>}
      </div>
    </div>
  );
}
