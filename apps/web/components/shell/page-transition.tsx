'use client';

import { motion as motionTokens, spaceTokens } from '@vistar/shared';
import { usePathname } from 'next/navigation';
import { useLayoutEffect, useRef, useState, ViewTransition, type HTMLAttributes } from 'react';
import { useInterfaceStore } from '@/lib/theme';

type TransitionKind = 'none' | 'vs-glide' | 'vs-fade';

/**
 * The "room" of a path. Moving between rooms animates; moving inside one (settings sub-pages, a lead
 * page from the list, a workflow from the list) does not, and keeps nested layouts mounted.
 */
export function roomOf(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  const depth = parts[1] === 'x' || parts[1] === 'objects' ? 3 : 2;
  return `/${parts.slice(0, depth).join('/')}`;
}

/** Entrance where the View Transitions API is missing: a short WAAPI animation that never blocks input. */
function RoomMain({ kind, ...props }: HTMLAttributes<HTMLElement> & { kind: TransitionKind }) {
  const ref = useRef<HTMLElement>(null);
  const mountKind = useRef(kind);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || mountKind.current === 'none' || typeof document.startViewTransition === 'function') return;
    const glide = mountKind.current === 'vs-glide';
    el.animate(
      glide
        ? [{ opacity: 0, transform: `translate3d(0, ${spaceTokens.page.enterShift}px, 0) scale(${spaceTokens.page.enterScale})` }, { opacity: 1, transform: 'none' }]
        : [{ opacity: 0 }, { opacity: 1 }],
      { duration: glide ? motionTokens.page : motionTokens.fade, easing: glide ? motionTokens.easingGlide : 'linear' },
    );
  }, []);
  return <main ref={ref} {...props} />;
}

/**
 * The shell's <main id="main">, with page transitions between rooms (SPEC 28.2): React <ViewTransition>
 * (View Transitions API) where supported, a WAAPI entrance elsewhere. Depth and Neon Space only;
 * Full = slide-and-depth glide (< 300 ms), Reduced = fade, Off and Classic = none. The overlay ignores
 * pointer events (styles/space.css), so input is never blocked.
 */
export function PageTransitionMain({ children, ...props }: HTMLAttributes<HTMLElement>) {
  const pathname = usePathname();
  const room = roomOf(pathname);
  const style = useInterfaceStore((s) => s.resolved.style);
  const motion = useInterfaceStore((s) => s.resolved.motion);
  const kind: TransitionKind = style === 'classic' || motion === 'off' ? 'none' : motion === 'reduced' ? 'vs-fade' : 'vs-glide';
  // Only rooms reached by navigation animate (never the first page load).
  const [shownRoom, setShownRoom] = useState(room);
  const [navigated, setNavigated] = useState(false);
  if (shownRoom !== room) {
    setShownRoom(room);
    setNavigated(true);
  }

  return (
    <ViewTransition key={room} enter={kind} exit={kind} update="none" share="none" default="none">
      <RoomMain id="main" kind={navigated ? kind : 'none'} {...props}>
        {children}
      </RoomMain>
    </ViewTransition>
  );
}
