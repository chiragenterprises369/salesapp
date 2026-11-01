'use client';

import { fieldAccessFor, type Lead } from '@vistar/shared';
import { Lock, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { CustomFieldDisplay } from '@/components/customization/custom-field-display';
import { CustomFieldsForm } from '@/components/customization/custom-fields-form';
import { useVisibleFields } from '@/lib/customization';
import { useUpdateLead } from '@/lib/leads/data';
import { useCan, useMe } from '@/lib/session/session';

/**
 * Custom fields of a lead from the field definitions (Settings > Fields, packs). Hidden fields are
 * not shown to the role; read-only ones carry a lock. "Edit" switches the block to a form that saves
 * through the lead update hook and shows field errors from the API inline.
 */
export function LeadCustomFields({ lead }: { lead: Lead }) {
  const me = useMe();
  const fields = useVisibleFields('lead');
  const canUpdate = useCan('leads.update');
  const update = useUpdateLead();
  const [editing, setEditing] = useState(false);
  const defs = fields.data ?? [];
  const canEditSome = canUpdate && defs.some((d) => fieldAccessFor(d, me?.role.key) === 'write');
  const headingId = `lead-fields-${lead.id}`;

  return (
    <section className="flex flex-col gap-2" aria-labelledby={headingId}>
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 id={headingId} className="text-xs font-semibold text-fg-secondary">
          Custom fields
        </h3>
        {canEditSome && !editing && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditing(true)}
            className="h-11 sm:h-7"
            aria-label="Edit custom fields"
          >
            <Pencil aria-hidden />
            Edit
          </Button>
        )}
      </div>

      {fields.isPending ? (
        <div role="status" aria-label="Loading custom fields" className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      ) : fields.isError ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-strong">
          Custom fields did not load.
          <Button size="sm" variant="link" onClick={() => void fields.refetch()}>
            Try again
          </Button>
        </p>
      ) : defs.length === 0 ? (
        <p className="text-sm text-muted-strong">
          No custom fields yet. A company admin can add them in Settings.
        </p>
      ) : editing ? (
        <div className="rounded-md border border-border bg-surface p-3">
          <CustomFieldsForm
            target="lead"
            mode="update"
            initialValues={lead.customFields}
            submitLabel="Save fields"
            onCancel={() => setEditing(false)}
            onSubmit={async (customFields) => {
              await update.mutateAsync({ id: lead.id, patch: { customFields } });
              toast.success('Custom fields saved');
              setEditing(false);
            }}
          />
        </div>
      ) : (
        <dl className="grid grid-cols-[minmax(6rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          {defs.map((d) => {
            const readOnly = canUpdate && fieldAccessFor(d, me?.role.key) === 'read';
            return (
              <div key={d.key} className="contents">
                <dt className="flex items-start gap-1 text-muted-strong">
                  <span>{d.label}</span>
                  {readOnly && (
                    <>
                      <Lock aria-hidden className="mt-0.5 size-3 shrink-0" />
                      <span className="sr-only">(read-only for your role)</span>
                    </>
                  )}
                </dt>
                <dd className="flex min-w-0 text-fg">
                  <CustomFieldDisplay def={d} value={lead.customFields[d.key]} />
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}
