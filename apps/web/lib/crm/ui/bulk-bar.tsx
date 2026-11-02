'use client';

import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { useReducedMotion } from '@/lib/use-reduced-motion';

/**
 * Floating bulk-actions bar (same placement and feel as the Leads bar): "N selected", clear, then
 * the actions the role may use. Renders nothing when nothing is selected.
 */
export function BulkBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          role="region"
          aria-label="Bulk actions"
          initial={reduced ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-x-2 bottom-4 z-30 mx-auto flex max-w-max flex-wrap items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1.5 shadow-overlay"
        >
          <span aria-live="polite" className="px-2 text-sm font-medium text-fg tabular-nums">
            {count} selected
          </span>
          <Button size="icon-sm" variant="ghost" aria-label="Clear selection" onClick={onClear}>
            <X aria-hidden />
          </Button>
          <span aria-hidden className="mx-1 h-5 w-px bg-border" />
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Toast for a bulk result: success, partial (with up to two reasons) or failure. */
export function reportBulkResult(result: { succeeded: number; failed: ReadonlyArray<{ message: string }> }, done: (n: number) => string) {
  const reasons = [...new Set(result.failed.map((f) => f.message))].slice(0, 2).join(' ');
  if (result.failed.length === 0) toast.success(done(result.succeeded));
  else if (result.succeeded > 0) toast.warning(`${done(result.succeeded)} ${result.failed.length} could not be changed.`, { description: reasons });
  else toast.error(`Nothing was changed. ${result.failed.length === 1 ? 'The record' : `${result.failed.length} records`} could not be updated.`, { description: reasons });
}
