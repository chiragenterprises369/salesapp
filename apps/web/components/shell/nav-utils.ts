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
 * Company sidebar for this user. Items with children (Settings) link to their first visible child so
 * a role with only some settings permissions never lands on a page it cannot open.
 * Pass `groups` already composed with useNavExtensions().company(NAV_COMPANY) (objects, pack pages, labels).
 */
export function companyNav(me: MeResponse, groups: readonly NavGroup[] = NAV_COMPANY): NavGroup[] {
  return visibleNav(groups, navContext(me)).map((g) => ({
    ...g,
    items: g.items.map((i) => (i.children?.length ? { ...i, href: i.children[0]!.href } : i)),
  }));
}

/** Settings sub-navigation (children of the Settings item) for this user. */
export function settingsNav(me: MeResponse): NavItem[] {
  const settings = visibleNav(NAV_COMPANY, navContext(me))
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
  return visibleNav(NAV_SUPER_ADMIN, { permissions: admin.permissions });
}

/** Flat list (with parent label) for the command menu. */
export function flattenNav(groups: readonly NavGroup[]): Array<NavItem & { group: string | null }> {
  return groups.flatMap((g) =>
    g.items.flatMap((i) => (i.children?.length ? i.children.map((c) => ({ ...c, group: i.label })) : [{ ...i, group: g.label }])),
  );
}
