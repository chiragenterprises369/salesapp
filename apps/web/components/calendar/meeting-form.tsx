'use client';

import { MEETING_MODES, RECURRENCE_FREQUENCIES, WEEKDAYS, type Meeting, type MeetingMode, type RecurrenceFrequency, type Weekday } from '@vistar/shared';
import { Plus, X } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Checkbox } from '@/components/leads/primitives/checkbox';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useScopedUserList } from '@/lib/api/directory';
import { useMeetingMutations } from '@/lib/crm/calendar';
import { MEETING_MODE } from '@/lib/crm/format';
import { dayKeyIn, hhmmIn, hhmmToMinutes, instantAt } from '@/lib/crm/tz';
import { formErrorMessage, focusFirstInvalid, serverFieldErrors } from '@/lib/crm/ui/errors';
import { FormGrid, FormSection } from '@/lib/crm/ui/fields';
import { AccountPicker, ContactPicker, DealPicker, LeadPicker } from '@/lib/crm/ui/pickers';
import type { PickerOption } from '@/lib/crm/ui/record-picker';
import { CrmFormSheet } from '@/lib/crm/ui/record-form';
import { useMe } from '@/lib/session/session';

const REMINDER_OPTIONS = [
  { value: 10, label: '10 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
];

const WEEKDAY_LABEL: Record<Weekday, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

export interface MeetingSeed {
  startAt?: string;
  lead?: PickerOption | null;
  contact?: PickerOption | null;
  account?: PickerOption | null;
  deal?: PickerOption | null;
  title?: string;
}

interface Draft {
  title: string;
  date: string;
  start: string;
  end: string;
  allDay: boolean;
  mode: MeetingMode;
  location: string;
  videoUrl: string;
  description: string;
  userIds: string[];
  contacts: PickerOption[];
  guests: Array<{ name: string; email: string }>;
  lead: PickerOption | null;
  contact: PickerOption | null;
  account: PickerOption | null;
  deal: PickerOption | null;
  reminders: number[];
  freq: RecurrenceFrequency | 'none';
  interval: string;
  byWeekday: Weekday[];
  endKind: 'never' | 'count' | 'until';
  count: string;
  until: string;
}

function toDraft(m: Meeting | undefined, seed: MeetingSeed, tz: string): Draft {
  const start = m?.startAt ?? seed.startAt ?? null;
  const end = m?.endAt ?? (start ? new Date(new Date(start).getTime() + 30 * 60_000).toISOString() : null);
  const r = m?.recurrence;
  return {
    title: m?.title ?? seed.title ?? '',
    date: start ? dayKeyIn(start, tz) : '',
    start: start ? hhmmIn(start, tz) : '11:00',
    end: end ? hhmmIn(end, tz) : '11:30',
    allDay: m?.allDay ?? false,
    mode: m?.mode ?? 'in_person',
    location: m?.location ?? '',
    videoUrl: m?.videoUrl ?? '',
    description: m?.description ?? '',
    userIds: m ? m.attendees.filter((a) => a.userId && !a.isOrganizer).map((a) => a.userId!) : [],
    contacts: m ? m.attendees.filter((a) => a.contactId).map((a) => ({ id: a.contactId!, label: a.name })) : seed.contact ? [seed.contact] : [],
    guests: m ? m.attendees.filter((a) => !a.userId && !a.contactId).map((a) => ({ name: a.name, email: a.email ?? '' })) : [],
    lead: m?.lead ? { id: m.lead.id, label: m.lead.name } : (seed.lead ?? null),
    contact: m?.contact ? { id: m.contact.id, label: m.contact.name } : (seed.contact ?? null),
    account: m?.account ? { id: m.account.id, label: m.account.name } : (seed.account ?? null),
    deal: m?.deal ? { id: m.deal.id, label: m.deal.title } : (seed.deal ?? null),
    reminders: m?.reminders ?? [15],
    freq: r?.freq ?? 'none',
    interval: String(r?.interval ?? 1),
    byWeekday: r?.byWeekday ?? [],
    endKind: r?.count ? 'count' : r?.until ? 'until' : 'never',
    count: r?.count ? String(r.count) : '10',
    until: r?.until ?? '',
  };
}

/**
 * Create or edit a meeting: time in the workspace zone, mode with place or video link, team, contact
 * and guest attendees, links to a lead, contact, account and deal, reminders and a simple recurrence.
 * Editing one occurrence of a series asks the caller for `scope`.
 */
export function MeetingFormSheet({ meeting, seed = {}, scope, onClose, onSaved }: { meeting?: Meeting; seed?: MeetingSeed; scope?: 'series' | 'occurrence'; onClose: () => void; onSaved?: (m: Meeting) => void }) {
  const formId = useId().replace(/:/g, '');
  const me = useMe();
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';
  const users = useScopedUserList();
  const m = useMeetingMutations();
  const [draft, setDraft] = useState<Draft>(() => toDraft(meeting, seed, tz));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setFormError(null);
  };
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!draft.title.trim()) errs.title = 'Enter a title, for example "Site visit with Mehta Traders".';
    if (!draft.date) errs.date = 'Pick a date.';
    const startMin = hhmmToMinutes(draft.start);
    const endMin = hhmmToMinutes(draft.end);
    if (!draft.allDay && endMin <= startMin) errs.endAt = 'The end must be after the start.';
    if (draft.mode === 'video' && draft.videoUrl.trim() && !/^https?:\/\/\S+\.\S+/.test(draft.videoUrl.trim())) errs.videoUrl = 'Enter a link that starts with https://';
    if (draft.freq !== 'none') {
      if (!/^\d+$/.test(draft.interval) || Number(draft.interval) < 1 || Number(draft.interval) > 30) errs.interval = 'Repeat every 1 to 30.';
      if (draft.endKind === 'count' && (!/^\d+$/.test(draft.count) || Number(draft.count) < 1 || Number(draft.count) > 366)) errs.count = 'Enter 1 to 366 occurrences.';
      if (draft.endKind === 'until' && (!draft.until || draft.until < draft.date)) errs.until = 'The end date must be on or after the first date.';
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError(Object.keys(errs).length === 1 ? 'Fix the highlighted field to save.' : `Fix the ${Object.keys(errs).length} highlighted fields to save.`);
      focusFirstInvalid(formId);
      return;
    }
    const startAt = draft.allDay ? instantAt(draft.date, 0, tz) : instantAt(draft.date, startMin, tz);
    const endAt = draft.allDay ? instantAt(draft.date, 24 * 60, tz) : instantAt(draft.date, endMin, tz);
    const recurrence =
      draft.freq === 'none'
        ? null
        : {
            freq: draft.freq,
            interval: Number(draft.interval),
            ...(draft.freq === 'weekly' && draft.byWeekday.length ? { byWeekday: draft.byWeekday } : {}),
            ...(draft.endKind === 'count' ? { count: Number(draft.count) } : {}),
            ...(draft.endKind === 'until' ? { until: draft.until } : {}),
          };
    const body = {
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      mode: draft.mode,
      location: draft.mode === 'in_person' ? draft.location.trim() || null : null,
      videoUrl: draft.mode === 'video' ? draft.videoUrl.trim() || null : null,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      allDay: draft.allDay,
      timezone: tz,
      attendeeUserIds: draft.userIds,
      attendeeContactIds: draft.contacts.map((c) => c.id),
      guests: draft.guests.map((g) => ({ name: g.name, email: g.email || null })),
      leadId: draft.lead?.id ?? null,
      contactId: draft.contact?.id ?? null,
      accountId: draft.account?.id ?? null,
      dealId: draft.deal?.id ?? null,
      reminders: draft.reminders,
    };
    try {
      const saved = meeting
        ? await m.update.mutateAsync({
            id: meeting.id,
            patch: {
              ...body,
              ...(scope !== 'occurrence' ? { recurrence } : {}),
              expectedVersion: meeting.version,
              ...(scope === 'occurrence' && meeting.occurrenceStart ? { scope: 'occurrence' as const, occurrenceStart: meeting.occurrenceStart } : {}),
            },
          })
        : await m.create.mutateAsync({ ...body, recurrence });
      toast.success(meeting ? 'Meeting saved' : `Meeting "${saved.title}" scheduled`);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setErrors(serverFieldErrors(err));
      setFormError(formErrorMessage(err));
      focusFirstInvalid(formId);
    }
  };

  const others = users.filter((u) => u.id !== me?.user.id);

  return (
    <CrmFormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={meeting ? `Edit ${meeting.title}` : 'New meeting'}
      description={`Times are in ${tz}.${scope === 'occurrence' ? ' Changes apply to this occurrence only.' : ''}`}
      formId={formId}
      submitLabel={meeting ? 'Save meeting' : 'Schedule meeting'}
      submitting={m.create.isPending || m.update.isPending}
    >
      <form id={formId} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-6">
        {formError && (
          <p role="alert" className="rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-sm text-status-red-fg">
            {formError}
          </p>
        )}
        <FormSection title="When">
          <FormGrid>
            <FormField label="Title" required error={errors.title} className="sm:col-span-2">
              <Input autoFocus value={draft.title} maxLength={160} onChange={(e) => set({ title: e.target.value })} />
            </FormField>
            <FormField label="Date" required error={errors.date}>
              <Input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} />
            </FormField>
            <div className="flex items-center gap-2 self-end pb-1.5">
              <Checkbox id={`${formId}-allday`} checked={draft.allDay} onCheckedChange={(v) => set({ allDay: v === true })} />
              <label htmlFor={`${formId}-allday`} className="text-sm text-fg">
                All day
              </label>
            </div>
            {!draft.allDay && (
              <>
                <FormField label="Starts">
                  <Input type="time" step={900} value={draft.start} onChange={(e) => set({ start: e.target.value })} />
                </FormField>
                <FormField label="Ends" error={errors.endAt}>
                  <Input type="time" step={900} value={draft.end} onChange={(e) => set({ end: e.target.value })} />
                </FormField>
              </>
            )}
          </FormGrid>
        </FormSection>
        <FormSection title="Where">
          <FormGrid>
            <FormField label="Type">
              <NativeSelect value={draft.mode} onChange={(e) => set({ mode: e.target.value as MeetingMode })}>
                {MEETING_MODES.map((md) => (
                  <option key={md} value={md}>
                    {MEETING_MODE[md]}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            {draft.mode === 'in_person' && (
              <FormField label="Place" hint="Office, site address or landmark">
                <Input value={draft.location} maxLength={300} onChange={(e) => set({ location: e.target.value })} />
              </FormField>
            )}
            {draft.mode === 'video' && (
              <FormField label="Video link" error={errors.videoUrl} hint="Google Meet, Zoom or Teams link">
                <Input type="url" inputMode="url" value={draft.videoUrl} onChange={(e) => set({ videoUrl: e.target.value })} />
              </FormField>
            )}
          </FormGrid>
        </FormSection>
        <FormSection title="Who" description="You are the organiser. Team members get reminders and see it on their calendar.">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs font-medium text-fg-secondary">Team members</legend>
            {others.length === 0 ? (
              <p className="text-xs text-muted-strong">No other team members in your scope.</p>
            ) : (
              <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                {others.map((u) => (
                  <li key={u.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`${formId}-u-${u.id}`}
                      checked={draft.userIds.includes(u.id)}
                      onCheckedChange={(v) => set({ userIds: v === true ? [...draft.userIds, u.id] : draft.userIds.filter((x) => x !== u.id) })}
                    />
                    <label htmlFor={`${formId}-u-${u.id}`} className="truncate text-sm text-fg">
                      {u.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-secondary">Contacts attending</span>
            {draft.contacts.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {draft.contacts.map((c) => (
                  <li key={c.id}>
                    <Chip size="md" className="pr-1">
                      {c.label}
                      <button type="button" aria-label={`Remove ${c.label}`} className="focus-ring inline-flex size-4 items-center justify-center rounded-full hover:bg-surface-3" onClick={() => set({ contacts: draft.contacts.filter((x) => x.id !== c.id) })}>
                        <X aria-hidden className="size-3" />
                      </button>
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
            <ContactPicker value={null} onChange={(c) => c && !draft.contacts.some((x) => x.id === c.id) && set({ contacts: [...draft.contacts, c] })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-secondary" id={`${formId}-guests`}>
              Guests (not in Vistar)
            </span>
            {draft.guests.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-labelledby={`${formId}-guests`}>
                {draft.guests.map((g, i) => (
                  <li key={`${g.name}-${i}`}>
                    <Chip size="md" className="pr-1">
                      {g.name}
                      {g.email ? ` (${g.email})` : ''}
                      <button type="button" aria-label={`Remove ${g.name}`} className="focus-ring inline-flex size-4 items-center justify-center rounded-full hover:bg-surface-3" onClick={() => set({ guests: draft.guests.filter((_, j) => j !== i) })}>
                        <X aria-hidden className="size-3" />
                      </button>
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-1.5">
              <Input className="w-40" aria-label="Guest name" placeholder="Name" value={guestName} onChange={(e) => setGuestName(e.target.value)} />
              <Input className="w-56" aria-label="Guest email" type="email" placeholder="Email (optional)" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} />
              <Button
                disabled={!guestName.trim() || draft.guests.length >= 20}
                onClick={() => {
                  set({ guests: [...draft.guests, { name: guestName.trim(), email: guestEmail.trim() }] });
                  setGuestName('');
                  setGuestEmail('');
                }}
              >
                <Plus aria-hidden />
                Add guest
              </Button>
            </div>
          </div>
        </FormSection>
        <FormSection title="Linked to">
          <FormGrid>
            <FormField label="Lead">
              <LeadPicker value={draft.lead} onChange={(lead) => set({ lead })} />
            </FormField>
            <FormField label="Contact">
              <ContactPicker value={draft.contact} onChange={(contact) => set({ contact })} />
            </FormField>
            <FormField label="Account">
              <AccountPicker value={draft.account} onChange={(account) => set({ account })} />
            </FormField>
            <FormField label="Deal">
              <DealPicker value={draft.deal} onChange={(deal) => set({ deal })} />
            </FormField>
          </FormGrid>
        </FormSection>
        <FormSection title="Reminders">
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {REMINDER_OPTIONS.map((r) => (
              <li key={r.value} className="flex items-center gap-2">
                <Checkbox
                  id={`${formId}-r-${r.value}`}
                  checked={draft.reminders.includes(r.value)}
                  disabled={!draft.reminders.includes(r.value) && draft.reminders.length >= 5}
                  onCheckedChange={(v) => set({ reminders: v === true ? [...draft.reminders, r.value].sort((a, b) => a - b) : draft.reminders.filter((x) => x !== r.value) })}
                />
                <label htmlFor={`${formId}-r-${r.value}`} className="text-sm text-fg">
                  {r.label}
                </label>
              </li>
            ))}
          </ul>
        </FormSection>
        {scope !== 'occurrence' && (
          <FormSection title="Repeat">
            <FormGrid>
              <FormField label="Repeats">
                <NativeSelect value={draft.freq} onChange={(e) => set({ freq: e.target.value as Draft['freq'] })}>
                  <option value="none">Does not repeat</option>
                  {RECURRENCE_FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {f === 'daily' ? 'Daily' : f === 'weekly' ? 'Weekly' : 'Monthly (same date)'}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              {draft.freq !== 'none' && (
                <FormField label={`Every (${draft.freq === 'daily' ? 'days' : draft.freq === 'weekly' ? 'weeks' : 'months'})`} error={errors.interval}>
                  <Input inputMode="numeric" value={draft.interval} maxLength={2} onChange={(e) => set({ interval: e.target.value.replace(/\D/g, '') })} />
                </FormField>
              )}
            </FormGrid>
            {draft.freq === 'weekly' && (
              <fieldset className="flex flex-wrap gap-2">
                <legend className="mb-1 text-xs font-medium text-fg-secondary">On</legend>
                {WEEKDAYS.map((w) => (
                  <label key={w} className="flex items-center gap-1.5 text-sm text-fg">
                    <Checkbox checked={draft.byWeekday.includes(w)} onCheckedChange={(v) => set({ byWeekday: v === true ? [...draft.byWeekday, w] : draft.byWeekday.filter((x) => x !== w) })} />
                    {WEEKDAY_LABEL[w]}
                  </label>
                ))}
              </fieldset>
            )}
            {draft.freq !== 'none' && (
              <FormGrid>
                <FormField label="Ends">
                  <NativeSelect value={draft.endKind} onChange={(e) => set({ endKind: e.target.value as Draft['endKind'] })}>
                    <option value="never">After 2 years (the maximum)</option>
                    <option value="count">After a number of times</option>
                    <option value="until">On a date</option>
                  </NativeSelect>
                </FormField>
                {draft.endKind === 'count' && (
                  <FormField label="Number of times" error={errors.count}>
                    <Input inputMode="numeric" value={draft.count} maxLength={3} onChange={(e) => set({ count: e.target.value.replace(/\D/g, '') })} />
                  </FormField>
                )}
                {draft.endKind === 'until' && (
                  <FormField label="Last date" error={errors.until}>
                    <Input type="date" value={draft.until} onChange={(e) => set({ until: e.target.value })} />
                  </FormField>
                )}
              </FormGrid>
            )}
          </FormSection>
        )}
        <FormField label="Agenda and notes">
          <Textarea rows={3} value={draft.description} maxLength={4000} onChange={(e) => set({ description: e.target.value })} />
        </FormField>
      </form>
    </CrmFormSheet>
  );
}
