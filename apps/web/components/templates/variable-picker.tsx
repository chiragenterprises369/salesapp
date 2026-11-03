'use client';

import type { EmailTemplateVariable } from '@vistar/shared';
import { Braces } from 'lucide-react';
import { Chip } from '@/components/ui/chip';
import { cn } from '@/lib/cn';

/**
 * Declared variables of a template. Clicking one inserts `{{name}}` where the cursor was (subject or
 * body); used ones are marked, required ones say so.
 */
export function VariablePicker({
  variables,
  used,
  onInsert,
  disabled,
  className,
}: {
  variables: readonly EmailTemplateVariable[];
  used: readonly string[];
  onInsert: (name: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <section aria-labelledby="var-picker-title" className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div className="flex items-center gap-2">
        <Braces aria-hidden className="size-4 text-fg-secondary" />
        <h3 id="var-picker-title" className="text-sm font-semibold text-fg">
          Variables
        </h3>
        <span className="text-xs text-muted-strong">Click to insert at the cursor</span>
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2 2xl:grid-cols-3">
        {variables.map((v) => {
          const isUsed = used.includes(v.name);
          return (
            <li key={v.name} className="min-w-0">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onInsert(v.name)}
                className="focus-ring flex w-full min-w-0 flex-col items-start gap-0.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-left transition-colors hover:border-border-strong hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="flex w-full min-w-0 items-center gap-1.5">
                  <code className="truncate font-mono text-xs text-fg">{`{{${v.name}}}`}</code>
                  {v.required && (
                    <Chip tone={isUsed ? 'green' : 'red'} className="ml-auto shrink-0">
                      Required
                    </Chip>
                  )}
                  {!v.required && isUsed && (
                    <Chip tone="green" className="ml-auto shrink-0">
                      Used
                    </Chip>
                  )}
                </span>
                <span className="w-full truncate text-xs text-muted-strong">
                  {v.label} · e.g. {v.sample}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
