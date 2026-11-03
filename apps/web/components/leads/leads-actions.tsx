'use client';

import type { LeadListItem } from '@vistar/shared';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { LeadActionsProvider, type LeadActions } from '@/components/leads-shared/lead-actions';
import { toast } from '@/components/ui/toast';
import { ApiRequestError } from '@/lib/api-error';
import { api } from '@/lib/api/client';
import { isMockData } from '@/lib/api/data-source';
import { formErrorMessage } from '@/lib/crm/ui/errors';
import { useCan, useMe } from '@/lib/session/session';
import { actorFrom, useLocalActivity } from '@/components/lead-detail/activity-store';
import { formatPhone } from './lead-meta';
import { renderTemplate, WhatsAppDialog } from './whatsapp-dialog';

/** Telephony is not connected (or not on the plan): the device dialer still works. */
const DIAL_FALLBACK = new Set(['INTEGRATION_NOT_CONNECTED', 'INTEGRATION_NOT_CONFIGURED', 'FEATURE_DISABLED']);

function openDialer(phone: string): void {
  window.location.href = `tel:${phone}`;
}

/**
 * Real handlers for the shared lead actions (Board and Table call the same ones):
 * open = Lead detail drawer (?lead=<id>); note = drawer with the note composer focused;
 * call = click-to-call through the company's telephony provider (POST /calls: your phone rings first, then the
 * customer), else the device dialer; WhatsApp = the lead's chat in the inbox when one exists, else WhatsApp with
 * the number (the first business message needs an approved template, sent from the inbox or a document).
 * Mock data mode keeps the local template composer and timeline entries.
 */
export function LeadsActions({
  open,
  children,
}: {
  open: (id: string, opts?: { focusNote?: boolean }) => void;
  children: ReactNode;
}) {
  const me = useMe();
  const router = useRouter();
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
        if (!canCall) return toast.error('Your role cannot place calls. Ask an admin for calling access.');
        if (!lead.phone) return toast.error(`${lead.name} has no phone number`);
        const phone = lead.phone;
        if (isMockData()) {
          toast(`Calling ${lead.name}`, { description: `Dial ${formatPhone(phone)}. Click-to-call connects once telephony is set up in Integrations.` });
          return;
        }
        void api.call('callCreate', { body: { leadId: lead.id } }).then(
          () => toast.success(`Calling ${lead.name}`, { description: 'Your phone rings first. Pick up and the call connects to the customer.' }),
          (e: unknown) => {
            if (e instanceof ApiRequestError && DIAL_FALLBACK.has(e.code)) {
              toast(`Dialling ${formatPhone(phone)}`, { description: 'Click-to-call is not set up, so your device dialer opens. Connect a telephony provider in Integrations to call from Vistar.' });
              openDialer(phone);
              return;
            }
            toast.error(formErrorMessage(e, 'The call did not start. Try again.'));
          },
        );
      },
      whatsapp: (lead) => {
        if (!canSend) return toast.error('Your role cannot send WhatsApp messages.');
        if (isMockData()) {
          setWaLead(lead);
          return;
        }
        if (!lead.phone) return toast.error(`${lead.name} has no phone number`);
        const phone = lead.phone;
        void api.call('conversationList', { query: { q: phone, limit: 1 } }).then(
          (page) => {
            const chat = page.items[0];
            if (chat) {
              router.push(`/app/inbox?c=${chat.id}`);
              return;
            }
            toast(`No WhatsApp chat with ${lead.name} yet`, { description: 'WhatsApp opens with the number. Business messages to a new customer need an approved template.' });
            window.open(`https://wa.me/${phone.replace(/\D/g, '')}`, '_blank', 'noopener,noreferrer');
          },
          (e: unknown) => toast.error(formErrorMessage(e, 'The WhatsApp chats did not load. Try again.')),
        );
      },
      note: (lead) => open(lead.id, { focusNote: canNote }),
    }),
    [open, router, canCall, canSend, canNote],
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
