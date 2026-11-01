'use client';

import { RadioGroup } from 'radix-ui';
import { cn } from '@/lib/cn';
import type { AccessLevel } from './field-draft';

const LEVELS: ReadonlyArray<{ value: AccessLevel; label: string; short: string }> = [
  { value: 'write', label: 'Visible and editable', short: 'Can edit' },
  { value: 'read', label: 'Read-only', short: 'Read only' },
  { value: 'hidden', label: 'Hidden', short: 'Hidden' },
];

export interface AccessRole {
  key: string;
  name: string;
}

/**
 * Per-role access to one field. Each row is a radio group (arrow keys move between the three
 * levels). Hidden fields are not sent to that role at all; read-only fields are shown but locked.
 */
export function AccessMatrix({ roles, value, onChange, disabled }: { roles: readonly AccessRole[]; value: Record<string, AccessLevel>; onChange: (next: Record<string, AccessLevel>) => void; disabled?: boolean }) {
  const set = (key: string, level: AccessLevel) => {
    const next = { ...value };
    if (level === 'write') delete next[key];
    else next[key] = level;
    onChange(next);
  };
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-medium text-fg-secondary">Access by role</legend>
      <p className="mb-2 text-xs text-muted">Company admins always see every field here in Settings.</p>
      <div className="overflow-hidden rounded-md border border-border">
        <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,4.25rem)] items-center border-b border-border bg-surface-2 px-2 py-1.5 text-2xs font-medium text-fg-secondary sm:grid-cols-[minmax(0,1fr)_repeat(3,7rem)] sm:text-xs" aria-hidden>
          <span>Role</span>
          {LEVELS.map((l) => (
            <span key={l.value} className="text-center">
              <span className="sm:hidden">{l.short}</span>
              <span className="hidden sm:inline">{l.label}</span>
            </span>
          ))}
        </div>
        {roles.map((r) => {
          const current = value[r.key] ?? 'write';
          return (
            <RadioGroup.Root
              key={r.key}
              value={current}
              onValueChange={(v) => set(r.key, v as AccessLevel)}
              aria-label={`Access for ${r.name}`}
              disabled={disabled}
              orientation="horizontal"
              className="grid grid-cols-[minmax(0,1fr)_repeat(3,4.25rem)] items-center border-b border-border px-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_repeat(3,7rem)]"
            >
              <span className="truncate py-2 text-sm text-fg">{r.name}</span>
              {LEVELS.map((l) => (
                <span key={l.value} className="flex justify-center">
                  <RadioGroup.Item
                    value={l.value}
                    aria-label={`${r.name}: ${l.label}`}
                    className={cn(
                      'focus-ring group inline-flex size-9 items-center justify-center rounded-full max-sm:size-11 pointer-coarse:size-11',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                    )}
                  >
                    <span className="inline-flex size-4 items-center justify-center rounded-full border border-input bg-surface transition-colors group-hover:border-fg-secondary group-data-[state=checked]:border-accent">
                      <RadioGroup.Indicator className="size-2 rounded-full bg-accent" />
                    </span>
                  </RadioGroup.Item>
                </span>
              ))}
            </RadioGroup.Root>
          );
        })}
      </div>
    </fieldset>
  );
}
