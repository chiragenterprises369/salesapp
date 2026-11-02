'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { isApiRequestError } from '@/lib/api-error';
import { api } from '@/lib/api/client';
import { isMockData, noteMockUse } from '@/lib/api/data-source';
import { firstName } from '../state/reducer';

const MAX = 1000;

/** In-app message to a teammate (POST /users/{id}/messages -> their notifications). */
export function MessageDialog({
  person,
  leadId,
  leadName,
  open,
  onOpenChange,
}: {
  person: { id: string; name: string };
  /** Lead the message is about (their current lead), linked in the notification. */
  leadId: string | null;
  leadName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [text, setText] = useState('');
  const [aboutLead, setAboutLead] = useState(true);
  const send = useMutation({
    mutationFn: async (body: string) => {
      if (isMockData()) {
        noteMockUse('team-floor-message');
        return { ok: true as const };
      }
      return api.call('userMessage', { params: { id: person.id }, body: { body, ...(leadId && aboutLead ? { leadId } : {}) } });
    },
    onSuccess: () => {
      toast.success(`Message sent to ${firstName(person.name)}`);
      setText('');
      onOpenChange(false);
    },
    onError: (e) => {
      if (isApiRequestError(e) && e.status === 404)
        toast.error(`The message was not sent. Messaging teammates is not on this server yet, or ${firstName(person.name)} is outside your team.`);
      else toast.error(isApiRequestError(e) ? e.message : 'The message was not sent. Check your connection, then try again.');
    },
  });
  const body = text.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !send.isPending && onOpenChange(o)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Message {firstName(person.name)}</DialogTitle>
          <DialogDescription>They get it as a notification in Vistar and on the Android app.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <FormField label="Message" hint={`${text.length}/${MAX}`}>
            <Textarea
              value={text}
              maxLength={MAX}
              rows={4}
              onChange={(ev) => setText(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && body) send.mutate(body);
              }}
              className="resize-none"
              placeholder="Please call back the Pune lead before 5 pm."
            />
          </FormField>
          {leadId && leadName && (
            <label className="flex items-center gap-2 text-sm text-fg-secondary">
              <input type="checkbox" checked={aboutLead} onChange={(e) => setAboutLead(e.target.checked)} className="size-4 accent-accent" />
              Link it to {leadName}
            </label>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} disabled={send.isPending}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!body} loading={send.isPending} onClick={() => send.mutate(body)}>
            Send message
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
