'use client';

import type { AttendeeResponse, Meeting } from '@vistar/shared';
import { Ban, CalendarClock, Check, ExternalLink, MapPin, Pencil, Phone, Trash2, Video } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useMeetingMutations } from '@/lib/crm/calendar';
import { MEETING_MODE, MEETING_STATUS } from '@/lib/crm/format';
import { dayLabel, dayKeyIn, timeLabel } from '@/lib/crm/tz';
import { formErrorMessage } from '@/lib/crm/ui/errors';
import { useCan, useMe } from '@/lib/session/session';

const RESPONSE: Record<AttendeeResponse, string> = { pending: 'Not answered', accepted: 'Going', declined: 'Not going', tentative: 'Maybe' };

/** Meeting details with the actions the caller may use: edit or reschedule, respond, complete with an outcome, cancel, delete. */
export function MeetingView({ meeting, onClose, onEdit }: { meeting: Meeting; onClose: () => void; onEdit: (scope: 'series' | 'occurrence') => void }) {
  const me = useMe();
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';
  const m = useMeetingMutations();
  const canUpdate = useCan('calendar.update');
  const canDelete = useCan('calendar.delete');
  const [mode, setMode] = useState<'view' | 'cancel' | 'complete' | 'scope'>('view');
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState(meeting.outcome ?? '');
  const [cancelScope, setCancelScope] = useState<'occurrence' | 'series'>('occurrence');
  const mine = meeting.attendees.find((a) => a.userId === me?.user.id && !a.isOrganizer);
  const recurring = !!meeting.recurrence && !!meeting.occurrenceStart;
  const scheduled = meeting.status === 'scheduled';
  const fail = (e: unknown) => toast.error(formErrorMessage(e, 'That did not work. Try again.'));
  const day = dayLabel(dayKeyIn(meeting.startAt, tz), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const when = meeting.allDay ? `${day}, all day` : `${day}, ${timeLabel(meeting.startAt, tz)} – ${timeLabel(meeting.endAt, tz)}`;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className={meeting.status === 'cancelled' ? 'line-through' : undefined}>{meeting.title}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <CalendarClock aria-hidden className="size-4" />
            {when}
            {recurring && <Chip>Repeats</Chip>}
            {meeting.status !== 'scheduled' && <Chip tone={MEETING_STATUS[meeting.status].tone}>{MEETING_STATUS[meeting.status].label}</Chip>}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {mode === 'view' && (
            <div className="flex flex-col gap-4 text-sm">
              <p className="flex items-center gap-2 text-fg-secondary">
                {meeting.mode === 'video' ? <Video aria-hidden className="size-4" /> : meeting.mode === 'phone' ? <Phone aria-hidden className="size-4" /> : <MapPin aria-hidden className="size-4" />}
                {MEETING_MODE[meeting.mode]}
                {meeting.location && ` · ${meeting.location}`}
                {meeting.videoUrl && (
                  <a href={meeting.videoUrl} target="_blank" rel="noreferrer" className="focus-ring inline-flex items-center gap-1 rounded-sm font-medium text-accent-text hover:underline">
                    Join <ExternalLink aria-hidden className="size-3.5" />
                  </a>
                )}
              </p>
              {meeting.description && <p className="whitespace-pre-wrap text-fg">{meeting.description}</p>}
              <div>
                <h3 className="mb-1 text-xs font-semibold text-fg-secondary">People</h3>
                <ul className="flex flex-col gap-1">
                  {meeting.attendees.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        {a.name}
                        {a.isOrganizer && <span className="text-muted-strong"> (organiser)</span>}
                      </span>
                      {!a.isOrganizer && <span className="text-xs text-muted-strong">{RESPONSE[a.response]}</span>}
                    </li>
                  ))}
                </ul>
              </div>
              {(meeting.lead || meeting.contact || meeting.account || meeting.deal) && (
                <div>
                  <h3 className="mb-1 text-xs font-semibold text-fg-secondary">Linked to</h3>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1">
                    {meeting.lead && (
                      <li>
                        Lead <Link className="focus-ring rounded-sm font-medium hover:underline" href={`/app/leads/${meeting.lead.id}`}>{meeting.lead.name}</Link>
                      </li>
                    )}
                    {meeting.contact && (
                      <li>
                        Contact <Link className="focus-ring rounded-sm font-medium hover:underline" href={`/app/contacts/${meeting.contact.id}`}>{meeting.contact.name}</Link>
                      </li>
                    )}
                    {meeting.account && (
                      <li>
                        Account <Link className="focus-ring rounded-sm font-medium hover:underline" href={`/app/accounts/${meeting.account.id}`}>{meeting.account.name}</Link>
                      </li>
                    )}
                    {meeting.deal && (
                      <li>
                        Deal <Link className="focus-ring rounded-sm font-medium hover:underline" href={`/app/deals/${meeting.deal.id}`}>{meeting.deal.title}</Link>
                      </li>
                    )}
                  </ul>
                </div>
              )}
              {meeting.reminders.length > 0 && <p className="text-xs text-muted-strong">Reminders: {meeting.reminders.map((r) => (r >= 1440 ? `${r / 1440} day` : r >= 60 ? `${r / 60} h` : `${r} min`)).join(', ')} before</p>}
              {meeting.outcome && (
                <div>
                  <h3 className="mb-1 text-xs font-semibold text-fg-secondary">Outcome</h3>
                  <p className="whitespace-pre-wrap">{meeting.outcome}</p>
                </div>
              )}
              {meeting.cancelReason && <p className="text-xs text-muted-strong">Cancelled: {meeting.cancelReason}</p>}
              {mine && scheduled && (
                <FormField label="Your answer">
                  <NativeSelect value={mine.response} onChange={(e) => m.respond.mutate({ id: meeting.id, body: { response: e.target.value as Exclude<AttendeeResponse, 'pending'> } }, { onSuccess: () => toast.success('Answer saved'), onError: fail })}>
                    {mine.response === 'pending' && <option value="pending">Choose</option>}
                    <option value="accepted">Going</option>
                    <option value="tentative">Maybe</option>
                    <option value="declined">Not going</option>
                  </NativeSelect>
                </FormField>
              )}
            </div>
          )}
          {mode === 'scope' && (
            <fieldset className="flex flex-col gap-2 text-sm">
              <legend className="mb-1 font-medium">This meeting repeats. What do you want to change?</legend>
              <Button onClick={() => onEdit('occurrence')}>Only this occurrence</Button>
              <Button onClick={() => onEdit('series')}>The whole series</Button>
            </fieldset>
          )}
          {mode === 'complete' && (
            <FormField label="Outcome" hint="What was agreed; shows on the linked records">
              <Textarea autoFocus rows={4} value={outcome} maxLength={4000} onChange={(e) => setOutcome(e.target.value)} />
            </FormField>
          )}
          {mode === 'cancel' && (
            <div className="flex flex-col gap-3">
              {recurring && (
                <FormField label="Cancel">
                  <NativeSelect value={cancelScope} onChange={(e) => setCancelScope(e.target.value as 'occurrence' | 'series')}>
                    <option value="occurrence">Only this occurrence</option>
                    <option value="series">The whole series</option>
                  </NativeSelect>
                </FormField>
              )}
              <FormField label="Reason" hint="Optional; attendees see it">
                <Input autoFocus value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
              </FormField>
            </div>
          )}
        </DialogBody>
        <DialogFooter className="flex-wrap">
          {mode === 'view' && (
            <>
              {canDelete && (
                <Button variant="ghost" className="mr-auto text-danger-text" loading={m.remove.isPending} onClick={() => m.remove.mutate(meeting.id, { onSuccess: () => { toast.success('Meeting deleted'); onClose(); }, onError: fail })}>
                  <Trash2 aria-hidden />
                  Delete
                </Button>
              )}
              {canUpdate && scheduled && (
                <Button onClick={() => setMode('cancel')}>
                  <Ban aria-hidden />
                  Cancel meeting
                </Button>
              )}
              {canUpdate && scheduled && (
                <Button onClick={() => setMode('complete')}>
                  <Check aria-hidden />
                  Mark done
                </Button>
              )}
              {canUpdate && scheduled && (
                <Button variant="primary" onClick={() => (recurring ? setMode('scope') : onEdit('series'))}>
                  <Pencil aria-hidden />
                  Edit or reschedule
                </Button>
              )}
              {!(canUpdate && scheduled) && (
                <Button variant="primary" onClick={onClose}>
                  Close
                </Button>
              )}
            </>
          )}
          {mode !== 'view' && (
            <Button onClick={() => setMode('view')} disabled={m.cancel.isPending || m.update.isPending}>
              Back
            </Button>
          )}
          {mode === 'complete' && (
            <Button
              variant="primary"
              loading={m.update.isPending}
              onClick={() =>
                m.update.mutate(
                  { id: meeting.id, patch: { status: 'completed', outcome: outcome.trim() || null, expectedVersion: meeting.version, ...(recurring ? { scope: 'occurrence' as const, occurrenceStart: meeting.occurrenceStart! } : {}) } },
                  { onSuccess: () => { toast.success('Meeting marked as done'); onClose(); }, onError: fail },
                )
              }
            >
              Save outcome
            </Button>
          )}
          {mode === 'cancel' && (
            <Button
              variant="danger"
              loading={m.cancel.isPending}
              onClick={() =>
                m.cancel.mutate(
                  { id: meeting.id, body: { reason: reason.trim() || null, ...(recurring && cancelScope === 'occurrence' ? { occurrenceStart: meeting.occurrenceStart! } : {}) } },
                  { onSuccess: () => { toast.success('Meeting cancelled'); onClose(); }, onError: fail },
                )
              }
            >
              Cancel meeting
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
