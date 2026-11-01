'use client';

import {
  DATA_SCOPES,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_ROLE_SCOPE,
  ROLE_KIND_LABELS,
  ROLE_KINDS,
  RoleCreateSchema,
  type DataScope,
  type Role,
  type RoleKind,
} from '@vistar/shared';
import { useState, type FormEvent } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { SCOPE_LABELS, useRolesStore } from './roles-store';

const KIND_HINT: Record<RoleKind, string> = {
  company_admin: 'Company panel with full access',
  manager: 'Company panel, plus My workspace for their own leads',
  employee: 'Mobile-first employee panel',
  viewer: 'Company panel, read-only reports',
};

/** Create a custom role (RoleCreateSchema). Starts from the chosen kind's default permissions. */
export function CreateRoleDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (role: Role) => void }) {
  const createRole = useRolesStore((s) => s.createRole);
  const roles = useRolesStore((s) => s.roles);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<RoleKind>('employee');
  const [scope, setScope] = useState<DataScope>(DEFAULT_ROLE_SCOPE.employee);
  const [scopeTouched, setScopeTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName('');
    setKind('employee');
    setScope(DEFAULT_ROLE_SCOPE.employee);
    setScopeTouched(false);
    setError(null);
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = RoleCreateSchema.safeParse({ name, kind, dataScope: scope, permissions: DEFAULT_ROLE_PERMISSIONS[kind] });
    if (!parsed.success) {
      setError('Enter a role name, up to 60 characters');
      return;
    }
    if (roles.some((r) => r.name.toLowerCase() === parsed.data.name.toLowerCase())) {
      setError('A role with this name already exists');
      return;
    }
    setSaving(true);
    const role = await createRole(parsed.data);
    setSaving(false);
    toast.success(`${role.name} role created`, { description: 'Adjust its permissions, then save.' });
    reset();
    onOpenChange(false);
    onCreated(role);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="contents">
          <DialogHeader>
            <DialogTitle>Create role</DialogTitle>
            <DialogDescription>Give a group of people the access they need, for example Field sales or Telecallers.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <FormField label="Role name" error={error ?? undefined} required>
              <Input value={name} maxLength={60} autoFocus placeholder="Field sales" onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label="Kind" hint={KIND_HINT[kind]}>
              <NativeSelect
                value={kind}
                onChange={(e) => {
                  const k = e.target.value as RoleKind;
                  setKind(k);
                  if (!scopeTouched) setScope(DEFAULT_ROLE_SCOPE[k]);
                }}
              >
                {ROLE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {ROLE_KIND_LABELS[k]}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Can see" hint={SCOPE_LABELS[scope].sentence}>
              <NativeSelect
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value as DataScope);
                  setScopeTouched(true);
                }}
              >
                {DATA_SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {SCOPE_LABELS[s].label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <p className="text-xs text-muted">
              Starts with the {DEFAULT_ROLE_PERMISSIONS[kind].length} default permissions of the {ROLE_KIND_LABELS[kind]} role. You can change them after creating it.
            </p>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="primary" loading={saving}>
              Create role
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
