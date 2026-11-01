'use client';

import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Drawer } from 'vaul';
import { Button } from '@/components/ui/button';

/** Left navigation drawer for phones and tablets (vaul: swipe to close, focus trap, Esc). */
export function NavDrawer({ open, onOpenChange, title, header, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; header: ReactNode; children: ReactNode }) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction="left">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-x-0 top-[var(--impersonation-banner-h,0px)] bottom-0 z-50 bg-overlay" />
        <Drawer.Content className="fixed top-[var(--impersonation-banner-h,0px)] bottom-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface text-fg shadow-overlay outline-none">
          <Drawer.Title className="sr-only">{title}</Drawer.Title>
          <Drawer.Description className="sr-only">Main navigation</Drawer.Description>
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
            <div className="min-w-0 flex-1">{header}</div>
            <Button variant="ghost" size="icon" aria-label="Close navigation" onClick={() => onOpenChange(false)}>
              <X aria-hidden />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
