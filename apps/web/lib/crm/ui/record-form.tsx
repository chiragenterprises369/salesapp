'use client';

import type { CustomFieldValues, FieldTarget } from '@vistar/shared';
import { AlertCircle, X } from 'lucide-react';
import { useId, type FormEvent, type ReactNode } from 'react';
import { CustomFieldsForm } from '@/components/customization/custom-fields-form';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/leads/primitives/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useVisibleFields } from '@/lib/customization/hooks';

/** Right-side sheet for create and edit forms: title, scrolling body, footer with Cancel and Save. */
export function CrmFormSheet({
  open,
  onOpenChange,
  title,
  description,
  formId,
  submitLabel,
  submitting,
  children,
  size = 'xl',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  formId: string;
  submitLabel: string;
  submitting: boolean;
  children: ReactNode;
  size?: 'md' | 'lg' | 'xl';
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size={size} aria-describedby={description ? `${formId}-desc` : undefined}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <SheetTitle className="text-base font-semibold text-fg">{title}</SheetTitle>
            {description && (
              <SheetDescription id={`${formId}-desc`} className="mt-0.5 text-sm text-muted-strong">
                {description}
              </SheetDescription>
            )}
          </div>
          <SheetClose asChild>
            <Button size="icon" variant="ghost" aria-label="Close">
              <X aria-hidden />
            </Button>
          </SheetClose>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface-2 px-5 py-3 sm:flex-row sm:justify-end">
          <SheetClose asChild>
            <Button disabled={submitting} className="h-11 sm:h-8">
              Cancel
            </Button>
          </SheetClose>
          <Button type="submit" form={formId} variant="primary" loading={submitting} className="h-11 sm:h-8">
            {submitLabel}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Thrown from onSubmit when the core fields are invalid (already shown next to the fields). */
export class CoreFieldsInvalid extends Error {
  constructor() {
    super('Fix the highlighted fields to save.');
  }
}

/**
 * Core fields plus the workspace custom fields of a target in ONE form (one submit). The core part
 * validates itself in `onSubmit` (throw CoreFieldsInvalid to stop), server field errors whose path is
 * not a custom field go back to `onServerError`. Without custom fields it is a plain form.
 */
export function CrmRecordForm({
  formId,
  target,
  mode,
  initialCustom,
  core,
  onSubmit,
  onServerError,
  formError,
}: {
  formId: string;
  target: FieldTarget;
  mode: 'create' | 'update';
  initialCustom?: CustomFieldValues;
  core: ReactNode;
  /** Receives the custom field payload (create: filled; update: changed, null = cleared). */
  onSubmit: (customFields: CustomFieldValues) => Promise<unknown>;
  /** Map a server error to the core fields; return true when handled. */
  onServerError: (e: unknown) => boolean;
  formError?: string | null;
}) {
  const fields = useVisibleFields(target);
  const plainId = useId();

  if (fields.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading form" className="flex flex-col gap-4">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    );
  }

  const banner = formError ? (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-sm text-status-red-fg">
      <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
      {formError}
    </div>
  ) : null;

  if (fields.isError || !fields.data?.length) {
    const submit = async (e: FormEvent) => {
      e.preventDefault();
      try {
        await onSubmit({});
      } catch (err) {
        if (err instanceof CoreFieldsInvalid) return;
        onServerError(err);
      }
    };
    return (
      <form id={formId} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5" aria-describedby={fields.isError ? plainId : undefined}>
        {banner}
        {core}
        {fields.isError && (
          <p id={plainId} className="text-xs text-muted-strong">
            Custom fields did not load. Save now and fill them in later from the record page.
          </p>
        )}
      </form>
    );
  }

  return (
    <CustomFieldsForm
      formId={formId}
      hideActions
      target={target}
      mode={mode}
      columns={2}
      initialValues={initialCustom}
      before={
        <div className="flex flex-col gap-5">
          {banner}
          {core}
          <h3 className="mt-1 text-sm font-semibold text-fg">More details</h3>
        </div>
      }
      onNoChanges={() => void onSubmit({}).catch((err) => (err instanceof CoreFieldsInvalid ? undefined : onServerError(err)))}
      onSubmit={onSubmit}
      onError={(err) => err instanceof CoreFieldsInvalid || onServerError(err)}
    />
  );
}
