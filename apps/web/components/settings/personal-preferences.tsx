'use client';

import { NOTIFICATION_TYPES, resolveCelebrations, type CelebrationIntensity, type NotificationType, type TeamFloorMode, type UserSettings, type UserSettingsUpdate } from '@vistar/shared';
import { Check } from 'lucide-react';
import { RadioGroup } from 'radix-ui';
import { useState } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Switch } from '@/components/common/switch';
import { ScheduleFields, ThemeModeRadio } from '@/components/common/theme-mode-picker';
import { FormField, Label } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useCelebrationSetting } from '@/features/pipeline/celebrations/settings';
import { cn } from '@/lib/cn';
import { useReadOnly } from '@/lib/auth/use-auth';
import { useCan, useMe, useSessionActions } from '@/lib/session/session';
import { useReducedMotionSetting, useTheme, type ReducedMotionSetting } from '@/lib/theme';
import { InterfacePreferences } from './interface-preferences';
import { SettingsCard } from './settings-card';

const NOTIFY_LABEL: Record<NotificationType, string> = {
  lead_assigned: 'A lead is assigned to me',
  message_received: 'A lead replies on WhatsApp',
  task_due: 'A task is due',
  task_overdue: 'A task is overdue',
  workflow_failed: 'A workflow step fails',
  mention: 'Someone mentions me in a note',
  import_completed: 'A lead import finishes',
  system: 'Vistar product updates',
  meeting_reminder: 'A meeting is about to start',
  // change #19 wave C: billing
  billing_trial_ending: 'The Vistar trial is about to end',
  billing_payment_failed: 'A Vistar payment fails or is overdue',
  billing_invoice_issued: 'Vistar sends a new invoice',
};

const MOTION: ReadonlyArray<{ value: ReducedMotionSetting; label: string; hint: string }> = [
  { value: 'system', label: 'Follow this device', hint: 'Uses your phone or computer setting' },
  { value: 'on', label: 'Always reduce', hint: 'Changes happen instantly, no animation' },
  { value: 'off', label: 'Never reduce', hint: 'Ignore the device setting and use your motion intensity' },
];

const FLOOR: ReadonlyArray<{ value: TeamFloorMode; label: string }> = [
  { value: 'auto', label: 'Automatic (3D on capable computers, flat on phones)' },
  { value: '3d', label: '3D office' },
  { value: 'flat', label: 'Flat list' },
];

const CELEBRATIONS: ReadonlyArray<{ value: CelebrationIntensity; label: string; hint: string }> = [
  { value: 'full', label: 'Full', hint: 'Light ribbons, a quote envelope, a short burst on Won' },
  { value: 'subtle', label: 'Subtle', hint: 'Smaller, quieter effects' },
  { value: 'off', label: 'Off', hint: 'A simple highlight that fades' },
];

function useSaved() {
  const { updateSettings } = useSessionActions();
  const [status, setStatus] = useState<string | null>(null);
  const save = async (patch: UserSettingsUpdate) => {
    setStatus('Saving…');
    try {
      await updateSettings(patch);
      setStatus('Saved');
    } catch {
      setStatus(null);
      toast.error('Preference not saved. Check your connection and try again.');
    }
  };
  return { status, save };
}

function Saved({ status }: { status: string | null }) {
  return (
    <p className="text-xs text-muted-strong" aria-live="polite">
      {status === 'Saved' ? (
        <span className="inline-flex items-center gap-1">
          <Check aria-hidden className="size-3.5 text-success-text" />
          Saved
        </span>
      ) : (
        status
      )}
    </p>
  );
}

/**
 * Personal preferences, saved as you change them (updateSettings / PATCH /me/settings): theme with
 * scheduled hours, interface style and motion intensity (SPEC 28.2), reduced motion, notifications and
 * Team Floor view. `touch` = 44px controls.
 */
export function PersonalPreferences({ touch = false }: { touch?: boolean }) {
  const me = useMe()!;
  const { reason } = useReadOnly();
  const { preference, timeZone, setPreference } = useTheme();
  const { reducedMotion, setReducedMotion } = useReducedMotionSetting();
  const canSeeWorkflows = useCan('workflows.read');
  const canSeeFloor = useCan('teamfloor.read');
  const notifySaved = useSaved();
  const floorSaved = useSaved();
  const [notifications, setNotifications] = useState<UserSettings['notifications']>(me.settings.notifications);
  const [floor, setFloor] = useState<TeamFloorMode>(me.settings.teamFloorMode);
  const selectSize = touch ? 'touch' : 'md';
  const types = NOTIFICATION_TYPES.filter((t) => t !== 'workflow_failed' || canSeeWorkflows);

  const patchNotifications = (patch: Partial<UserSettings['notifications']>) => {
    const next = { ...notifications, ...patch };
    setNotifications(next);
    void notifySaved.save({ notifications: patch });
  };

  return (
    // Two columns of cards on wide screens (D-066).
    <div className="grid items-start gap-4 2xl:grid-cols-2">
      <SettingsCard title="Theme" description="Applies on every device you sign in on.">
        <ThemeModeRadio variant="cards" label="Theme" value={preference.mode} onValueChange={(mode) => void setPreference({ mode })} />
        {preference.mode === 'scheduled' && (
          <div className="mt-4 max-w-md">
            <ScheduleFields darkFrom={preference.darkFrom} darkTo={preference.darkTo} timeZone={timeZone} size={selectSize} onChange={(p) => void setPreference(p)} />
          </div>
        )}
      </SettingsCard>

      <InterfacePreferences touch={touch} />

      <SettingsCard title="Reduce motion" description="Accessibility: stop animations on the Board, dashboard counters and the Team Floor.">
        <RadioGroup.Root value={reducedMotion} onValueChange={(v) => void setReducedMotion(v as ReducedMotionSetting)} aria-label="Reduce motion" className="flex flex-col gap-2">
          {MOTION.map((m) => (
            <RadioGroup.Item
              key={m.value}
              value={m.value}
              className={cn(
                'focus-ring group flex min-h-11 items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left',
                'hover:bg-surface-2 data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft',
              )}
            >
              <span aria-hidden className="flex size-4 shrink-0 items-center justify-center rounded-full border border-input group-data-[state=checked]:border-accent">
                <RadioGroup.Indicator className="size-2 rounded-full bg-accent" />
              </span>
              <span>
                <span className="block text-sm font-medium text-fg group-data-[state=checked]:text-accent-soft-fg">{m.label}</span>
                <span className="block text-xs text-muted group-data-[state=checked]:text-muted-strong">{m.hint}</span>
              </span>
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
      </SettingsCard>

      <LeadsBoardCard />

      <SettingsCard title="Notifications" description="Choose how and when Vistar tells you about your work." footer={<Saved status={notifySaved.status} />}>
        <div className="flex flex-col gap-4">
          {(
            [
              ['inApp', 'In the app', 'The bell in the top bar and pop-up alerts'],
              ['push', 'Push notifications', 'On your phone, when the Vistar app is installed'],
            ] as const
          ).map(([key, label, hint]) => (
            <div key={key} className={cn('flex items-center justify-between gap-4', touch && 'min-h-11')}>
              <div>
                <Label htmlFor={`notify-${key}`} className="text-sm font-medium text-fg">
                  {label}
                </Label>
                <p className="text-xs text-muted">{hint}</p>
              </div>
              <Switch id={`notify-${key}`} checked={notifications[key]} disabled={!!reason} onCheckedChange={(v) => patchNotifications({ [key]: v })} />
            </div>
          ))}
          <div className="max-w-xs">
            <FormField label="Email summary">
              <NativeSelect
                size={selectSize}
                value={notifications.emailDigest}
                disabled={!!reason}
                onChange={(e) => patchNotifications({ emailDigest: e.target.value as UserSettings['notifications']['emailDigest'] })}
              >
                <option value="daily">Every morning</option>
                <option value="weekly">Every Monday</option>
                <option value="off">Off</option>
              </NativeSelect>
            </FormField>
          </div>
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-fg-secondary">Notify me when</legend>
            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {types.map((t) => (
                <label key={t} className={cn('flex cursor-pointer items-center gap-2.5 text-sm text-fg', touch ? 'min-h-11' : 'min-h-8')}>
                  <input
                    type="checkbox"
                    className={cn('accent-accent', touch ? 'size-5' : 'size-4')}
                    checked={!notifications.muted.includes(t)}
                    disabled={!!reason}
                    onChange={(e) =>
                      patchNotifications({ muted: e.target.checked ? notifications.muted.filter((m) => m !== t) : [...notifications.muted, t] })
                    }
                  />
                  {NOTIFY_LABEL[t]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </SettingsCard>

      {canSeeFloor && (
        <SettingsCard title="Team Floor view" description="The 3D office needs a recent computer; the flat list works everywhere." footer={<Saved status={floorSaved.status} />}>
          <div className="max-w-md">
            <FormField label="Show the Team Floor as">
              <NativeSelect
                size={selectSize}
                value={floor}
                onChange={(e) => {
                  const v = e.target.value as TeamFloorMode;
                  setFloor(v);
                  void floorSaved.save({ teamFloorMode: v });
                }}
              >
                {FLOOR.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </div>
        </SettingsCard>
      )}
    </div>
  );
}

/**
 * Leads Board celebrations (SPEC 28.1, `leads.celebrations`). Until the user picks one, the choice
 * follows motion intensity (Full -> Full, Reduced -> Subtle, Off -> Off); reduced motion turns
 * every effect into a simple fade whatever is chosen here.
 */
function LeadsBoardCard() {
  const { reason } = useReadOnly();
  const { setting, motion, reduced } = useCelebrationSetting();
  const saved = useSaved();
  const [choice, setChoice] = useState<CelebrationIntensity | null>(setting);
  // Not chosen yet: show what the motion intensity gives (reduced motion aside, explained below).
  const shown = choice ?? resolveCelebrations(null, reduced ? 'full' : motion);

  return (
    <SettingsCard title="Leads Board" description="Small animations when leads arrive, move, get a quote, are won or lost." footer={<Saved status={saved.status} />}>
      <RadioGroup.Root
        value={shown}
        disabled={!!reason}
        onValueChange={(v) => {
          const next = v as CelebrationIntensity;
          setChoice(next);
          void saved.save({ celebrations: next });
        }}
        aria-label="Board celebrations"
        className="grid gap-2 sm:grid-cols-3"
      >
        {CELEBRATIONS.map((c) => (
          <RadioGroup.Item
            key={c.value}
            value={c.value}
            className={cn(
              'focus-ring group flex min-h-11 items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left',
              'hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60 data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft',
            )}
          >
            <span aria-hidden className="flex size-4 shrink-0 items-center justify-center rounded-full border border-input group-data-[state=checked]:border-accent">
              <RadioGroup.Indicator className="size-2 rounded-full bg-accent" />
            </span>
            <span>
              <span className="block text-sm font-medium text-fg group-data-[state=checked]:text-accent-soft-fg">{c.label}</span>
              <span className="block text-xs text-muted group-data-[state=checked]:text-muted-strong">{c.hint}</span>
            </span>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      {reduced ? (
        <p className="mt-3 text-xs text-muted-strong" data-celebrations-note="reduced-motion">
          Reduce motion is on, so the Board shows a simple fade instead of these animations.
        </p>
      ) : choice === null ? (
        <p className="mt-3 text-xs text-muted-strong">Follows your motion intensity until you choose.</p>
      ) : null}
    </SettingsCard>
  );
}
