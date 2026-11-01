'use client';

import type { LeadListItem } from '@vistar/shared';
import { MessageCircle, Phone, StickyNote } from 'lucide-react';
import { createContext, useContext, useMemo, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
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

/**
 * Hover/focus quick actions: call, WhatsApp, note. Icon buttons with accessible names.
 * `size="touch"` gives 44x44 targets (Employee panel, mobile cards).
 */
export function LeadQuickActions({ lead, className, size = 'sm' }: { lead: LeadListItem; className?: string; size?: 'sm' | 'touch' }) {
  const actions = useLeadActions();
  const btn = size === 'touch' ? 'icon-touch' : 'icon-sm';
  // Stop clicks and key presses from reaching the card/row behind (open, drag, select handlers).
  const guard = (fn: () => void) => ({
    onClick: (e: MouseEvent) => {
      e.stopPropagation();
      fn();
    },
    onKeyDown: (e: KeyboardEvent) => e.stopPropagation(),
    onPointerDown: (e: PointerEvent) => e.stopPropagation(),
  });
  return (
    <div className={cn('flex items-center gap-0.5', className)} role="group" aria-label={`Quick actions for ${lead.name}`}>
      <Button size={btn} variant="ghost" aria-label={`Call ${lead.name}`} disabled={!lead.phone} {...guard(() => actions.call(lead))}>
        <Phone aria-hidden />
      </Button>
      <Button size={btn} variant="ghost" aria-label={`WhatsApp ${lead.name}`} disabled={!lead.phone} {...guard(() => actions.whatsapp(lead))}>
        <MessageCircle aria-hidden />
      </Button>
      <Button size={btn} variant="ghost" aria-label={`Add note for ${lead.name}`} {...guard(() => actions.note(lead))}>
        <StickyNote aria-hidden />
      </Button>
    </div>
  );
}
