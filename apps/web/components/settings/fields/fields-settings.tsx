'use client';

import { CORE_ENTITIES, FIELD_TYPE_LABELS, labelOf, objectTarget, parseTarget, type FieldDefinition, type FieldTarget } from '@vistar/shared';
import { Archive, ArchiveRestore, Pencil, Plus, TextCursorInput } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { NativeSelect } from '@/components/common/native-select';
import { NavIcon } from '@/components/shell/nav-icon';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { toast } from '@/components/ui/toast';
import { useReadOnly } from '@/lib/auth/use-auth';
import { useArchiveField, useCreateField, useCustomObjects, useFieldDefinitions, useLabels, useReorderFields, useRestoreField, useUpdateField } from '@/lib/customization';
import { cn } from '@/lib/cn';
import { PackBadge } from '../common/pack-badge';
import { ReorderList, useOptimisticOrder } from '../common/reorder-list';
import { errorMessage, InlineAlert, ListSkeleton, LoadError } from '../common/states';
import { TAP_BUTTON, TAP_ICON } from '../common/touch';
import { useRolesStore } from '../roles-store';
import { FieldEditorDialog } from './field-editor-dialog';
import { draftFromDefinition, specToPatch } from './field-draft';
import { FieldTypeIcon } from './field-type-icon';

const CORE_ICONS: Record<string, string> = { lead: 'Users', contact: 'UserRound', company: 'Building2', deal: 'Briefcase', task: 'ListTodo', call: 'Phone' };

interface TargetTab {
  target: FieldTarget;
  label: string;
  icon: string;
  /** Title field of a custom object (cannot be archived). */
  titleKey?: string;
}

export const fieldsHref = (target: FieldTarget) => `/app/settings/fields?target=${encodeURIComponent(target)}`;

export function FieldsSettings() {
  return (
    <Suspense fallback={<ListSkeleton label="Loading fields" />}>
      <FieldsSettingsInner />
    </Suspense>
  );
}

function FieldsSettingsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const labels = useLabels();
  const objectsQ = useCustomObjects();

  const tabs = useMemo<TargetTab[]>(
    () => [
      ...CORE_ENTITIES.map((e) => ({ target: e as FieldTarget, label: labelOf(labels, e, { plural: true }), icon: CORE_ICONS[e] ?? 'Box' })),
      ...(objectsQ.data ?? []).filter((o) => !o.archivedAt).map((o) => ({ target: objectTarget(o.key), label: o.labelPlural, icon: o.icon, titleKey: o.primaryFieldKey })),
    ],
    [labels, objectsQ.data],
  );
  const requested = params.get('target');
  const current = tabs.find((t) => t.target === requested) ?? tabs[0]!;
  const waitingForObject = !!requested && requested !== current.target && parseTarget(requested).kind === 'object' && objectsQ.isPending;
  const hrefOf = (t: FieldTarget) => `${pathname}?target=${encodeURIComponent(t)}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="sm:hidden">
        <label htmlFor="fields-target" className="mb-1 block text-xs font-medium text-fg-secondary">
          Fields on
        </label>
        <NativeSelect id="fields-target" value={current.target} onChange={(e) => router.replace(hrefOf(e.target.value as FieldTarget), { scroll: false })}>
          <optgroup label="Core records">
            {tabs
              .filter((t) => !t.target.startsWith('object:'))
              .map((t) => (
                <option key={t.target} value={t.target}>
                  {t.label}
                </option>
              ))}
          </optgroup>
          {tabs.some((t) => t.target.startsWith('object:')) && (
            <optgroup label="Custom objects">
              {tabs
                .filter((t) => t.target.startsWith('object:'))
                .map((t) => (
                  <option key={t.target} value={t.target}>
                    {t.label}
                  </option>
                ))}
            </optgroup>
          )}
        </NativeSelect>
      </div>
      <nav aria-label="Fields on" className="hidden border-b border-border sm:block">
        <ul className="-mb-px flex flex-wrap gap-x-1">
          {tabs.map((t) => (
            <li key={t.target}>
              <Link
                href={hrefOf(t.target)}
                replace
                scroll={false}
                aria-current={t.target === current.target ? 'page' : undefined}
                className={cn(
                  'focus-ring flex h-9 items-center gap-1.5 rounded-t-md border-b-2 border-transparent px-2.5 text-sm text-fg-secondary transition-colors hover:text-fg',
                  'aria-[current=page]:border-accent aria-[current=page]:font-medium aria-[current=page]:text-fg',
                )}
              >
                <NavIcon name={t.icon} fallback="Box" className="text-current" />
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {waitingForObject ? <ListSkeleton label="Loading fields" /> : <TargetFields key={current.target} tab={current} />}
    </div>
  );
}

type Editor = { mode: 'create' } | { mode: 'edit'; def: FieldDefinition } | null;

function TargetFields({ tab }: { tab: TargetTab }) {
  const { target, label: name } = tab;
  const q = useFieldDefinitions(target, { includeArchived: true });
  const create = useCreateField();
  const update = useUpdateField();
  const archive = useArchiveField();
  const restore = useRestoreField();
  const reorderFields = useReorderFields();
  const roles = useRolesStore((s) => s.roles);
  const { reason } = useReadOnly();
  const [editor, setEditor] = useState<Editor>(null);
  const [error, setError] = useState<string | null>(null);

  const all = q.data ?? [];
  const active = all.filter((f) => !f.archivedAt).sort((a, b) => a.order - b.order);
  const archived = all.filter((f) => f.archivedAt);
  const { order, reorder } = useOptimisticOrder(
    (ids) => reorderFields.mutateAsync({ target, fieldIds: [...ids, ...archived.map((f) => f.id)] }),
    (e) => setError(`Order not saved. ${errorMessage(e)}`),
  );
  const byId = new Map(active.map((f) => [f.id, f]));
  const shown = order ? order.map((id) => byId.get(id)).filter((f): f is FieldDefinition => !!f) : active;
  const roleName = (key: string) => roles.find((r) => r.key === key)?.name ?? key;

  if (q.isPending) return <ListSkeleton label={`Loading fields on ${name}`} />;
  if (q.isError) return <LoadError title={`Fields on ${name} did not load`} onRetry={() => void q.refetch()} />;

  async function onArchive(f: FieldDefinition) {
    setError(null);
    try {
      await archive.mutateAsync(f.id);
      toast.success(`${f.label} archived`, {
        description: 'Values are kept. Restore it any time.',
        action: { label: 'Undo', onClick: () => restore.mutate(f.id) },
      });
    } catch (e) {
      setError(`${f.label} was not archived. ${errorMessage(e)}`);
    }
  }

  async function onRestore(f: FieldDefinition) {
    setError(null);
    try {
      await restore.mutateAsync(f.id);
      toast.success(`${f.label} restored`);
    } catch (e) {
      setError(`${f.label} was not restored. ${errorMessage(e)}`);
    }
  }

  const accessChips = (f: FieldDefinition) => {
    const chips: string[] = [];
    if (f.access.hiddenFor.length) chips.push(f.access.hiddenFor.length === 1 ? `Hidden for ${roleName(f.access.hiddenFor[0]!)}` : `Hidden for ${f.access.hiddenFor.length} roles`);
    if (f.access.readOnlyFor.length) chips.push(f.access.readOnlyFor.length === 1 ? `Read-only for ${roleName(f.access.readOnlyFor[0]!)}` : `Read-only for ${f.access.readOnlyFor.length} roles`);
    return chips;
  };

  return (
    <section aria-labelledby="fields-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="fields-heading" className="text-sm font-semibold text-fg">
            Fields on {name}
          </h2>
          <p className="text-xs text-muted-strong">
            {active.length === 1 ? '1 field' : `${active.length} fields`} in the order forms and detail panels show them.
          </p>
        </div>
        <Button variant="primary" className={TAP_BUTTON} onClick={() => setEditor({ mode: 'create' })} disabled={!!reason}>
          <Plus aria-hidden />
          Add field
        </Button>
      </div>

      {reason && <InlineAlert tone="info">{reason}</InlineAlert>}
      {error && <InlineAlert onDismiss={() => setError(null)}>{error}</InlineAlert>}

      {shown.length === 0 ? (
        <EmptyState
          icon={<TextCursorInput />}
          title={`No custom fields on ${name} yet`}
          description="Add details your team records, like GST number, quantity or delivery date. They show on forms, detail panels and exports."
          action={
            <Button variant="primary" className={TAP_BUTTON} onClick={() => setEditor({ mode: 'create' })} disabled={!!reason}>
              <Plus aria-hidden />
              Add field
            </Button>
          }
        />
      ) : (
        <ReorderList
          items={shown}
          getId={(f) => f.id}
          getLabel={(f) => f.label}
          onReorder={(ids) => {
            setError(null);
            void reorder(ids);
          }}
          disabled={!!reason}
          label={`Fields on ${name}, in display order`}
          renderItem={(f, c) => (
            <Card className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:flex-nowrap">
              {c.handle}
              <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-3 text-fg-secondary">
                <FieldTypeIcon type={f.type} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate text-sm font-medium text-fg">{f.label}</span>
                  <span className="text-xs text-muted">{FIELD_TYPE_LABELS[f.type]}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <code className="font-mono text-2xs text-muted">{f.key}</code>
                  {tab.titleKey === f.key && <Chip tone="indigo">Title field</Chip>}
                  {f.required && <Chip tone="amber">Required</Chip>}
                  {f.unique && <Chip tone="neutral">Unique</Chip>}
                  {f.packKey && <PackBadge packKey={f.packKey} />}
                  {accessChips(f).map((t) => (
                    <Chip key={t} tone="grey">
                      {t}
                    </Chip>
                  ))}
                </span>
              </div>
              <span className="ml-auto flex shrink-0 items-center">
                {c.moveButtons}
                <Button variant="ghost" size="icon-sm" className={TAP_ICON} aria-label={`Edit ${f.label}`} onClick={() => setEditor({ mode: 'edit', def: f })} disabled={!!reason}>
                  <Pencil aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={TAP_ICON}
                  aria-label={`Archive ${f.label}`}
                  onClick={() => void onArchive(f)}
                  disabled={!!reason || tab.titleKey === f.key}
                  title={tab.titleKey === f.key ? 'The title field cannot be archived. Pick another title field first.' : undefined}
                >
                  <Archive aria-hidden />
                </Button>
              </span>
            </Card>
          )}
        />
      )}

      {archived.length > 0 && (
        <details className="group rounded-lg border border-border bg-surface">
          <summary className="focus-ring flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-medium text-fg-secondary marker:content-none hover:text-fg">
            <Archive aria-hidden className="size-4" />
            Archived fields ({archived.length})
            <span className="ml-auto text-xs font-normal text-muted group-open:hidden">Show</span>
            <span className="ml-auto hidden text-xs font-normal text-muted group-open:inline">Hide</span>
          </summary>
          <div className="border-t border-border px-3 py-2">
            <p className="mb-2 text-xs text-muted">Archived fields keep their values but are hidden from forms. Their keys stay reserved.</p>
            <ul className="divide-y divide-border">
              {archived.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <FieldTypeIcon type={f.type} className="text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{f.label}</span>
                    <code className="font-mono text-2xs text-muted">{f.key}</code>
                  </span>
                  {f.packKey && <PackBadge packKey={f.packKey} />}
                  <Button size="sm" className={TAP_BUTTON} onClick={() => void onRestore(f)} disabled={!!reason} aria-label={`Restore ${f.label}`}>
                    <ArchiveRestore aria-hidden />
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      {editor?.mode === 'create' && (
        <FieldEditorDialog
          mode="create"
          targetName={name}
          submitLabel="Create field"
          readOnlyReason={reason}
          onClose={() => setEditor(null)}
          onSubmit={async (spec) => {
            await create.mutateAsync({ target, field: spec });
            toast.success(`Field ${spec.label} added to ${name}`);
            setEditor(null);
          }}
        />
      )}
      {editor?.mode === 'edit' && (
        <FieldEditorDialog
          key={editor.def.id}
          mode="edit"
          initial={draftFromDefinition(editor.def)}
          packKey={editor.def.packKey}
          targetName={name}
          submitLabel="Save field"
          readOnlyReason={reason}
          onClose={() => setEditor(null)}
          onSubmit={async (spec) => {
            await update.mutateAsync({ id: editor.def.id, patch: specToPatch(spec) });
            toast.success(`Field ${spec.label} saved`);
            setEditor(null);
          }}
        />
      )}
    </section>
  );
}
