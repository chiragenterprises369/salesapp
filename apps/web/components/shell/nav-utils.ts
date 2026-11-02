import {
  isNavItemVisible,
  NAV_COMPANY,
  NAV_EMPLOYEE_BOTTOM,
  NAV_EMPLOYEE_MORE,
  NAV_SUPER_ADMIN,
  visibleNav,
  type MeResponse,
  type NavGroup,
  type NavItem,
  type PlatformAdmin,
} from '@vistar/shared';
import { customDomainEnabled } from '@/lib/branding/custom-domain';

const PANEL_ROOTS = new Set(['/app', '/me', '/super-admin']);

/** Panel roots match exactly; everything else matches its subtree. */
export function isActivePath(pathname: string, href: string): boolean {
  if (PANEL_ROOTS.has(href)) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Active state for a nav item, including its children (Settings sub-pages). */
export function isItemActive(pathname: string, item: NavItem): boolean {
  if (isActivePath(pathname, item.href)) return true;
  return !!item.children?.some((c) => isActivePath(pathname, c.href));
}

export function navContext(me: MeResponse) {
  return { permissions: me.permissions, kind: me.role.kind, flags: me.workspace.features };
}

/**
 * ADAPTER (change #19) until the shared navigation has these items (requests-19.md): Settings >
 * Component design (company admins, D-059), Settings > Domain (only when the Super Admin enabled
 * custom domains for the company, D-060) and the Super Admin Config section (SPEC 29.6).
 */
export const SETTINGS_DESIGN_ITEM: NavItem = {
  id: 'settings-design',
  label: 'Component design',
  href: '/app/settings/design',
  icon: 'LayoutTemplate',
  anyOf: ['settings.manage'],
  hideFor: ['manager', 'viewer', 'employee'],
};
export const SETTINGS_DOMAIN_ITEM: NavItem = { id: 'settings-domain', label: 'Domain', href: '/app/settings/domain', icon: 'Globe', anyOf: ['settings.manage'] };
export const SUPER_ADMIN_CONFIG_ITEM: NavItem = { id: 'config', label: 'Config', href: '/super-admin/config', icon: 'Wrench', anyOf: ['platform.system.manage'] };

export function withChange19Nav(groups: readonly NavGroup[]): NavGroup[] {
  return groups.map((g) => ({
    ...g,
    items: g.items.map((i) => {
      if (i.id !== 'settings' || !i.children) return i;
      const extra = [SETTINGS_DESIGN_ITEM, SETTINGS_DOMAIN_ITEM].filter((x) => !i.children!.some((c) => c.id === x.id));
      if (!extra.length) return i;
      const at = i.children.findIndex((c) => c.id === 'settings-branding') + 1 || i.children.length;
      return { ...i, children: [...i.children.slice(0, at), ...extra, ...i.children.slice(at)] };
    }),
  }));
}

function dropDisabled(groups: NavGroup[], me: MeResponse): NavGroup[] {
  if (customDomainEnabled(me.workspace)) return groups;
  return groups.map((g) => ({ ...g, items: g.items.map((i) => (i.children ? { ...i, children: i.children.filter((c) => c.id !== SETTINGS_DOMAIN_ITEM.id) } : i)) }));
}

/**
 * Company sidebar for this user. Items with children (Settings) link to their first visible child so
 * a role with only some settings permissions never lands on a page it cannot open.
 * Pass `groups` already composed with useNavExtensions().company(NAV_COMPANY) (objects, pack pages, labels).
 */
export function companyNav(me: MeResponse, groups: readonly NavGroup[] = NAV_COMPANY): NavGroup[] {
  return dropDisabled(visibleNav(withChange19Nav(groups), navContext(me)), me).map((g) => ({
    ...g,
    items: g.items.map((i) => (i.children?.length ? { ...i, href: i.children[0]!.href } : i)),
  }));
}

/** Settings sub-navigation (children of the Settings item) for this user. */
export function settingsNav(me: MeResponse): NavItem[] {
  const settings = dropDisabled(visibleNav(withChange19Nav(NAV_COMPANY), navContext(me)), me)
    .flatMap((g) => g.items)
    .find((i) => i.id === 'settings');
  return [...(settings?.children ?? [])];
}

/** Pass items composed with useNavExtensions().employeeBottom(NAV_EMPLOYEE_BOTTOM) for configurable labels. */
export function employeeBottomNav(me: MeResponse, items: readonly NavItem[] = NAV_EMPLOYEE_BOTTOM): NavItem[] {
  return items.filter((i) => isNavItemVisible(i, navContext(me)));
}

/** Pass items composed with useNavExtensions().employeeMore(NAV_EMPLOYEE_MORE) for pack pages and labels. */
export function employeeMoreNav(me: MeResponse, items: readonly NavItem[] = NAV_EMPLOYEE_MORE): NavItem[] {
  return items.filter((i) => isNavItemVisible(i, navContext(me)));
}

export function superAdminNav(admin: PlatformAdmin): NavGroup[] {
  const groups = NAV_SUPER_ADMIN.some((g) => g.items.some((i) => i.id === SUPER_ADMIN_CONFIG_ITEM.id))
    ? NAV_SUPER_ADMIN
    : NAV_SUPER_ADMIN.map((g, gi) => {
        if (gi !== 0) return g;
        const at = g.items.findIndex((i) => i.id === 'system');
        const items = at < 0 ? [...g.items, SUPER_ADMIN_CONFIG_ITEM] : [...g.items.slice(0, at), SUPER_ADMIN_CONFIG_ITEM, ...g.items.slice(at)];
        return { ...g, items };
      });
  return visibleNav(groups, { permissions: admin.permissions });
}

/** Flat list (with parent label) for the command menu. */
export function flattenNav(groups: readonly NavGroup[]): Array<NavItem & { group: string | null }> {
  return groups.flatMap((g) =>
    g.items.flatMap((i) => (i.children?.length ? i.children.map((c) => ({ ...c, group: i.label })) : [{ ...i, group: g.label }])),
  );
}
