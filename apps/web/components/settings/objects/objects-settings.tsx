'use client';

import { objectRecordsHref, objectTarget, type CustomObject } from '@vistar/shared';
import { Archive, ArchiveRestore, Boxes, ExternalLink, Pencil, Plus, TextCursorInput } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { Switch } from '@/components/common/switch';
import { NavIcon } from '@/components/shell/nav-icon';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { toast } from '@/components/ui/toast';
import { useReadOnly } from '@/lib/auth/use-auth';
import { useCustomObjects, useRestoreObject } from '@/lib/customization';
import { PackBadge } from '../common/pack-badge';
import { errorMessage, InlineAlert, ListSkeleton, LoadError } from '../common/states';
import { TAP_BUTTON, TAP_ICON } from '../common/touch';
import { fieldsHref } from '../fields/fields-settings';
import { ArchiveObjectDialog, CreateObjectDialog, EditObjectDialog } from './object-dialogs';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function ObjectsSettings() {
  const [showArchived, setShowArchived] = useState(false);
  const q = useCustomObjects({ includeArchived: showArchived });
  const restore = useRestoreObject();
  const { reason } = useReadOnly();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CustomObject | null>(null);
  const [archiving, setArchiving] = useState<CustomObject | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onRestore(o: CustomObject) {
    setError(null);
    try {
      await restore.mutateAsync(o.key);
      toast.success(`${o.labelPlural} restored`);
    } catch (e) {
      setError(`${o.labelPlural} was not restored. ${errorMessage(e)}`);
    }
  }

  const objects = q.data ?? [];
  const active = objects.filter((o) => !o.archivedAt);
  const archived = objects.filter((o) => o.archivedAt);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-h-11 items-center gap-2.5">
          <Switch id="show-archived-objects" checked={showArchived} onCheckedChange={setShowArchived} />
          <label htmlFor="show-archived-objects" className="text-sm text-fg-secondary">
            Show archived objects
          </label>
        </div>
        <Button variant="primary" className={TAP_BUTTON} onClick={() => setCreating(true)} disabled={!!reason}>
          <Plus aria-hidden />
          New object
        </Button>
      </div>
      {reason && <InlineAlert tone="info">{reason}</InlineAlert>}
      {error && <InlineAlert onDismiss={() => setError(null)}>{error}</InlineAlert>}

      {q.isPending ? (
        <ListSkeleton rows={3} label="Loading custom objects" />
      ) : q.isError ? (
        <LoadError title="Custom objects did not load" onRetry={() => void q.refetch()} />
      ) : active.length === 0 && archived.length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          title="No custom objects yet"
          description="Track things that are not leads, like suppliers, projects, branches or vehicles. Each object gets its own fields and records page."
          action={
            <Button variant="primary" className={TAP_BUTTON} onClick={() => setCreating(true)} disabled={!!reason}>
              <Plus aria-hidden />
              New object
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Custom objects">
          {[...active, ...archived].map((o) => (
            <li key={o.key}>
              <Card className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-3 text-fg-secondary">
                    <NavIcon name={o.icon} fallback="Box" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h2 className="truncate text-sm font-semibold text-fg">{o.labelPlural}</h2>
                      <code className="font-mono text-2xs text-muted">{o.key}</code>
                      {o.archivedAt && <Chip tone="grey">Archived</Chip>}
                      {o.packKey && <PackBadge packKey={o.packKey} />}
                    </div>
                    {o.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{o.description}</p>}
                    <p className="mt-1 flex flex-wrap gap-1.5">
                      <Chip tone="neutral">{count(o.recordCount ?? 0, 'record', 'records')}</Chip>
                      <Chip tone="neutral">{count(o.fields.filter((f) => !f.archivedAt).length, 'field', 'fields')}</Chip>
                      {!o.archivedAt && (o.showInNav ? <Chip tone="indigo">In navigation</Chip> : <Chip tone="grey">Not in navigation</Chip>)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1 sm:shrink-0">
                  {o.archivedAt ? (
                    <Button size="sm" className={TAP_BUTTON} onClick={() => void onRestore(o)} disabled={!!reason} aria-label={`Restore ${o.labelPlural}`}>
                      <ArchiveRestore aria-hidden />
                      Restore
                    </Button>
                  ) : (
                    <>
                      <Button asChild size="sm" className={TAP_BUTTON}>
                        <Link href={objectRecordsHref(o.key)} aria-label={`Open ${o.labelPlural} records`}>
                          <ExternalLink aria-hidden />
                          Records
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="ghost" className={TAP_BUTTON}>
                        <Link href={fieldsHref(objectTarget(o.key))} aria-label={`Edit fields of ${o.labelPlural}`}>
                          <TextCursorInput aria-hidden />
                          Fields
                        </Link>
                      </Button>
                      <Button variant="ghost" size="icon-sm" className={TAP_ICON} aria-label={`Edit ${o.labelPlural}`} onClick={() => setEditing(o)} disabled={!!reason}>
                        <Pencil aria-hidden />
                      </Button>
                      <Button variant="ghost" size="icon-sm" className={TAP_ICON} aria-label={`Archive ${o.labelPlural}`} onClick={() => setArchiving(o)} disabled={!!reason}>
                        <Archive aria-hidden />
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {!showArchived && !q.isPending && !q.isError && active.length > 0 && <p className="text-xs text-muted-strong">Archived objects are hidden. Turn on Show archived objects to restore one.</p>}

      {creating && <CreateObjectDialog readOnlyReason={reason} onClose={() => setCreating(false)} onCreated={() => setCreating(false)} />}
      {editing && <EditObjectDialog key={editing.key} object={editing} readOnlyReason={reason} onClose={() => setEditing(null)} />}
      {archiving && <ArchiveObjectDialog key={archiving.key} object={archiving} onClose={() => setArchiving(null)} />}
    </div>
  );
}
