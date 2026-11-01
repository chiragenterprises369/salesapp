'use client';

import { objectTarget, type CustomObject, type CustomRecord } from '@vistar/shared';
import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/leads/primitives/sheet';
import { useCreateRecord } from '@/lib/customization';
import { CustomFieldsForm } from '../custom-fields-form';

/** Side sheet to add a record of a custom object (fields from the object definition). */
export function RecordCreateSheet({
  object,
  open,
  onOpenChange,
  onCreated,
}: {
  object: CustomObject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (record: CustomRecord) => void;
}) {
  const create = useCreateRecord(object.key);
  const formId = useId();
  const [attempt, setAttempt] = useState(0);
  const singular = object.labelSingular;
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) setAttempt((a) => a + 1);
        onOpenChange(o);
      }}
    >
      {open && (
        <SheetContent size="lg" aria-describedby={`${formId}-desc`}>
          <header className="flex items-start gap-3 border-b border-border px-5 pt-4 pb-3">
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-lg font-semibold text-fg">
                New {singular.toLowerCase()}
              </SheetTitle>
              <SheetDescription id={`${formId}-desc`} className="text-sm text-muted">
                Fields marked <span className="text-danger-text">*</span> are required. You are the
                owner; change it later on the {singular.toLowerCase()} page.
              </SheetDescription>
            </div>
            <SheetClose asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-11 sm:size-8"
                aria-label={`Close new ${singular.toLowerCase()}`}
              >
                <X aria-hidden />
              </Button>
            </SheetClose>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <CustomFieldsForm
              key={attempt}
              target={objectTarget(object.key)}
              mode="create"
              formId={formId}
              hideActions
              columns={2}
              onSubmit={async (values) => {
                const record = await create.mutateAsync({ values });
                toast.success(`${singular} added: ${record.title || 'Untitled'}`);
                onCreated?.(record);
                onOpenChange(false);
              }}
            />
          </div>
          <footer className="flex flex-col-reverse gap-2 border-t border-border px-5 py-3 sm:flex-row sm:justify-end">
            <SheetClose asChild>
              <Button className="h-11 sm:h-8">Cancel</Button>
            </SheetClose>
            <Button
              type="submit"
              form={formId}
              variant="primary"
              loading={create.isPending}
              className="h-11 sm:h-8"
            >
              Add {singular.toLowerCase()}
            </Button>
          </footer>
        </SheetContent>
      )}
    </Sheet>
  );
}
