'use client';

import { BusinessHoursSchema, HolidaySchema, WEEKDAYS, type BusinessHours, type Weekday } from '@vistar/shared';
import { format, parseISO } from 'date-fns';
import { CalendarPlus, Copy, Plus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { Switch } from '@/components/common/switch';
import { toMinutes } from '@/components/common/time';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useReadOnly } from '@/lib/auth/use-auth';
import { useMe, useSessionActions } from '@/lib/session/session';
import { SaveBar, SettingsCard } from './settings-card';

const DAY_LABEL: Record<Weekday, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const MAX_SLOTS = 3;

type Holiday = { date: string; name: string };

function normalise(hours: BusinessHours): BusinessHours {
  return Object.fromEntries(WEEKDAYS.map((d) => [d, [...(hours[d] ?? [])]])) as BusinessHours;
}

/** Per-day problems: start after end, or overlapping slots. */
function validateHours(hours: BusinessHours): Partial<Record<Weekday, string>> {
  const errors: Partial<Record<Weekday, string>> = {};
  for (const day of WEEKDAYS) {
    const slots = [...(hours[day] ?? [])].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    if (slots.some((s) => !s.start || !s.end)) errors[day] = 'Enter a start and end time';
    else if (slots.some((s) => toMinutes(s.end) <= toMinutes(s.start))) errors[day] = 'Closing time must be after opening time';
    else if (slots.some((s, i) => i > 0 && toMinutes(s.start) < toMinutes(slots[i - 1]!.end))) errors[day] = 'Time ranges overlap';
  }
  return errors;
}

/** Weekly business hours (several ranges per day) and holidays, in the workspace timezone. */
export function BusinessHoursForm() {
  const me = useMe()!;
  const { updateWorkspace } = useSessionActions();
  const { reason } = useReadOnly();
  const savedHours = normalise(me.workspace.businessHours);
  const savedHolidays = me.workspace.holidays;
  const [hours, setHours] = useState<BusinessHours>(savedHours);
  const [holidays, setHolidays] = useState<Holiday[]>(savedHolidays);
  const [errors, setErrors] = useState<Partial<Record<Weekday, string>>>({});
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Holiday>({ date: '', name: '' });
  const [draftError, setDraftError] = useState<string | null>(null);
  const dirty = JSON.stringify(hours) !== JSON.stringify(savedHours) || JSON.stringify(holidays) !== JSON.stringify(savedHolidays);

  const setDay = (day: Weekday, slots: BusinessHours[Weekday]) => setHours((h) => ({ ...h, [day]: slots }));
  const updateSlot = (day: Weekday, i: number, key: 'start' | 'end', value: string) =>
    setDay(day, (hours[day] ?? []).map((s, j) => (j === i ? { ...s, [key]: value } : s)));

  const copyMonday = () => {
    const mon = hours.mon ?? [];
    setHours((h) => ({ ...h, tue: [...mon], wed: [...mon], thu: [...mon], fri: [...mon] }));
    toast('Monday hours copied to Tuesday to Friday');
  };

  const addHoliday = () => {
    const parsed = HolidaySchema.safeParse({ date: draft.date, name: draft.name.trim() });
    if (!parsed.success) {
      setDraftError(!draft.date ? 'Pick a date' : 'Enter a name, up to 80 characters');
      return;
    }
    if (holidays.some((h) => h.date === parsed.data.date)) {
      setDraftError('That date is already a holiday');
      return;
    }
    setDraftError(null);
    setHolidays((list) => [...list, parsed.data].sort((a, b) => a.date.localeCompare(b.date)));
    setDraft({ date: '', name: '' });
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found = validateHours(hours);
    setErrors(found);
    if (Object.keys(found).length > 0 || !BusinessHoursSchema.safeParse(hours).success) {
      toast.error('Fix the highlighted days before saving');
      return;
    }
    setSaving(true);
    try {
      await updateWorkspace({ businessHours: hours, holidays });
      toast.success('Business hours saved');
    } catch {
      toast.error('Business hours not saved. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  const discard = () => {
    setHours(savedHours);
    setHolidays(savedHolidays);
    setErrors({});
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <SettingsCard
        title="Weekly hours"
        description={`Workflows that wait for business hours and lead routing use these times (${me.workspace.timezone}).`}
      >
        <div className="mb-3 flex justify-end">
          <Button size="sm" variant="ghost" onClick={copyMonday} disabled={!!reason}>
            <Copy aria-hidden />
            Copy Monday to weekdays
          </Button>
        </div>
        <ul className="flex flex-col divide-y divide-border">
          {WEEKDAYS.map((day) => {
            const slots = hours[day] ?? [];
            const open = slots.length > 0;
            const errorId = `hours-${day}-error`;
            return (
              <li key={day} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
                <div className="flex items-center gap-3 sm:w-44 sm:pt-1.5">
                  <Switch
                    id={`open-${day}`}
                    checked={open}
                    disabled={!!reason}
                    onCheckedChange={(checked) => setDay(day, checked ? [{ start: '09:30', end: '18:30' }] : [])}
                  />
                  <label htmlFor={`open-${day}`} className="text-sm font-medium text-fg">
                    {DAY_LABEL[day]}
                  </label>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  {!open && <p className="text-sm text-muted sm:pt-1.5">Closed</p>}
                  {slots.map((slot, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        type="time"
                        step={900}
                        value={slot.start}
                        disabled={!!reason}
                        aria-label={`${DAY_LABEL[day]} opens at${slots.length > 1 ? `, range ${i + 1}` : ''}`}
                        aria-invalid={errors[day] ? true : undefined}
                        aria-describedby={errors[day] ? errorId : undefined}
                        onChange={(e) => updateSlot(day, i, 'start', e.target.value)}
                        className="w-32"
                      />
                      <span className="text-sm text-muted" aria-hidden>
                        to
                      </span>
                      <Input
                        type="time"
                        step={900}
                        value={slot.end}
                        disabled={!!reason}
                        aria-label={`${DAY_LABEL[day]} closes at${slots.length > 1 ? `, range ${i + 1}` : ''}`}
                        aria-invalid={errors[day] ? true : undefined}
                        aria-describedby={errors[day] ? errorId : undefined}
                        onChange={(e) => updateSlot(day, i, 'end', e.target.value)}
                        className="w-32"
                      />
                      {slots.length > 1 && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={!!reason}
                          aria-label={`Remove ${DAY_LABEL[day]} range ${i + 1}`}
                          onClick={() => setDay(day, slots.filter((_, j) => j !== i))}
                        >
                          <X aria-hidden />
                        </Button>
                      )}
                    </div>
                  ))}
                  {errors[day] && (
                    <p id={errorId} role="alert" className="text-xs text-danger-text">
                      {errors[day]}
                    </p>
                  )}
                </div>
                {open && slots.length < MAX_SLOTS && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="self-start"
                    disabled={!!reason}
                    onClick={() => {
                      const last = slots.at(-1);
                      setDay(day, [...slots, { start: last?.end ?? '14:00', end: '18:30' }]);
                    }}
                    aria-label={`Add hours on ${DAY_LABEL[day]}`}
                  >
                    <Plus aria-hidden />
                    Add hours
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </SettingsCard>

      <SettingsCard
        title="Holidays"
        description="Days the company is closed. Waits for business hours skip them."
        footer={<SaveBar dirty={dirty} saving={saving} readOnlyReason={reason} onDiscard={discard} />}
      >
        {holidays.length === 0 ? (
          <EmptyState size="sm" title="No holidays added" description="Add Diwali, Holi or your company's own days off below." />
        ) : (
          <ul className="mb-4 flex flex-col divide-y divide-border rounded-md border border-border">
            {holidays.map((h) => (
              <li key={h.date} className="flex items-center gap-3 px-3 py-2">
                <span className="w-40 text-sm text-fg-secondary tabular">{format(parseISO(h.date), 'EEE, d MMM yyyy')}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{h.name}</span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={!!reason}
                  aria-label={`Remove ${h.name}`}
                  onClick={() => setHolidays((list) => list.filter((x) => x.date !== h.date))}
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
          <FormField label="Date">
            <Input type="date" value={draft.date} disabled={!!reason} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
          </FormField>
          <FormField label="Holiday name" error={draftError ?? undefined}>
            <Input
              value={draft.name}
              maxLength={80}
              placeholder="Holi"
              disabled={!!reason}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addHoliday();
                }
              }}
            />
          </FormField>
          <Button onClick={addHoliday} disabled={!!reason} className={draftError ? 'sm:mb-5' : undefined}>
            <CalendarPlus aria-hidden />
            Add holiday
          </Button>
        </div>
      </SettingsCard>
    </form>
  );
}
