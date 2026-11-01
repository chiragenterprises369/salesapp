'use client';

import { DATA_SCOPES, LOCKED_ADMIN_PERMISSIONS, ROLE_KIND_LABELS, type DataScope, type Permission, type Role } from '@vistar/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { useReadOnly } from '@/lib/auth/use-auth';
import { CreateRoleDialog } from './create-role-dialog';
import { PermissionMatrix } from './permission-matrix';
import { SCOPE_LABELS, useRolesStore } from './roles-store';
import { SaveBar, SettingsCard } from './settings-card';

type Draft = { permissions: Permission[]; dataScope: DataScope };

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
const lockedFor = (role: Role): Permission[] => (role.isSystem && role.kind === 'company_admin' ? LOCKED_ADMIN_PERMISSIONS : []);

/**
 * Roles list + editor (mock local state until /roles). Edits are kept per role while you switch
 * between roles; each role saves on its own.
 */
export function RolesEditor() {
  const roles = useRolesStore((s) => s.roles);
  const saveRole = useRolesStore((s) => s.saveRole);
  const deleteRole = useRolesStore((s) => s.deleteRole);
  const { reason } = useReadOnly();
  const [selectedId, setSelectedId] = useState(roles[0]!.id);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const role = roles.find((r) => r.id === selectedId) ?? roles[0]!;
  const draft = drafts[role.id] ?? { permissions: role.permissions, dataScope: role.dataScope };
  const isDirty = (r: Role) => {
    const d = drafts[r.id];
    return !!d && (!sameSet(d.permissions, r.permissions) || d.dataScope !== r.dataScope);
  };
  const dirty = isDirty(role);
  const locked = lockedFor(role);

  const setDraft = (patch: Partial<Draft>) => setDrafts((all) => ({ ...all, [role.id]: { ...draft, ...patch } }));
  const discard = () =>
    setDrafts((all) => {
      const next = { ...all };
      delete next[role.id];
      return next;
    });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const permissions = [...new Set([...draft.permissions, ...locked])];
    await saveRole(role.id, { permissions, dataScope: draft.dataScope });
    setSaving(false);
    discard();
    toast.success(`${role.name} role saved`);
  }

  async function onDelete() {
    const name = role.name;
    await deleteRole(role.id);
    setConfirmDelete(false);
    setSelectedId(roles[0]!.id);
    toast.success(`${name} role deleted`);
  }

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="roles-list-heading">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id="roles-list-heading" className="text-sm font-semibold text-fg">
            Roles
          </h2>
          <Button size="sm" onClick={() => setCreating(true)} disabled={!!reason}>
            <Plus aria-hidden />
            Create role
          </Button>
        </div>
        <div className="md:hidden">
          <label htmlFor="role-picker" className="sr-only">
            Role to edit
          </label>
          <NativeSelect id="role-picker" value={role.id} onChange={(e) => setSelectedId(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {isDirty(r) ? ' (unsaved)' : ''}
              </option>
            ))}
          </NativeSelect>
        </div>
        <ul className="hidden gap-2 md:grid md:grid-cols-2 xl:grid-cols-4" aria-label="Roles">
          {roles.map((r) => {
            const active = r.id === role.id;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'focus-ring flex h-full w-full flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors',
                    active ? 'border-accent bg-accent-soft' : 'border-border bg-surface hover:bg-surface-2',
                  )}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className={cn('flex-1 truncate text-sm font-medium', active ? 'text-accent-soft-fg' : 'text-fg')}>{r.name}</span>
                    {isDirty(r) && (
                      <span className="size-2 rounded-full bg-accent" aria-label="Unsaved changes" role="img" />
                    )}
                    {r.isSystem && <Chip>System</Chip>}
                  </span>
                  <span className={cn('text-xs', active ? 'text-muted-strong' : 'text-muted')}>
                    {ROLE_KIND_LABELS[r.kind]} · {SCOPE_LABELS[r.dataScope].label} · {r.memberCount} {r.memberCount === 1 ? 'person' : 'people'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <form onSubmit={onSubmit} noValidate className="min-w-0">
        <SettingsCard
          title={`${role.name}${role.isSystem ? '' : ' (custom)'}`}
          description={`${ROLE_KIND_LABELS[role.kind]} kind. ${role.memberCount} ${role.memberCount === 1 ? 'person has' : 'people have'} this role. ${draft.permissions.length} permissions on.`}
          footer={
            <>
              {!role.isSystem && (
                <Button
                  variant="ghost"
                  className="text-danger-text"
                  disabled={role.memberCount > 0 || !!reason}
                  title={role.memberCount > 0 ? 'Move people to another role first' : undefined}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 aria-hidden />
                  Delete role
                </Button>
              )}
              <SaveBar dirty={dirty} saving={saving} readOnlyReason={reason} onDiscard={discard} />
            </>
          }
        >
          <div className="mb-4 max-w-sm">
            <FormField label="Can see" hint={SCOPE_LABELS[draft.dataScope].sentence}>
              <NativeSelect value={draft.dataScope} disabled={!!reason} onChange={(e) => setDraft({ dataScope: e.target.value as DataScope })}>
                {DATA_SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {SCOPE_LABELS[s].label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </div>
          <PermissionMatrix
            roleName={role.name}
            value={draft.permissions}
            locked={locked}
            disabled={!!reason}
            onChange={(permissions) => setDraft({ permissions })}
          />
        </SettingsCard>
      </form>

      <CreateRoleDialog open={creating} onOpenChange={setCreating} onCreated={(r) => setSelectedId(r.id)} />
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete the {role.name} role?</DialogTitle>
            <DialogDescription>Nobody has this role, so no one loses access. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Keep role</Button>
            </DialogClose>
            <Button variant="danger" onClick={onDelete}>
              Delete role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
