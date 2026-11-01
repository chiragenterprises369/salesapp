'use client';

import type { LeadListItem } from '@vistar/shared';
import { useMemo, useState, type ReactNode } from 'react';
import { LeadActionsProvider, type LeadActions } from '@/components/leads-shared/lead-actions';
import { toast } from '@/components/ui/toast';
import { useCan, useMe } from '@/lib/session/session';
import { actorFrom, useLocalActivity } from '@/components/lead-detail/activity-store';
import { formatPhone } from './lead-meta';
import { renderTemplate, WhatsAppDialog } from './whatsapp-dialog';

/**
 * Real handlers for the shared lead actions (Board and Table call the same ones):
 * open = Lead detail drawer (?lead=<id>), call = toast until telephony lands, WhatsApp = template
 * composer, note = drawer with the note composer focused.
 */
export function LeadsActions({
  open,
  children,
}: {
  open: (id: string, opts?: { focusNote?: boolean }) => void;
  children: ReactNode;
}) {
  const me = useMe();
  const canCall = useCan('calls.make');
  const canSend = useCan('messages.send');
  const canNote = useCan('leads.update');
  const addActivity = useLocalActivity((s) => s.add);
  const [waLead, setWaLead] = useState<LeadListItem | null>(null);
  const [sending, setSending] = useState(false);

  const value = useMemo<Partial<LeadActions>>(
    () => ({
      open: (lead) => open(lead.id),
      call: (lead) => {
        if (!canCall)
          return toast.error('Your role cannot place calls. Ask an admin for calling access.');
        toast(`Calling ${lead.name}`, {
          description: `Dial ${formatPhone(lead.phone)}. Click-to-call connects once telephony is set up in Integrations.`,
        });
      },
      whatsapp: (lead) => {
        if (!canSend) return toast.error('Your role cannot send WhatsApp messages.');
        setWaLead(lead);
      },
      note: (lead) => open(lead.id, { focusNote: canNote }),
    }),
    [open, canCall, canSend, canNote],
  );

  return (
    <LeadActionsProvider value={value}>
      {children}
      <WhatsAppDialog
        open={!!waLead}
        onOpenChange={(o) => !o && setWaLead(null)}
        leads={waLead ? [waLead] : []}
        sending={sending}
        onSend={async (template) => {
          if (!waLead) return;
          setSending(true);
          await new Promise((r) => setTimeout(r, 400));
          addActivity(waLead.id, {
            type: 'message',
            actor: actorFrom(me?.user ?? null),
            payload: {
              conversationId: crypto.randomUUID(),
              messageId: crypto.randomUUID(),
              direction: 'outbound',
              preview: renderTemplate(template, waLead, me?.workspace.name ?? '').slice(0, 200),
            },
          });
          setSending(false);
          toast.success(`Sent "${template.label}" to ${waLead.name}`);
          setWaLead(null);
        }}
      />
    </LeadActionsProvider>
  );
}
