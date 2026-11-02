'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  objectRecordsHref,
  objectTarget,
  type CustomObject,
  type CustomRecord,
  type Page,
} from '@vistar/shared';
import { format } from 'date-fns';
import { AlertTriangle, ArrowLeft, ChevronDown, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { timeAgo, useScopedUsers } from '@/components/leads/lead-meta';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/leads/primitives/menu';
import { ErrorState } from '@/components/leads/states';
import {
  isApiRequestError,
  recordKeys,
  useCustomObject,
  useDeleteRecord,
  useRecord,
  useUpdateRecord,
} from '@/lib/customization';
import { useCan, useMe } from '@/lib/session/session';
import { cn } from '@/lib/cn';
import { CustomFieldDisplay } from '../custom-field-display';
import { CustomFieldsForm } from '../custom-fields-form';
import { isNotFound, ObjectIcon, useObjectFields, useUserById } from './record-meta';
import { RecordDetailSkeleton, RecordsNotFound } from './record-states';
import { RelatedRecords } from './related-records';

const WIDE = new Set(['multi_select', 'geo_point', 'file']);

export interface RecordDetailProps {
  objectKey: string;
  recordId: string;
  /** List page of this object (breadcrumb, after delete). Defaults to /app/objects/<key>. */
  basePath?: string;
}

/** One record of a custom object: fields with edit in place, owner, delete, records that link here. */
export function RecordDetail({ objectKey, recordId, basePath }: RecordDetailProps) {
  const obj = useCustomObject(objectKey);
  const rec = useRecord(objectKey, recordId);
  const back = basePath ?? objectRecordsHref(objectKey);
  if (obj.isPending || (rec.isPending && !obj.isError)) return <RecordDetailSkeleton />;
  const failed = (obj.isError && !isNotFound(obj.error)) || (rec.isError && !isNotFound(rec.error));
  if (failed) {
    return (
      <div className="rounded-lg border border-border bg-surface shadow-card">
        <ErrorState
          title="This record did not load"
          onRetry={() => void Promise.all([obj.refetch(), rec.refetch()])}
          retrying={obj.isRefetching || rec.isRefetching}
        />
      </div>
    );
  }
  if (!obj.data || obj.data.archivedAt)
    return <RecordsNotFound kind="object" backHref="/app" backLabel="Go to the dashboard" />;
  if (!rec.data)
    return (
      <RecordsNotFound
        kind="record"
        label={obj.data.labelSingular}
        backHref={back}
        backLabel={`All ${obj.data.labelPlural.toLowerCase()}`}
      />
    );
  return (
    <RecordDetailBody
      object={obj.data}
      record={rec.data}
      basePath={back}
      reload={() => rec.refetch().then((r) => r.data)}
    />
  );
}

function RecordDetailBody({
  object,
  record,
  basePath,
  reload,
}: {
  object: CustomObject;
  record: CustomRecord;
  basePath: string;
  reload: () => Promise<CustomRecord | undefined>;
}) {
  const userById = useUserById();
  const router = useRouter();
  const canUpdate = useCan('records.update');
  const canDelete = useCan('records.delete');
  const fields = useObjectFields(object);
  const update = useUpdateRecord(object.key);
  const del = useDeleteRecord(object.key);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ version: number; formKey: number } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const singular = object.labelSingular;
  const lower = singular.toLowerCase();
  const title = record.title || 'Untitled';

  const startEdit = () => {
    setConflict(false);
    setEditing({ version: record.version, formKey: (editing?.formKey ?? 0) + 1 });
  };

  const loadLatest = async () => {
    const latest = await reload();
    setConflict(false);
    setEditing((e) => ({
      version: latest?.version ?? record.version,
      formKey: (e?.formKey ?? 0) + 1,
    }));
  };

  const remove = async () => {
    try {
      await del.mutateAsync(record.id);
      // Drop it from cached lists now so the list does not flash the deleted row while it refetches.
      qc.setQueriesData<Page<CustomRecord>>(
        { queryKey: [...recordKeys.object(object.key), 'list'] },
        (p) =>
          p && p.items.some((r) => r.id === record.id)
            ? {
                ...p,
                items: p.items.filter((r) => r.id !== record.id),
                ...(p.total !== undefined ? { total: Math.max(0, p.total - 1) } : {}),
              }
            : p,
      );
      toast.success(`${singular} deleted: ${title}`);
      setConfirmDelete(false);
      router.replace(basePath);
    } catch (e) {
      toast.error(isApiRequestError(e) ? e.message : `${singular} was not deleted. Try again.`);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <nav aria-label="Breadcrumb">
        <Link
          href={basePath}
          className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm text-muted-strong hover:text-fg sm:min-h-0"
        >
          <ArrowLeft aria-hidden className="size-4" />
          All {object.labelPlural.toLowerCase()}
        </Link>
      </nav>

      <header className="flex flex-wrap items-start gap-3">
        <span
          aria-hidden
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-soft-fg"
        >
          <ObjectIcon name={object.icon} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold break-words">{title}</h1>
          <p className="text-sm text-muted-strong">
            {singular} · Added {format(new Date(record.createdAt), 'd MMM yyyy')} · Updated{' '}
            {timeAgo(record.updatedAt)}
          </p>
        </div>
        {(canUpdate || canDelete) && (
          <div className="flex w-full gap-2 sm:w-auto">
            {canUpdate && !editing && (
              <Button onClick={startEdit} className="h-11 flex-1 sm:h-8 sm:flex-none">
                <Pencil aria-hidden />
                Edit
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
                className="h-11 flex-1 text-danger-text hover:text-danger-text sm:h-8 sm:flex-none"
              >
                <Trash2 aria-hidden />
                Delete
              </Button>
            )}
          </div>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              {editing ? (
                <div className="flex flex-col gap-4">
                  {conflict && (
                    <div
                      role="alert"
                      className="flex flex-col gap-2 rounded-md border border-status-amber-border bg-status-amber-bg p-3 text-sm text-status-amber-fg sm:flex-row sm:items-center"
                    >
                      <AlertTriangle aria-hidden className="size-4 shrink-0" />
                      <p className="flex-1">
                        Someone else changed this {lower} while you were editing. Load the latest
                        version to continue; your unsaved edits will be replaced.
                      </p>
                      <Button
                        size="sm"
                        onClick={() => void loadLatest()}
                        className="h-11 shrink-0 sm:h-7"
                      >
                        Load latest version
                      </Button>
                    </div>
                  )}
                  <CustomFieldsForm
                    key={editing.formKey}
                    target={objectTarget(object.key)}
                    mode="update"
                    initialValues={record.values}
                    columns={2}
                    onCancel={() => {
                      setEditing(null);
                      setConflict(false);
                    }}
                    onSubmit={async (values) => {
                      await update.mutateAsync({
                        id: record.id,
                        patch: { values, expectedVersion: editing.version },
                      });
                      toast.success(`Changes saved to ${title}`);
                      setEditing(null);
                    }}
                    onError={(e) => {
                      if (isApiRequestError(e) && e.code === 'VERSION_CONFLICT') {
                        setConflict(true);
                        return true;
                      }
                      return false;
                    }}
                  />
                </div>
              ) : fields.length === 0 ? (
                <p className="text-sm text-muted">No fields to show.</p>
              ) : (
                <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  {fields.map((f) => (
                    <div
                      key={f.key}
                      className={cn(
                        'min-w-0',
                        (WIDE.has(f.type) ||
                          (f.type === 'text' && (f.config as { multiline?: boolean }).multiline)) &&
                          'sm:col-span-2',
                      )}
                    >
                      <dt className="text-xs text-muted">{f.label}</dt>
                      <dd className="mt-1 min-w-0 text-sm text-fg">
                        <CustomFieldDisplay def={f} value={record.values[f.key]} />
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>
          <RelatedRecords object={object} recordId={record.id} />
        </div>

        <aside aria-label={`${singular} information`} className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Owner</CardTitle>
            </CardHeader>
            <CardContent>
              <OwnerControl
                record={record}
                editable={canUpdate}
                saving={update.isPending}
                onChange={async (ownerId) => {
                  try {
                    const saved = await update.mutateAsync({
                      id: record.id,
                      patch: { ownerId, expectedVersion: record.version },
                    });
                    if (editing) setEditing({ ...editing, version: saved.version });
                    const name = ownerId ? (userById.get(ownerId)?.name ?? 'teammate') : null;
                    toast.success(
                      name ? `${singular} assigned to ${name}` : `${singular} unassigned`,
                    );
                  } catch (e) {
                    if (isApiRequestError(e) && e.code === 'VERSION_CONFLICT') {
                      await reload();
                      toast.error(
                        `Someone else changed this ${lower}. The latest version is loaded; try again.`,
                      );
                    } else
                      toast.error(
                        isApiRequestError(e) ? e.message : 'Owner not changed. Try again.',
                      );
                  }
                }}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Record</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted">Added</dt>
                <dd className="tabular">
                  {format(new Date(record.createdAt), 'd MMM yyyy, h:mm a')}
                </dd>
                <dt className="text-muted">Updated</dt>
                <dd className="tabular">
                  {format(new Date(record.updatedAt), 'd MMM yyyy, h:mm a')}
                </dd>
              </dl>
            </CardContent>
          </Card>
        </aside>
      </div>

      {canDelete && (
        <Dialog open={confirmDelete} onOpenChange={(o) => !del.isPending && setConfirmDelete(o)}>
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>Delete {title}?</DialogTitle>
              <DialogDescription>
                This removes the {lower} for everyone in your workspace. Records that link to it
                will show it as not available. You cannot undo this.
              </DialogDescription>
            </DialogHeader>
            <DialogBody />
            <DialogFooter>
              <DialogClose asChild>
                <Button className="h-11 sm:h-8" disabled={del.isPending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                variant="danger"
                className="h-11 sm:h-8"
                loading={del.isPending}
                onClick={() => void remove()}
              >
                Delete {lower}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function OwnerControl({
  record,
  editable,
  saving,
  onChange,
}: {
  record: CustomRecord;
  editable: boolean;
  saving: boolean;
  onChange: (ownerId: string | null) => Promise<void>;
}) {
  const userById = useUserById();
  const me = useMe();
  const users = useScopedUsers();
  const owner = record.ownerId ? userById.get(record.ownerId) : null;
  const name = record.ownerId ? (owner?.name ?? 'Former teammate') : 'Unassigned';
  const shown = (
    <>
      {record.ownerId && <Avatar name={name} size="sm" aria-hidden />}
      <span className={cn('truncate', !record.ownerId && 'text-muted')}>
        {record.ownerId === me?.user.id ? `${name} (you)` : name}
      </span>
    </>
  );
  if (!editable) return <p className="flex items-center gap-2 text-sm">{shown}</p>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          disabled={saving}
          className="-mx-2 h-11 w-[calc(100%+1rem)] justify-start gap-2 px-2 sm:h-9"
        >
          <span className="sr-only">Owner: </span>
          {shown}
          <span className="sr-only">. Change owner</span>
          <ChevronDown aria-hidden className="ml-auto text-muted" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuLabel>Assign to</DropdownMenuLabel>
        {users.map((u) => (
          <DropdownMenuItem
            key={u.id}
            disabled={u.id === record.ownerId}
            onSelect={() => void onChange(u.id)}
            className="min-h-11 sm:min-h-8"
          >
            <Avatar name={u.name} size="xs" status={u.status} aria-hidden />
            <span className="truncate">{u.id === me?.user.id ? `${u.name} (you)` : u.name}</span>
          </DropdownMenuItem>
        ))}
        {record.ownerId && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void onChange(null)} className="min-h-11 sm:min-h-8">
              Unassign
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
