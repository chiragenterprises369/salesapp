'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';

/** Settings group: heading, description, fields. */
export function SettingsCard({
  title,
  description,
  children,
  footer,
  className,
  headingLevel = 'h2',
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  headingLevel?: 'h2' | 'h3';
}) {
  const H = headingLevel;
  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="px-4 pt-4 pb-3 sm:px-5">
        <H className="text-sm font-semibold text-fg">{title}</H>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      <div className="px-4 pb-4 sm:px-5">{children}</div>
      {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-2 px-4 py-3 sm:px-5">{footer}</div>}
    </Card>
  );
}

/**
 * Save row for a settings form: one primary "Save changes", Discard when there are edits, and the
 * reason when saving is not possible (read-only support session).
 */
export function SaveBar({
  dirty,
  saving,
  onDiscard,
  readOnlyReason,
  label = 'Save changes',
  status,
}: {
  dirty: boolean;
  saving: boolean;
  onDiscard: () => void;
  readOnlyReason?: string | null;
  label?: string;
  /** Short live status, e.g. "Saved". */
  status?: string | null;
}) {
  return (
    <>
      <p className="mr-auto text-xs text-muted-strong" aria-live="polite">
        {readOnlyReason ?? status ?? (dirty ? 'You have unsaved changes' : '')}
      </p>
      {dirty && !readOnlyReason && (
        <Button onClick={onDiscard} disabled={saving}>
          Discard
        </Button>
      )}
      <Button type="submit" variant="primary" disabled={!dirty || !!readOnlyReason} loading={saving}>
        {label}
      </Button>
    </>
  );
}
