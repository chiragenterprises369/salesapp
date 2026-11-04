'use client';

import type { NavGroup } from '@vistar/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Tooltip } from '@/components/common/tooltip';
import { cn } from '@/lib/cn';
import { animateNavPill } from '@/lib/rivet-motion';
import { NavIcon } from './nav-icon';
import { isItemActive } from './nav-utils';

interface SidebarNavProps {
  groups: readonly NavGroup[];
  /** false = icon rail (labels in tooltips and for screen readers). */
  expanded: boolean;
  density?: 'default' | 'dense';
  onNavigate?: () => void;
  label: string;
}

/** Grouped panel navigation, expanded or as an icon rail. Active item has sliding fluid pill. */
export function SidebarNav({ groups, expanded, density = 'default', onNavigate, label }: SidebarNavProps) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (!navRef.current || !pillRef.current) return;
    const activeEl = navRef.current.querySelector<HTMLElement>('[data-slot="nav-item"][aria-current="page"]');
    animateNavPill(pillRef.current, navRef.current, activeEl, firstRender.current, 10);
    firstRender.current = false;
  }, [pathname, expanded, groups]);

  return (
    <nav ref={navRef} aria-label={label} className="relative flex flex-col gap-4">
      {/* Rivet sliding active indicator pill */}
      <span ref={pillRef} className="nav__pill" aria-hidden="true" />

      {groups.map((group, gi) => (
        <div key={group.id} className="relative z-[1] flex flex-col gap-1">
          {group.label &&
            (expanded ? (
              <p data-slot="nav-group-label" className="px-3 pt-3 pb-1 text-[11px] font-bold tracking-[0.1em] uppercase text-faint">
                {group.label}
              </p>
            ) : (
              gi > 0 && <span aria-hidden className="mx-auto my-1.5 h-px w-6 bg-hair" />
            ))}
          <ul className="flex flex-col gap-1">
            {group.items.map((item) => {
              const active = isItemActive(pathname, item);
              const link = (
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  data-slot="nav-item"
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'focus-ring group relative z-[1] flex items-center rounded-[10px] font-semibold text-dim transition-colors duration-200 ease-[var(--ease)]',
                    'hover:text-ink aria-[current=page]:text-ink aria-[current=page]:font-semibold',
                    '[&_svg]:transition-colors [&_svg]:duration-200 aria-[current=page]:[&_svg]:text-accent-text',
                    expanded ? 'h-10 gap-3 px-3 text-[13.5px]' : 'mx-auto size-10 justify-center',
                  )}
                >
                  <NavIcon name={item.icon} className="size-[18px] shrink-0 text-faint group-hover:text-ink aria-[current=page]:text-accent-text" />
                  <span className={cn(expanded ? 'truncate' : 'sr-only')}>{item.label}</span>
                </Link>
              );
              return (
                <li key={item.id}>
                  {expanded ? (
                    link
                  ) : (
                    <Tooltip content={item.label} delayDuration={150}>
                      {link}
                    </Tooltip>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
