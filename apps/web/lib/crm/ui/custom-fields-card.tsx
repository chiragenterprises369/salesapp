'use client';

import { fieldAccessFor, type CustomFieldValues, type FieldTarget } from '@vistar/shared';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { CustomFieldDisplay } from '@/components/customization/custom-field-display';
import { CustomFieldsForm } from '@/components/customization/custom-fields-form';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { useVisibleFields } from '@/lib/customization/hooks';
import { useMe } from '@/lib/session/session';
import { DetailSection } from './detail-layout';

/** Custom fields of a CRM record (contact, company = account, deal) with inline editing. Hidden when there are none. */
export function CustomFieldsCard({ target, values, canUpdate, onSave }: { target: FieldTarget; values: CustomFieldValues; canUpdate: boolean; onSave: (customFields: CustomFieldValues) => Promise<unknown> }) {
  const me = useMe();
  const fields = useVisibleFields(target);
  const [editing, setEditing] = useState(false);
  const defs = fields.data ?? [];
  if (fields.isSuccess && defs.length === 0) return null;
  const canEdit = canUpdate && defs.some((d) => fieldAccessFor(d, me?.role.key) === 'write');
  return (
    <DetailSection
      title="More details"
      actions={
        canEdit &&
        !editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            Edit
          </Button>
        )
      }
    >
      {fields.isPending ? (
        <div role="status" aria-label="Loading fields" className="flex flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : fields.isError ? (
        <p className="text-sm text-muted-strong">
          Custom fields did not load.{' '}
          <Button size="sm" variant="link" onClick={() => void fields.refetch()}>
            Try again
          </Button>
        </p>
      ) : editing ? (
        <CustomFieldsForm
          target={target}
          mode="update"
          columns={2}
          initialValues={values}
          submitLabel="Save fields"
          onCancel={() => setEditing(false)}
          onSubmit={async (customFields) => {
            await onSave(customFields);
            toast.success('Fields saved');
            setEditing(false);
          }}
        />
      ) : (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 2xl:grid-cols-3">
          {defs.map((d) => (
            <div key={d.key} className="min-w-0">
              <dt className="text-xs font-medium text-muted-strong">{d.label}</dt>
              <dd className="mt-0.5 flex min-w-0 text-sm text-fg">
                <CustomFieldDisplay def={d} value={values[d.key]} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </DetailSection>
  );
}
