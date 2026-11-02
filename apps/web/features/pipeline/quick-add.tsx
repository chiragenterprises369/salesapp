'use client';

import type { Stage } from '@vistar/shared';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { useCreateLead } from '@/lib/leads/data';
import { TOUCH_BUTTON } from './touch';

/**
 * Inline "add lead" card at the top of a column. Enter saves (and keeps the form open for the
 * next lead), Escape closes. Errors stay inline; a toast confirms each saved lead.
 */
export function QuickAdd({ stage, touch, onClose }: { stage: Stage; touch: boolean; onClose: () => void }) {
  const create = useCreateLead();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<{ field: 'name' | 'value' | 'form'; message: string } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const submit = async () => {
    if (create.isPending) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError({ field: 'name', message: 'Enter a name for the lead.' });
      nameRef.current?.focus();
      return;
    }
    const raw = value.replace(/[₹,\s]/g, '');
    const valueInr = raw === '' ? 0 : Number(raw);
    if (!Number.isInteger(valueInr) || valueInr < 0) {
      setError({ field: 'value', message: 'Enter the value in whole rupees, for example 25000.' });
      valueRef.current?.focus();
      return;
    }
    setError(null);
    try {
      await create.mutateAsync({ name: trimmed, valueInr, stageId: stage.id, source: 'manual', tags: [], customFields: {} });
      toast.success(`${trimmed} added to ${stage.name}`);
      setName('');
      setValue('');
      nameRef.current?.focus();
    } catch {
      setError({ field: 'form', message: `Could not add ${trimmed}. Check your connection and try again.` });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const size = touch ? 'h-[44px] text-base' : undefined;
  return (
    <form
      aria-label={`Add lead to ${stage.name}`}
      className="mx-2 mb-2 flex animate-fade-in flex-col gap-2 rounded-lg border border-border bg-surface p-2.5 shadow-raised"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Input
        ref={nameRef}
        size="sm"
        className={size}
        aria-label="Lead name"
        placeholder="Lead name"
        autoComplete="off"
        maxLength={120}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onKeyDown}
        aria-invalid={error?.field === 'name' || undefined}
        aria-describedby={error?.field === 'name' ? errorId : undefined}
      />
      <Input
        ref={valueRef}
        size="sm"
        className={cn('tabular', size)}
        aria-label="Value in rupees"
        placeholder="Value in ₹ (optional)"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        aria-invalid={error?.field === 'value' || undefined}
        aria-describedby={error?.field === 'value' ? errorId : undefined}
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger-text">
          {error.message}
        </p>
      )}
      <div className="flex items-center justify-end gap-1.5">
        <Button size={touch ? 'touch' : 'sm'} className={cn(touch && TOUCH_BUTTON)} variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button size={touch ? 'touch' : 'sm'} className={cn(touch && TOUCH_BUTTON)} type="submit" loading={create.isPending}>
          Add lead
        </Button>
      </div>
    </form>
  );
}
