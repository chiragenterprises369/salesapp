'use client';

import { NAV_COMPANY, type NavItem } from '@vistar/shared';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { NativeSelect } from '@/components/common/native-select';
import { PageHeader } from '@/components/common/page-header';
import { NavIcon } from '@/components/shell/nav-icon';
import { settingsNav, withChange19Nav } from '@/components/shell/nav-utils';
import { useMe } from '@/lib/session/session';

const SETTINGS_ITEM = withChange19Nav(NAV_COMPANY)
  .flatMap((g) => g.items)
  .find((i) => i.id === 'settings')!;

/** Nav child for a settings page (title, permission). */
export function settingsChild(id: string): NavItem {
  return SETTINGS_ITEM.children!.find((c) => c.id === id)!;
}

function isCurrent(pathname: string, href: string) {
  return href === '/app/settings' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/** Settings area: sub-navigation from the Settings nav children (list on desktop, picker on small screens). */
export function SettingsLayout({ children }: { children: ReactNode }) {
  const me = useMe()!;
  const pathname = usePathname();
  const router = useRouter();
  const items = useMemo(() => settingsNav(me), [me]);
  const current = items.find((i) => isCurrent(pathname, i.href));

  return (
    <RequirePermission anyOf={SETTINGS_ITEM.anyOf ?? []}>
      {/* Fills the main area on wide screens (D-066): the nav column stays fixed, the page grows. */}
      <div className="flex flex-col gap-5 lg:flex-row lg:gap-8">
        <aside className="shrink-0 lg:w-52">
          <p className="mb-2 hidden px-2 text-xs font-medium text-muted-strong lg:block" id="settings-nav-label">
            Settings
          </p>
          <nav aria-labelledby="settings-nav-label" className="hidden lg:block">
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => {
                const active = item === current;
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      data-slot="subnav-item"
                      aria-current={active ? 'page' : undefined}
                      className="focus-ring flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-fg-secondary transition-colors hover:bg-surface-3 hover:text-fg aria-[current=page]:bg-accent-soft aria-[current=page]:font-medium aria-[current=page]:text-accent-soft-fg"
                    >
                      <NavIcon name={item.icon} className="text-current" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="lg:hidden">
            <label htmlFor="settings-section" className="mb-1 block text-xs font-medium text-fg-secondary">
              Settings section
            </label>
            <NativeSelect id="settings-section" value={current?.href ?? ''} onChange={(e) => router.push(e.target.value)}>
              {items.map((item) => (
                <option key={item.id} value={item.href}>
                  {item.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </RequirePermission>
  );
}

/** One settings page: permission guard from its nav item + page header. */
export function SettingsPage({ id, description, actions, children }: { id: string; description: string; actions?: ReactNode; children: ReactNode }) {
  const item = settingsChild(id);
  return (
    <RequirePermission anyOf={item.anyOf ?? []}>
      <PageHeader title={item.label} description={description} actions={actions} />
      <div className="flex flex-col gap-4">{children}</div>
    </RequirePermission>
  );
}
