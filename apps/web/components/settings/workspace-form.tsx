'use client';

import { WorkspaceUpdateSchema, type Workspace } from '@vistar/shared';
import { useMemo, useState, type FormEvent } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Switch } from '@/components/common/switch';
import { allTimeZones } from '@/components/common/timezones';
import { FormField, Input, Label } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useReadOnly } from '@/lib/auth/use-auth';
import { useMe, useSessionActions } from '@/lib/session/session';
import { SaveBar, SettingsCard } from './settings-card';

type Values = Pick<Workspace, 'name' | 'timezone' | 'showEmployeeRank'>;
const pick = (w: Workspace): Values => ({ name: w.name, timezone: w.timezone, showEmployeeRank: w.showEmployeeRank });
const same = (a: Values, b: Values) => a.name === b.name && a.timezone === b.timezone && a.showEmployeeRank === b.showEmployeeRank;

/** Workspace name, timezone and leaderboard visibility (PATCH /workspace). */
export function WorkspaceForm() {
  const me = useMe()!;
  const { updateWorkspace } = useSessionActions();
  const { reason } = useReadOnly();
  const saved = pick(me.workspace);
  const [values, setValues] = useState<Values>(saved);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const zones = useMemo(() => allTimeZones(values.timezone), [values.timezone]);
  const dirty = !same(values, saved);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const name = values.name.trim();
    if (name.length < 2 || name.length > 80) {
      setError('Use 2 to 80 characters');
      return;
    }
    const parsed = WorkspaceUpdateSchema.safeParse({ ...values, name });
    if (!parsed.success) {
      setError('Check the highlighted fields');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await updateWorkspace(parsed.data);
      setValues((v) => ({ ...v, name }));
      toast.success('Workspace settings saved');
    } catch {
      toast.error('Settings not saved. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <SettingsCard
        title="Company details"
        description="Shown to your team and on messages that use the workspace name."
        footer={<SaveBar dirty={dirty} saving={saving} readOnlyReason={reason} onDiscard={() => setValues(saved)} />}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Company name" error={error ?? undefined} required>
            <Input value={values.name} maxLength={80} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} />
          </FormField>
          <FormField label="Timezone" hint="Business hours, reports and scheduled themes use this timezone">
            <NativeSelect value={values.timezone} onChange={(e) => setValues((v) => ({ ...v, timezone: e.target.value }))}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replaceAll('_', ' ')}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-secondary">Currency</span>
            <span className="text-sm text-fg">Indian rupee (INR)</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-secondary">Workspace address</span>
            <span className="font-mono text-sm text-fg">{me.workspace.slug}</span>
          </div>
        </div>
        <div className="mt-5 flex items-start justify-between gap-4 border-t border-border pt-4">
          <div>
            <Label htmlFor="show-rank" className="text-sm font-medium text-fg">
              Show rank to employees
            </Label>
            <p id="show-rank-hint" className="text-xs text-muted">
              Employees see their leaderboard position on My performance. Managers always see rankings.
            </p>
          </div>
          <Switch
            id="show-rank"
            aria-describedby="show-rank-hint"
            checked={values.showEmployeeRank}
            onCheckedChange={(checked) => setValues((v) => ({ ...v, showEmployeeRank: checked }))}
          />
        </div>
      </SettingsCard>
    </form>
  );
}
