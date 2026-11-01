'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/leads/primitives/sheet';
import { useLeadWords } from '@/components/leads/use-lead-words';
import { LeadDetail, type LeadPanel } from './lead-detail';
import { restoreDrawerFocus, useDrawerIntent, useLeadDrawer } from './use-lead-drawer';

/**
 * Lead detail drawer, opened by `?lead=<id>` from the Board or the Table. Esc, the close button,
 * a click on the overlay and the browser Back button all close it. Focus is trapped while open and
 * returns to the row or card that opened it.
 */
export function LeadDrawer({ panel }: { panel: LeadPanel }) {
  const { leadId, close } = useLeadDrawer();
  const w = useLeadWords();
  return (
    <Sheet open={!!leadId} onOpenChange={(o) => !o && close()}>
      {leadId && (
        <SheetContent
          size="lg"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            // The note quick action focuses the composer once the lead has loaded; until then
            // focus sits on the sheet itself so it stays trapped.
            if (useDrawerIntent.getState().focusNoteFor === leadId) {
              e.preventDefault();
              if (e.target instanceof HTMLElement) e.target.focus();
            }
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            restoreDrawerFocus();
          }}
        >
          <SheetTitle className="sr-only">{w.Lead} details</SheetTitle>
          <LeadDetail
            key={leadId}
            leadId={leadId}
            panel={panel}
            variant="drawer"
            headerEnd={
              <SheetClose asChild>
                <Button size="icon-sm" variant="ghost" aria-label={`Close ${w.lead} details`}>
                  <X aria-hidden />
                </Button>
              </SheetClose>
            }
          />
        </SheetContent>
      )}
    </Sheet>
  );
}
