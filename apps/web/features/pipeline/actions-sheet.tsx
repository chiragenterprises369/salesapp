'use client';

import { stageTone, type LeadListItem, type Stage } from '@vistar/shared';
import { Check, ExternalLink, MessageCircle, Phone, StickyNote, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Drawer } from 'vaul';
import { useLeadActions } from '@/components/leads-shared/lead-actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { STAGE_DOT } from './tones';
import { useBoardWords } from './words';

function SheetItem({ icon: Icon, onSelect, disabled, children }: { icon?: LucideIcon; onSelect: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'focus-ring flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-base text-fg',
        'hover:bg-surface-3 active:bg-surface-3 disabled:text-muted disabled:hover:bg-transparent',
      )}
    >
      {Icon && <Icon aria-hidden className="size-5 shrink-0 text-fg-secondary" />}
      {children}
    </button>
  );
}

/**
 * Touch actions sheet: opened by press-and-release (long-press without moving) on a card. Lists
 * the card's actions (open, call, WhatsApp, note) and "Move to stage" as 44 px rows.
 */
export function ActionsSheet({
  target,
  stages,
  canMove,
  showQuick,
  onClose,
  onMove,
}: {
  target: { lead: LeadListItem; stageId: string } | null;
  stages: readonly Stage[];
  canMove: boolean;
  showQuick: boolean;
  onClose: () => void;
  onMove: (lead: LeadListItem, fromStageId: string, toStageId: string) => void;
}) {
  const actions = useLeadActions();
  const words = useBoardWords();
  const lead = target?.lead;
  const stage = stages.find((s) => s.id === target?.stageId);
  const run = (fn: () => void) => {
    onClose();
    fn();
  };

  return (
    <Drawer.Root open={!!target} onOpenChange={(open) => !open && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <Drawer.Content
          data-board-actions-sheet=""
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-lg border-t border-border bg-surface text-fg shadow-overlay outline-none"
        >
          <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border-strong" />
          {lead && (
            <>
              <div className="flex flex-col gap-0.5 px-4 pt-3 pb-2">
                <Drawer.Title className="truncate text-base font-semibold">{lead.name}</Drawer.Title>
                <Drawer.Description className="truncate text-xs text-muted">
                  {[lead.companyName, stage?.name].filter(Boolean).join(' · ') || `${words.one} actions`}
                </Drawer.Description>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                <div role="group" aria-label={`Actions for ${lead.name}`} className="flex flex-col">
                  <SheetItem icon={ExternalLink} onSelect={() => run(() => actions.open(lead))}>
                    Open {words.oneLower}
                  </SheetItem>
                  {showQuick && (
                    <>
                      <SheetItem icon={Phone} disabled={!lead.phone} onSelect={() => run(() => actions.call(lead))}>
                        Call
                      </SheetItem>
                      <SheetItem icon={MessageCircle} disabled={!lead.phone} onSelect={() => run(() => actions.whatsapp(lead))}>
                        WhatsApp
                      </SheetItem>
                      <SheetItem icon={StickyNote} onSelect={() => run(() => actions.note(lead))}>
                        Add note
                      </SheetItem>
                    </>
                  )}
                </div>
                {canMove && target && (
                  <div role="group" aria-label="Move to stage" className="mt-1 flex flex-col border-t border-border pt-1">
                    <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted">Move to stage</p>
                    {stages.map((s) => {
                      const current = s.id === target.stageId;
                      return (
                        <SheetItem key={s.id} disabled={current} onSelect={() => run(() => onMove(lead, target.stageId, s.id))}>
                          <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', STAGE_DOT[stageTone(s)])} />
                          <span className="flex-1 truncate">{s.name}</span>
                          {current && (
                            <span className="flex items-center gap-1 text-xs">
                              <Check aria-hidden className="size-4" />
                              Current
                            </span>
                          )}
                        </SheetItem>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="border-t border-border p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                <Button size="touch" variant="ghost" className="w-full" onClick={onClose}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
