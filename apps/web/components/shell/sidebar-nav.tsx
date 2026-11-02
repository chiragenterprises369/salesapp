'use client';

import type { NavGroup } from '@vistar/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tooltip } from '@/components/common/tooltip';
import { cn } from '@/lib/cn';
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

/** Grouped panel navigation, expanded or as an icon rail. Active item: aria-current="page". */
export function SidebarNav({ groups, expanded, density = 'default', onNavigate, label }: SidebarNavProps) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="flex flex-col gap-4">
      {groups.map((group, gi) => (
        <div key={group.id} className="flex flex-col gap-0.5">
          {group.label &&
            (expanded ? (
              <p data-slot="nav-group-label" className="px-2 pb-1 text-xs font-medium text-muted">{group.label}</p>
            ) : (
              gi > 0 && <span aria-hidden className="mx-auto mb-1 h-px w-6 bg-border" />
            ))}
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isItemActive(pathname, item);
              const link = (
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  data-slot="nav-item"
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'focus-ring group flex items-center rounded-md text-fg-secondary transition-colors duration-150 ease-standard',
                    'hover:bg-surface-3 hover:text-fg aria-[current=page]:bg-accent-soft aria-[current=page]:font-medium aria-[current=page]:text-accent-soft-fg',
                    'neon:aria-[current=page]:edge-glow',
                    density === 'dense' ? 'h-7 text-sm' : 'h-8 text-sm',
                    expanded ? 'gap-2.5 px-2' : 'mx-auto size-9 justify-center',
                  )}
                >
                  <NavIcon name={item.icon} className="text-current" />
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
