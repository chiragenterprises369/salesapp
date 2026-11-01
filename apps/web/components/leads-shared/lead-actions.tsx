'use client';

import type { LeadListItem } from '@vistar/shared';
import { MessageCircle, Phone, StickyNote } from 'lucide-react';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';

/**
 * Lead actions shared by the Board and Table views. OWNER: orchestrator (contract).
 * frontend-app provides the real handlers (detail drawer, call, WhatsApp composer, note) via
 * <LeadActionsProvider>; both views call useLeadActions() so behaviour is identical.
 * Defaults (no provider) show a toast so Wave 1 views work standalone.
 */
export interface LeadActions {
  /** Open the shared Lead detail drawer (URL: ?lead=<id>). */
  open: (lead: Pick<LeadListItem, 'id' | 'name'>) => void;
  call: (lead: LeadListItem) => void;
  whatsapp: (lead: LeadListItem) => void;
  note: (lead: LeadListItem) => void;
}

const fallback: LeadActions = {
  open: (l) => toast(`Open ${l.name}`),
  call: (l) => toast(`Calling ${l.name}`),
  whatsapp: (l) => toast(`WhatsApp ${l.name}`),
  note: (l) => toast(`Add note for ${l.name}`),
};

const LeadActionsContext = createContext<LeadActions>(fallback);

export function LeadActionsProvider({ value, children }: { value: Partial<LeadActions>; children: ReactNode }) {
  const merged = useMemo(() => ({ ...fallback, ...value }), [value]);
  return <LeadActionsContext.Provider value={merged}>{children}</LeadActionsContext.Provider>;
}

export function useLeadActions(): LeadActions {
  return useContext(LeadActionsContext);
}

/** Hover/focus quick actions: call, WhatsApp, note. Icon buttons with accessible names. */
export function LeadQuickActions({ lead, className }: { lead: LeadListItem; className?: string }) {
  const actions = useLeadActions();
  const stop = (fn: () => void) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    fn();
  };
  return (
    <div className={cn('flex items-center gap-0.5', className)} role="group" aria-label={`Quick actions for ${lead.name}`}>
      <Button size="icon-sm" variant="ghost" aria-label={`Call ${lead.name}`} disabled={!lead.phone} onClick={stop(() => actions.call(lead))}>
        <Phone aria-hidden />
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label={`WhatsApp ${lead.name}`} disabled={!lead.phone} onClick={stop(() => actions.whatsapp(lead))}>
        <MessageCircle aria-hidden />
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label={`Add note for ${lead.name}`} onClick={stop(() => actions.note(lead))}>
        <StickyNote aria-hidden />
      </Button>
    </div>
  );
}
