'use client';

import { SupportAccessUpdateSchema, type SupportAccess } from '@vistar/shared';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { create } from 'zustand';
import { NativeSelect } from '@/components/common/native-select';
import { Switch } from '@/components/common/switch';
import { formatDateTimeIn } from '@/components/common/time';
import { useNow } from '@/components/common/use-now';
import { Chip } from '@/components/ui/chip';
import { FormField, Label } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useReadOnly } from '@/lib/auth/use-auth';
import { useMe } from '@/lib/session/session';
import { SaveBar, SettingsCard } from './settings-card';

const DURATIONS = [
  { hours: 1, label: '1 hour' },
  { hours: 4, label: '4 hours' },
  { hours: 24, label: '24 hours' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '7 days' },
] as const;

/** Wave 1 mock of PUT /workspace/support-access (kept for this tab). */
const useSupportAccessStore = create<{ value: SupportAccess | null; set: (v: SupportAccess) => void }>()((set) => ({
  value: null,
  set: (value) => set({ value }),
}));

/** Company-controlled access for Vistar support ("View as company"), with expiry and content option. */
export function SupportAccessForm() {
  const me = useMe()!;
  const { reason } = useReadOnly();
  const stored = useSupportAccessStore((s) => s.value);
  const store = useSupportAccessStore((s) => s.set);
  const current = stored ?? me.workspace.supportAccess;
  const now = useNow(30_000);
  const active = !!current.until && now > 0 && Date.parse(current.until) > now;

  const [enabled, setEnabled] = useState(active);
  const [hours, setHours] = useState(24);
  const [hoursTouched, setHoursTouched] = useState(false);
  const [includeContent, setIncludeContent] = useState(current.includeContent);
  const [saving, setSaving] = useState(false);
  const dirty = !enabled ? active : !active || includeContent !== current.includeContent || hoursTouched;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = SupportAccessUpdateSchema.safeParse({ enabled, durationHours: hours, includeContent });
    if (!parsed.success) return;
    setSaving(true);
    await new Promise((r) => setTimeout(r, 300));
    const until = parsed.data.enabled ? new Date(Date.now() + parsed.data.durationHours * 3_600_000).toISOString() : null;
    store({ until, includeContent: parsed.data.enabled && parsed.data.includeContent });
    setSaving(false);
    setHoursTouched(false);
    toast.success(until ? `Support access on until ${formatDateTimeIn(until, me.workspace.timezone)}` : 'Support access turned off');
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid items-start gap-4 2xl:grid-cols-2">
      <SettingsCard title="Current status" description="Sessions are read-only by default. Each one is recorded in your audit log with the support agent's reason.">
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-surface-3 text-fg-secondary">
            {active ? <ShieldCheck className="size-4" /> : <ShieldOff className="size-4" />}
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
              {active ? 'Vistar support can view your workspace' : 'Vistar support cannot view your workspace'}
              <Chip tone={active ? 'green' : 'grey'} dot>
                {active ? 'On' : 'Off'}
              </Chip>
            </p>
            <p className="text-xs text-muted">
              {active
                ? `Until ${formatDateTimeIn(current.until!, me.workspace.timezone)}. ${current.includeContent ? 'Message content and recordings are visible.' : 'Message content and recordings stay hidden.'}`
                : 'Turn it on when you ask support for help. It switches off by itself when the time is up.'}
            </p>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Allow support access"
        footer={
          <SaveBar
            dirty={dirty}
            saving={saving}
            readOnlyReason={reason}
            label={enabled ? (active ? 'Update access' : 'Turn on access') : active ? 'Turn off access' : 'Save changes'}
            onDiscard={() => {
              setEnabled(active);
              setIncludeContent(current.includeContent);
              setHoursTouched(false);
            }}
          />
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="support-enabled" className="text-sm font-medium text-fg">
                Let Vistar support view this workspace
              </Label>
              <p id="support-enabled-hint" className="text-xs text-muted">
                Support sees what a company admin sees, without changing anything.
              </p>
            </div>
            <Switch id="support-enabled" aria-describedby="support-enabled-hint" checked={enabled} disabled={!!reason} onCheckedChange={setEnabled} />
          </div>
          {enabled && (
            <>
              <div className="max-w-xs">
                <FormField label={active ? 'Extend for' : 'For how long'} hint="Counted from when you save">
                  <NativeSelect
                    value={hours}
                    disabled={!!reason}
                    onChange={(e) => {
                      setHours(Number(e.target.value));
                      setHoursTouched(true);
                    }}
                  >
                    {DURATIONS.map((d) => (
                      <option key={d.hours} value={d.hours}>
                        {d.label}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              </div>
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-accent"
                  checked={includeContent}
                  disabled={!!reason}
                  onChange={(e) => setIncludeContent(e.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium text-fg">Include message content and call recordings</span>
                  <span className="block text-xs text-muted">Leave off unless support needs to read a chat or hear a call to fix your issue.</span>
                </span>
              </label>
            </>
          )}
        </div>
      </SettingsCard>
    </form>
  );
}
