'use client';

import { useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

const subscribeNoop = () => () => undefined;

/**
 * Fixed full-screen layer above the page for dragged and flying bodies. Rendering the dragged
 * element here (not in its list) keeps list layout untouched while it moves. Pointer events pass
 * through; hidden from assistive tech (the source element keeps focus and semantics).
 */
export function DragOverlayPortal({ children, className, style, zIndex = 50 }: { children: ReactNode; className?: string; style?: CSSProperties; zIndex?: number }) {
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  if (!mounted) return null;
  return createPortal(
    <div aria-hidden data-drag-overlay="" className={cn('pointer-events-none fixed inset-0 overflow-hidden', className)} style={{ zIndex, ...style }}>
      {children}
    </div>,
    document.body,
  );
}
