'use client';

import { motion as motionTokens } from '@vistar/shared';
import { motion } from 'motion/react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/lib/use-reduced-motion';

/**
 * Right-side sheet (Radix Dialog): focus trap, Esc closes, focus returns to the opener.
 * Full width on mobile, `size` on wider screens. Always render a SheetTitle.
 */
export const Sheet = DialogPrimitive.Root;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

const widths = { md: 'sm:max-w-md', lg: 'sm:max-w-xl', xl: 'sm:max-w-2xl' } as const;
const ease = [0.2, 0, 0, 1] as const;

export interface SheetContentProps {
  className?: string;
  size?: keyof typeof widths;
  children: ReactNode;
  onOpenAutoFocus?: (e: Event) => void;
  onCloseAutoFocus?: (e: Event) => void;
  'aria-describedby'?: string;
}

export function SheetContent({
  className,
  size = 'lg',
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...aria
}: SheetContentProps) {
  const reduced = useReducedMotion();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content
        asChild
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(e) => {
          // Inline editors (deal value, tags) handle Esc themselves: cancel the edit, keep the sheet.
          if (e.target instanceof Element && e.target.closest('[data-esc-local]'))
            e.preventDefault();
        }}
        {...aria}
      >
        <motion.div
          initial={reduced ? false : { x: 32, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: motionTokens.slow / 1000, ease }}
          className={cn(
            'fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-border bg-surface text-fg shadow-overlay outline-none',
            widths[size],
            className,
          )}
        >
          {children}
        </motion.div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
