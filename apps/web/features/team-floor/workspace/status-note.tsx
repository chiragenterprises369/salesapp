'use client';

import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/common/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * "How status works" (D-062): what the floor shows comes only from what Vistar can observe, and the
 * known limits are stated, not hidden.
 */
export function StatusNote({ open, onOpenChange, compact }: { open: boolean; onOpenChange: (open: boolean) => void; compact?: boolean }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button size={compact ? 'icon-sm' : 'sm'} variant="ghost" aria-label={compact ? 'How live status works' : undefined}>
          <Info aria-hidden />
          {!compact && 'How status works'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 space-y-2.5 text-sm" align="end">
        <p className="font-semibold text-fg">How live status works</p>
        <ul className={cn('list-disc space-y-1.5 pl-4 text-fg-secondary')}>
          <li>Status comes only from what Vistar observes: sign-in and sign-out, Vistar open on the web or the Android app (a signal every 15 seconds), phone calls from the Android app, their own status (break, lunch, meeting, field visit), attendance and working hours.</li>
          <li>No signal for 45 seconds means Offline, with the time they were last seen.</li>
          <li>Vistar cannot tell whether someone is physically at their desk. Seats on the floor are where people sit, not a tracked position.</li>
          <li>The room comes from office beacons, office Wi-Fi or a QR or NFC scan in the Android app. Each room shows its source and how sure it is; QR and NFC are exact.</li>
          <li>For outgoing SIM calls Android does not report when the other side answers: “On a call” starts at dialling and the talk time comes from the call log after the call.</li>
          <li>“Screen” is the page the web or the app had open at the last signal.</li>
        </ul>
      </PopoverContent>
    </Popover>
  );
}
