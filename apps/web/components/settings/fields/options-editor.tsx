'use client';

import { ArrowDown, ArrowUp, Lock, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { toOptionValue } from '../common/keys';
import { TAP_BUTTON, TAP_ICON } from '../common/touch';
import { optionUid, type OptionColor, type OptionDraft } from './field-draft';

const COLORS: ReadonlyArray<{ value: OptionColor | ''; label: string }> = [
  { value: '', label: 'No colour' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'indigo', label: 'Indigo' },
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'amber', label: 'Amber' },
  { value: 'grey', label: 'Grey' },
  { value: 'red', label: 'Red' },
];

/**
 * Choices for single / multiple choice fields: label (what people see), value (stored, auto from the
 * label until edited, fixed once saved) and an optional soft colour. Order here = order in pickers.
 */
export function OptionsEditor({ options, onChange, errors, disabled }: { options: OptionDraft[]; onChange: (next: OptionDraft[]) => void; errors: Record<string, string>; disabled?: boolean }) {
  const listRef = useRef<HTMLOListElement>(null);
  const [focusUid, setFocusUid] = useState<string | null>(null);

  useEffect(() => {
    if (!focusUid) return;
    listRef.current?.querySelector<HTMLInputElement>(`[data-option="${focusUid}"]`)?.focus();
  }, [focusUid]);

  const patch = (uid: string, p: Partial<OptionDraft>) => onChange(options.map((o) => (o.uid === uid ? { ...o, ...p } : o)));
  const setLabel = (o: OptionDraft, label: string) => patch(o.uid, o.valueEdited || o.locked ? { label } : { label, value: toOptionValue(label) });
  const add = () => {
    const uid = optionUid();
    onChange([...options, { uid, value: '', label: '', color: '', valueEdited: false, locked: false }]);
    setFocusUid(uid);
  };
  const move = (i: number, to: number) => {
    const next = [...options];
    const [o] = next.splice(i, 1);
    next.splice(to, 0, o!);
    onChange(next);
  };
  const listError = errors['config.options'];

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-medium text-fg-secondary">
        Options<span aria-hidden className="ml-0.5 text-danger-text">*</span>
      </legend>
      {options.length > 0 && (
        <ol ref={listRef} className="flex flex-col gap-2">
          {options.map((o, i) => {
            const labelErr = errors[`config.options.${i}.label`];
            const valueErr = errors[`config.options.${i}.value`];
            const n = i + 1;
            return (
              <li key={o.uid} className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-2 sm:flex-row sm:items-start">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <label className="sr-only" htmlFor={`${o.uid}-label`}>
                    Option {n} label
                  </label>
                  <Input
                    id={`${o.uid}-label`}
                    data-option={o.uid}
                    value={o.label}
                    placeholder={`Option ${n}`}
                    maxLength={60}
                    onChange={(e) => setLabel(o, e.target.value)}
                    aria-invalid={labelErr ? true : undefined}
                    aria-describedby={labelErr ? `${o.uid}-label-err` : undefined}
                    disabled={disabled}
                  />
                  {labelErr && (
                    <p id={`${o.uid}-label-err`} className="text-xs text-danger-text">
                      {labelErr}
                    </p>
                  )}
                </div>
                <div className="flex min-w-0 flex-col gap-1 sm:w-36">
                  <label className="sr-only" htmlFor={`${o.uid}-value`}>
                    Option {n} stored value
                  </label>
                  <span className="relative">
                    <Input
                      id={`${o.uid}-value`}
                      value={o.value}
                      placeholder="value"
                      maxLength={40}
                      className={cn('font-mono text-xs', o.locked && 'pr-7')}
                      onChange={(e) => patch(o.uid, { value: e.target.value, valueEdited: true })}
                      readOnly={o.locked}
                      aria-invalid={valueErr ? true : undefined}
                      aria-describedby={valueErr ? `${o.uid}-value-err` : o.locked ? `${o.uid}-value-lock` : undefined}
                      disabled={disabled}
                    />
                    {o.locked && <Lock aria-hidden className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted" />}
                  </span>
                  {o.locked && !valueErr && (
                    <span id={`${o.uid}-value-lock`} className="sr-only">
                      Saved value, cannot change
                    </span>
                  )}
                  {valueErr && (
                    <p id={`${o.uid}-value-err`} className="text-xs text-danger-text">
                      {valueErr}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <label className="sr-only" htmlFor={`${o.uid}-color`}>
                    Option {n} colour
                  </label>
                  <NativeSelect id={`${o.uid}-color`} wrapperClassName="w-32" value={o.color} onChange={(e) => patch(o.uid, { color: e.target.value as OptionColor | '' })} disabled={disabled}>
                    {COLORS.map((c) => (
                      <option key={c.label} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button variant="ghost" size="icon-sm" className={TAP_ICON} aria-label={`Move option ${o.label || n} up`} disabled={disabled || i === 0} onClick={() => move(i, i - 1)}>
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button variant="ghost" size="icon-sm" className={TAP_ICON} aria-label={`Move option ${o.label || n} down`} disabled={disabled || i === options.length - 1} onClick={() => move(i, i + 1)}>
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button variant="ghost" size="icon-sm" className={TAP_ICON} aria-label={`Remove option ${o.label || n}`} disabled={disabled} onClick={() => onChange(options.filter((x) => x.uid !== o.uid))}>
                    <X aria-hidden />
                  </Button>
                </div>
                {o.label.trim() && (
                  <span className="hidden self-center lg:inline-flex" aria-hidden>
                    <Chip tone={o.color || 'neutral'}>{o.label}</Chip>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {listError && (
        <p role="alert" className="text-xs text-danger-text">
          {listError}
        </p>
      )}
      <div>
        <Button size="sm" className={TAP_BUTTON} onClick={add} disabled={disabled}>
          <Plus aria-hidden />
          Add option
        </Button>
      </div>
      {options.some((o) => o.locked) && <p className="text-xs text-muted">Saved values cannot change because records store them. Removing an option keeps it on records that already have it.</p>}
    </fieldset>
  );
}
