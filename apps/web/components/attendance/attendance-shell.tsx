'use client';

import { MapPin } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { cn } from '@/lib/cn';
import { useMe } from '@/lib/session/session';

const TABS = [
  { href: '/app/attendance', label: 'Register' },
  { href: '/app/attendance/live', label: 'Live map' },
  { href: '/app/attendance/routes', label: 'Routes' },
] as const;

/**
 * Attendance pages of the company panel (D-063): register, live field map, routes. Admins and managers
 * (team.read); managers see their team. Needs the `field_tracking` feature (Super Admin switch).
 */
export function AttendanceShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const pathname = usePathname();
  const enabled = !!me?.workspace.features.field_tracking;
  return (
    <RequirePermission anyOf={['team.read']}>
      <PageHeader
        title="Attendance"
        description="Check-ins, hours and field routes of your field staff. Tracking runs only while they are checked in, inside working hours."
        className="mb-3"
      />
      <nav aria-label="Attendance" className="mb-4">
        <ul className="inline-flex rounded-md border border-border bg-surface p-0.5 shadow-card">
          {TABS.map((t) => {
            const current = t.href === '/app/attendance' ? pathname === t.href : pathname.startsWith(t.href);
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'focus-ring inline-flex h-8 items-center rounded-sm px-3 text-sm font-medium transition-colors duration-150 ease-standard',
                    current ? 'bg-accent-soft text-accent-soft-fg' : 'text-fg-secondary hover:bg-surface-2 hover:text-fg',
                  )}
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {enabled ? (
        children
      ) : (
        <EmptyState
          icon={<MapPin />}
          title="Field tracking is off for your company"
          description="Attendance and GPS routes come with the field tracking feature. Ask Vistar support to switch it on for your company."
        />
      )}
    </RequirePermission>
  );
}
