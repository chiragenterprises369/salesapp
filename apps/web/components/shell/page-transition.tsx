'use client';

import { motion as motionTokens, spaceTokens } from '@vistar/shared';
import { usePathname } from 'next/navigation';
import { useEffectEvent, useLayoutEffect, useRef, ViewTransition, type HTMLAttributes } from 'react';
import { useInterfaceStore } from '@/lib/theme';

type TransitionKind = 'none' | 'vs-glide' | 'vs-fade';

/**
 * The "room" of a path. Moving between rooms animates; moving inside one (settings sub-pages, a lead
 * page from the list, a workflow from the list) does not.
 */
export function roomOf(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  const depth = parts[1] === 'x' || parts[1] === 'objects' ? 3 : 2;
  return `/${parts.slice(0, depth).join('/')}`;
}

/**
 * The shell's <main id="main">, with page transitions between rooms (SPEC 28.2). Depth and Neon Space
 * only: Full = slide-and-depth glide (< 300 ms), Reduced = fade, Off and Classic = none.
 * - View Transitions API (React <ViewTransition>, "update" of this boundary) where supported. The class
 *   is set only for the render that changes room, so other transitions on the page never animate and
 *   Classic never starts a view transition. The overlay ignores pointer events (styles/space.css).
 * - Elsewhere a short WAAPI entrance on the new page. Neither blocks input.
 * <main> is never remounted, so scrolling and nested layouts behave exactly as before.
 */
export function PageTransitionMain({ children, ...props }: HTMLAttributes<HTMLElement>) {
  const pathname = usePathname();
  const room = roomOf(pathname);
  const style = useInterfaceStore((s) => s.resolved.style);
  const motion = useInterfaceStore((s) => s.resolved.motion);
  const kind: TransitionKind = style === 'classic' || motion === 'off' ? 'none' : motion === 'reduced' ? 'vs-fade' : 'vs-glide';
  const mainRef = useRef<HTMLElement>(null);
  // Room shown by the last commit; differs from `room` only in the render that navigates to a new room.
  const committedRoom = useRef(room);
  // Reading the ref in render is intended: it holds the last committed room, updated only after commit.
  // eslint-disable-next-line react-hooks/refs
  const changingRoom = committedRoom.current !== room;

  const fallbackEntrance = useEffectEvent(() => {
    const el = mainRef.current;
    if (!el || kind === 'none' || typeof document.startViewTransition === 'function') return;
    const glide = kind === 'vs-glide';
    el.animate(
      glide
        ? [{ opacity: 0, transform: `translate3d(0, ${spaceTokens.page.enterShift}px, 0) scale(${spaceTokens.page.enterScale})` }, { opacity: 1, transform: 'none' }]
        : [{ opacity: 0 }, { opacity: 1 }],
      { duration: glide ? motionTokens.page : motionTokens.fade, easing: glide ? motionTokens.easingGlide : 'linear' },
    );
  });

  useLayoutEffect(() => {
    if (committedRoom.current === room) return;
    committedRoom.current = room;
    fallbackEntrance();
  }, [room]);

  return (
    <ViewTransition update={changingRoom ? kind : 'none'} enter="none" exit="none" share="none" default="none">
      <main ref={mainRef} id="main" {...props}>
        {children}
      </main>
    </ViewTransition>
  );
}
