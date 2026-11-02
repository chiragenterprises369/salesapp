'use client';

import type { NavGroup, NavItem } from '@vistar/shared';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import { isActivePath } from './nav-utils';

interface Crumb {
  label: string;
  href?: string;
}

/** Longest nav match for the path: group > item > child (Settings pages). */
export function crumbsFor(pathname: string, groups: readonly NavGroup[], root: Crumb): Crumb[] {
  let best: { group: NavGroup; item: NavItem; child?: NavItem; len: number } | null = null;
  for (const group of groups)
    for (const item of group.items) {
      for (const child of item.children ?? []) {
        if (isActivePath(pathname, child.href) && (!best || child.href.length > best.len)) best = { group, item, child, len: child.href.length };
      }
      if (isActivePath(pathname, item.href) && (!best || item.href.length > best.len)) best = { group, item, len: item.href.length };
    }
  if (!best) return [root];
  const out: Crumb[] = [root];
  if (best.group.label) out.push({ label: best.group.label });
  if (best.child) {
    out.push({ label: best.item.label, href: best.item.href });
    out.push({ label: best.child.label, href: best.child.href });
  } else out.push({ label: best.item.label, href: best.item.href });
  return out;
}

/**
 * Where am I: panel > group > page (> sub-page), in the Premium top bar. The last crumb is the
 * current page (aria-current); earlier ones link back up.
 */
export function ShellBreadcrumbs({ groups, root, className }: { groups: readonly NavGroup[]; root: Crumb; className?: string }) {
  const pathname = usePathname();
  const crumbs = useMemo(() => crumbsFor(pathname, groups, root), [pathname, groups, root]);
  return (
    <nav aria-label="Breadcrumb" data-slot="breadcrumbs" className={cn('min-w-0 items-center', className)}>
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${c.label}-${i}`} className={cn('flex min-w-0 items-center gap-1', !last && 'shrink-0')}>
              {i > 0 && <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted" />}
              {last ? (
                <span aria-current="page" className="truncate font-medium text-fg">
                  {c.label}
                </span>
              ) : c.href ? (
                <Link href={c.href} className="focus-ring truncate rounded-xs text-fg-secondary hover:text-fg">
                  {c.label}
                </Link>
              ) : (
                <span className="truncate text-muted-strong">{c.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
