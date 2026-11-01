'use client';

import { NAV_EMPLOYEE_MORE } from '@vistar/shared';
import { Building2, ChevronRight, LogOut } from 'lucide-react';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { PageHeader } from '@/components/common/page-header';
import { NavIcon } from '@/components/shell/nav-icon';
import { employeeMoreNav } from '@/components/shell/nav-utils';
import { Card } from '@/components/ui/card';
import { useSignOut } from '@/lib/auth/use-auth';
import { useNavExtensions } from '@/lib/packs';
import { useMe } from '@/lib/session/session';

const HINT: Record<string, string> = {
  tasks: 'Follow-ups and reminders by due time',
  performance: 'Targets, calls and your progress this month',
  'team-floor': 'Who is free, on a call or on a break',
  status: 'Available, on call, on a break or offline',
  profile: 'Your name, phone and Team Floor avatar',
  preferences: 'Theme, motion and notifications',
};

const rowClass = 'focus-ring flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left outline-offset-[-2px] hover:bg-surface-2';

function MoreRow({ icon, label, hint, href, onClick }: { icon: ReactNode; label: string; hint?: string; href?: string; onClick?: () => void }) {
  const body = (
    <>
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-3 text-fg-secondary [&_svg]:size-5">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg">{label}</span>
        {hint && <span className="block truncate text-xs text-muted">{hint}</span>}
      </span>
      {href && <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />}
    </>
  );
  return href ? (
    <Link href={href} className={rowClass}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={rowClass}>
      {body}
    </button>
  );
}

/** "More" tab: everything that does not fit in the bottom navigation (NAV_EMPLOYEE_MORE + pack pages). */
export function MoreList() {
  const me = useMe()!;
  const { employeeMore } = useNavExtensions();
  const items = useMemo(() => employeeMoreNav(me, employeeMore(NAV_EMPLOYEE_MORE)), [me, employeeMore]);
  const signOut = useSignOut();
  return (
    <>
      <PageHeader title="More" description={`${me.user.name} · ${me.workspace.name}`} />
      <div className="flex flex-col gap-4">
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id}>
                <MoreRow icon={<NavIcon name={item.icon} />} label={item.label} hint={HINT[item.id]} href={item.href} />
              </li>
            ))}
          </ul>
        </Card>
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {me.role.kind === 'manager' && (
              <li>
                <MoreRow icon={<Building2 />} label="Company panel" hint="Dashboard, team and settings" href="/app" />
              </li>
            )}
            <li>
              <MoreRow icon={<LogOut />} label="Sign out" onClick={() => signOut()} />
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}
