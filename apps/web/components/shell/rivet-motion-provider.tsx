'use client';

import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { animatePageEntrance, attachGlobalClickAnimation, attachMagneticListeners, isReducedMotion } from '@/lib/rivet-motion';

export function RivetMotionProvider({ children }: { children?: ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    if (isReducedMotion()) return;

    // Attach magnetic listeners and global spring click interactions
    const cleanupMagnetic = attachMagneticListeners(document.body);
    const cleanupClick = attachGlobalClickAnimation(document.body);

    // Watch for dynamic DOM additions
    const observer = new MutationObserver(() => {
      attachMagneticListeners(document.body);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cleanupMagnetic();
      cleanupClick();
      observer.disconnect();
    };
  }, []);

  // When pathname changes, trigger Rivet page entrance choreography
  useEffect(() => {
    if (isReducedMotion()) return;
    const timer = setTimeout(() => {
      const mainEl = document.querySelector('main');
      if (mainEl) {
        animatePageEntrance(mainEl as HTMLElement);
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [pathname]);

  return <>{children}</>;
}
