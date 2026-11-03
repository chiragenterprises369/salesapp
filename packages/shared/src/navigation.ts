import type { RoleKind } from './enums.js';
import type { FeatureFlag, FeatureFlags, Permission, PlatformPermission } from './rbac.js';
import { DEFAULT_LABELS, type LabelKey, type ResolvedLabels } from './customization/labels.js';
import type { RuntimeNavItem, RuntimeObject } from './packs/runtime.js';

/**
 * PANELS AND NAVIGATION MAP. One Next.js app, three route groups:
 *   /super-admin/*  Super Admin panel (platform audience token only)
 *   /app/*          Company panel (company_admin, manager, viewer)
 *   /me/*           Employee panel (employee; managers may open it for their own work)
 * Shells render nav from these arrays filtered by visibleNav(); layouts guard with canEnterPanel().
 * The API is the source of truth: hiding an item is UX only.
 */
export type Panel = 'super-admin' | 'company' | 'employee';

export const PANEL_BASE_PATH: Record<Panel, string> = {
  'super-admin': '/super-admin',
  company: '/app',
  employee: '/me',
};

/** Which workspace role kinds may enter each workspace panel. */
export const PANEL_ACCESS: Record<Exclude<Panel, 'super-admin'>, readonly RoleKind[]> = {
  company: ['company_admin', 'manager', 'viewer'],
  employee: ['employee', 'manager'],
};

export type Principal =
  | { audience: 'platform' }
  | { audience: 'workspace'; kind: RoleKind };

/** Where to send a user after login. */
export function homePathFor(principal: Principal): string {
  if (principal.audience === 'platform') return '/super-admin';
  return principal.kind === 'employee' ? '/me' : '/app';
}

export function canEnterPanel(principal: Principal, panel: Panel): boolean {
  if (panel === 'super-admin') return principal.audience === 'platform';
  if (principal.audience !== 'workspace') return false;
  return PANEL_ACCESS[panel].includes(principal.kind);
}

export interface NavItem {
  id: string;
  label: string;
  href: string;
  /** lucide-react icon name */
  icon: string;
  /** Visible if the user has ANY of these. Omit = always visible inside the panel. */
  anyOf?: readonly (Permission | PlatformPermission)[];
  /** Hidden for these kinds even if permitted (e.g. viewer). */
  hideFor?: readonly RoleKind[];
  featureFlag?: FeatureFlag;
  children?: readonly NavItem[];
}

export interface NavGroup {
  id: string;
  label: string | null;
  items: readonly NavItem[];
}

export const NAV_SUPER_ADMIN: readonly NavGroup[] = [
  {
    id: 'platform',
    label: null,
    items: [
      { id: 'overview', label: 'Overview', href: '/super-admin', icon: 'LayoutDashboard', anyOf: ['platform.overview.read'] },
      { id: 'companies', label: 'Companies', href: '/super-admin/companies', icon: 'Building2', anyOf: ['platform.companies.read'] },
      { id: 'floors', label: 'Floors', href: '/super-admin/floors', icon: 'Building', anyOf: ['platform.companies.read'] },
      { id: 'plans', label: 'Plans', href: '/super-admin/plans', icon: 'CreditCard', anyOf: ['platform.plans.manage', 'platform.billing.manage'] },
      // ---- change #19 wave C: billing
      { id: 'billing', label: 'Billing', href: '/super-admin/billing', icon: 'ReceiptIndianRupee', anyOf: ['platform.billing.manage'] },
      { id: 'usage', label: 'Usage', href: '/super-admin/usage', icon: 'Gauge', anyOf: ['platform.usage.read'] },
      { id: 'flags', label: 'Feature flags', href: '/super-admin/flags', icon: 'ToggleRight', anyOf: ['platform.flags.manage'] },
      { id: 'packs', label: 'Industry packs', href: '/super-admin/packs', icon: 'Package', anyOf: ['platform.packs.manage'] },
      { id: 'health', label: 'Platform health', href: '/super-admin/health', icon: 'Activity', anyOf: ['platform.health.read'] },
      { id: 'analytics', label: 'Analytics', href: '/super-admin/analytics', icon: 'LineChart', anyOf: ['platform.analytics.read'] },
      { id: 'support', label: 'Support', href: '/super-admin/support', icon: 'LifeBuoy', anyOf: ['platform.support.impersonate'] },
      { id: 'content', label: 'Content', href: '/super-admin/content', icon: 'Library', anyOf: ['platform.content.manage'] },
      { id: 'audit', label: 'Audit log', href: '/super-admin/audit', icon: 'ScrollText', anyOf: ['platform.audit.read'] },
      // ---- change #20: config (registry groups, platform e-mail templates, go-live checklist; before System settings, request 3)
      {
        id: 'config',
        label: 'Config',
        href: '/super-admin/config',
        icon: 'SlidersHorizontal',
        anyOf: ['platform.system.manage'],
        children: [
          { id: 'config-groups', label: 'Settings and keys', href: '/super-admin/config', icon: 'KeyRound', anyOf: ['platform.system.manage'] },
          { id: 'config-email-templates', label: 'E-mail templates', href: '/super-admin/config/email-templates', icon: 'Mail', anyOf: ['platform.system.manage'] },
          { id: 'config-go-live', label: 'Go-live checklist', href: '/super-admin/config/go-live', icon: 'Rocket', anyOf: ['platform.system.manage'] },
        ],
      },
      // ---- end change #20: config
      { id: 'system', label: 'System settings', href: '/super-admin/system', icon: 'Settings', anyOf: ['platform.system.manage', 'platform.admins.manage'] },
    ],
  },
];

export const NAV_COMPANY: readonly NavGroup[] = [
  {
    id: 'work',
    label: 'Work',
    items: [
      { id: 'dashboard', label: 'Dashboard', href: '/app', icon: 'LayoutDashboard', anyOf: ['dashboard.read'] },
      { id: 'leads', label: 'Leads', href: '/app/leads', icon: 'Users', anyOf: ['leads.read'] },
      { id: 'inbox', label: 'Inbox', href: '/app/inbox', icon: 'MessageCircle', anyOf: ['messages.read'], hideFor: ['viewer'], featureFlag: 'whatsapp' },
      { id: 'calls', label: 'Calls', href: '/app/calls', icon: 'Phone', anyOf: ['calls.read'], hideFor: ['viewer'] },
      { id: 'tasks', label: 'Tasks', href: '/app/tasks', icon: 'ListTodo', anyOf: ['tasks.read'], hideFor: ['viewer'] },
      { id: 'calendar', label: 'Calendar', href: '/app/calendar', icon: 'CalendarDays', anyOf: ['calendar.read'] },
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    items: [
      { id: 'deals', label: 'Deals', href: '/app/deals', icon: 'Handshake', anyOf: ['deals.read'] },
      { id: 'contacts', label: 'Contacts', href: '/app/contacts', icon: 'Contact', anyOf: ['contacts.read'] },
      { id: 'accounts', label: 'Accounts', href: '/app/accounts', icon: 'Building2', anyOf: ['accounts.read'] },
      { id: 'quotations', label: 'Quotations', href: '/app/quotations', icon: 'FileText', anyOf: ['quotations.read'] },
      { id: 'invoices', label: 'Invoices', href: '/app/invoices', icon: 'ReceiptIndianRupee', anyOf: ['invoices.read'] },
      { id: 'products', label: 'Products', href: '/app/products', icon: 'Package', anyOf: ['products.read'] },
    ],
  },
  {
    id: 'automate',
    label: 'Automate',
    items: [
      { id: 'workflows', label: 'Workflows', href: '/app/workflows', icon: 'Workflow', anyOf: ['workflows.read'], hideFor: ['viewer'] },
      { id: 'webhooks', label: 'Webhooks and logs', href: '/app/webhooks', icon: 'Webhook', anyOf: ['webhooks.read', 'webhooks.manage'] },
    ],
  },
  {
    id: 'team',
    label: 'Team',
    items: [
      { id: 'team-floor', label: 'Live Team Floor', href: '/app/team-floor', icon: 'Building', anyOf: ['teamfloor.read'], hideFor: ['viewer'] },
      { id: 'attendance', label: 'Attendance', href: '/app/attendance', icon: 'MapPinned', anyOf: ['team.read'], hideFor: ['viewer'], featureFlag: 'field_tracking' },
      { id: 'team', label: 'Team and roles', href: '/app/team', icon: 'UsersRound', anyOf: ['team.read'], hideFor: ['viewer'] },
      { id: 'targets', label: 'Targets', href: '/app/targets', icon: 'Target', anyOf: ['targets.read'], hideFor: ['viewer'] },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [{ id: 'reports', label: 'Reports', href: '/app/reports', icon: 'BarChart3', anyOf: ['reports.read'] }],
  },
  {
    id: 'admin',
    label: 'Admin',
    items: [
      { id: 'integrations', label: 'Integrations', href: '/app/integrations', icon: 'Plug', anyOf: ['integrations.read', 'integrations.manage'] },
      { id: 'billing', label: 'Billing and usage', href: '/app/billing', icon: 'CreditCard', anyOf: ['billing.read', 'billing.manage'] },
      {
        id: 'settings',
        label: 'Settings',
        href: '/app/settings',
        icon: 'Settings',
        anyOf: ['settings.manage', 'roles.manage', 'pipeline.manage', 'templates.manage', 'audit.read', 'support_access.manage', 'routing.manage', 'capture_forms.manage', 'apikeys.manage', 'integrations.read', 'webhooks.read'],
        children: [
          { id: 'settings-workspace', label: 'Workspace', href: '/app/settings', icon: 'Building2', anyOf: ['settings.manage'] },
          { id: 'settings-branding', label: 'Branding', href: '/app/settings/branding', icon: 'Palette', anyOf: ['settings.manage'] },
          { id: 'settings-billing-profile', label: 'GST and billing', href: '/app/settings/billing-profile', icon: 'Landmark', anyOf: ['settings.manage'] },
          { id: 'settings-hours', label: 'Business hours', href: '/app/settings/hours', icon: 'Clock', anyOf: ['settings.manage'] },
          { id: 'settings-industry', label: 'Industry', href: '/app/settings/industry', icon: 'Factory', anyOf: ['settings.manage'] },
          { id: 'settings-stages', label: 'Pipeline stages', href: '/app/settings/stages', icon: 'Columns3', anyOf: ['pipeline.manage'] },
          { id: 'settings-fields', label: 'Custom fields', href: '/app/settings/fields', icon: 'TextCursorInput', anyOf: ['settings.manage'] },
          { id: 'settings-objects', label: 'Custom objects', href: '/app/settings/objects', icon: 'Boxes', anyOf: ['settings.manage'] },
          { id: 'settings-labels', label: 'Labels', href: '/app/settings/labels', icon: 'Type', anyOf: ['settings.manage'] },
          { id: 'settings-tags', label: 'Tags', href: '/app/settings/tags', icon: 'Tag', anyOf: ['settings.manage'] },
          { id: 'settings-templates', label: 'Templates', href: '/app/settings/templates', icon: 'MessageSquareText', anyOf: ['templates.manage'] },
          { id: 'settings-roles', label: 'Roles and permissions', href: '/app/settings/roles', icon: 'ShieldCheck', anyOf: ['roles.manage'] },
          { id: 'settings-visibility', label: 'Data visibility', href: '/app/settings/visibility', icon: 'Eye', anyOf: ['roles.manage'] },
          { id: 'settings-routing', label: 'Lead routing', href: '/app/settings/lead-routing', icon: 'Route', anyOf: ['routing.manage'] },
          { id: 'settings-lead-capture', label: 'Lead capture forms', href: '/app/settings/lead-capture', icon: 'ClipboardList', anyOf: ['capture_forms.manage'] },
          { id: 'settings-office-markers', label: 'Office markers', href: '/app/settings/office-markers', icon: 'ScanLine', anyOf: ['settings.manage'] },
          { id: 'settings-support', label: 'Support access', href: '/app/settings/support', icon: 'LifeBuoy', anyOf: ['support_access.manage'] },
          { id: 'settings-theme', label: 'Theme default', href: '/app/settings/theme', icon: 'SunMoon', anyOf: ['settings.manage'] },
          { id: 'settings-audit', label: 'Audit log', href: '/app/settings/audit', icon: 'ScrollText', anyOf: ['audit.read'] },
          // ---- change #19 wave C: hub
          { id: 'settings-api-keys', label: 'API keys', href: '/app/settings/api-keys', icon: 'KeyRound', anyOf: ['apikeys.manage'], featureFlag: 'api_access' },
          { id: 'settings-api-docs', label: 'API docs', href: '/app/settings/api-docs', icon: 'BookOpen', anyOf: ['apikeys.manage', 'integrations.read', 'webhooks.read'] },
          // ---- change #20: config (request 3)
          { id: 'settings-setup', label: 'Setup', href: '/app/settings/setup', icon: 'ListChecks', anyOf: ['settings.manage'] },
          { id: 'settings-email-templates', label: 'Email templates', href: '/app/settings/email-templates', icon: 'Mail', anyOf: ['templates.manage'] },
          { id: 'settings-whatsapp-templates', label: 'WhatsApp templates', href: '/app/settings/whatsapp-templates', icon: 'MessageCircle', anyOf: ['templates.manage'], featureFlag: 'whatsapp' },
          // ---- end change #20: config
        ],
      },
    ],
  },
];

/** Employee panel: mobile-first bottom navigation (5 slots). "More" opens the sheet below. */
export const NAV_EMPLOYEE_BOTTOM: readonly NavItem[] = [
  { id: 'home', label: 'Home', href: '/me', icon: 'House' },
  { id: 'leads', label: 'Leads', href: '/me/leads', icon: 'Users', anyOf: ['leads.read'] },
  { id: 'calls', label: 'Calls', href: '/me/calls', icon: 'Phone', anyOf: ['calls.read'] },
  { id: 'inbox', label: 'Inbox', href: '/me/inbox', icon: 'MessageCircle', anyOf: ['messages.read'], featureFlag: 'whatsapp' },
  { id: 'more', label: 'More', href: '/me/more', icon: 'Menu' },
];

export const NAV_EMPLOYEE_MORE: readonly NavItem[] = [
  { id: 'tasks', label: 'Tasks and reminders', href: '/me/tasks', icon: 'ListTodo', anyOf: ['tasks.read'] },
  { id: 'performance', label: 'My performance', href: '/me/performance', icon: 'Trophy', anyOf: ['reports.read'] },
  { id: 'team-floor', label: 'Team Floor', href: '/me/team-floor', icon: 'Building', anyOf: ['teamfloor.read'] },
  { id: 'status', label: 'My status', href: '/me/status', icon: 'CircleDot' },
  { id: 'profile', label: 'Profile and avatar', href: '/me/profile', icon: 'UserRound' },
  { id: 'preferences', label: 'Notifications and theme', href: '/me/preferences', icon: 'SlidersHorizontal' },
];

export interface NavContext {
  permissions: readonly string[];
  kind?: RoleKind;
  flags?: Partial<FeatureFlags>;
}

export function isNavItemVisible(item: NavItem, ctx: NavContext): boolean {
  if (item.hideFor && ctx.kind && item.hideFor.includes(ctx.kind)) return false;
  if (item.featureFlag && ctx.flags && ctx.flags[item.featureFlag] === false) return false;
  if (item.anyOf && !item.anyOf.some((p) => ctx.permissions.includes(p))) return false;
  return true;
}

/** Filter a nav tree for the current user; empty groups are dropped. */
export function visibleNav(groups: readonly NavGroup[], ctx: NavContext): NavGroup[] {
  return groups
    .map((g) => ({
      ...g,
      items: g.items
        .filter((i) => isNavItemVisible(i, ctx))
        .map((i) => (i.children ? { ...i, children: i.children.filter((c) => isNavItemVisible(c, ctx)) } : i)),
    }))
    .filter((g) => g.items.length > 0);
}

/** Employee self-service status control (feeds presence and the Team Floor). */
export const EMPLOYEE_STATUS_CONTROL = [
  { status: 'idle', label: 'Available' },
  { status: 'on_call', label: 'On call' },
  { status: 'away', label: 'Break' },
  { status: 'offline', label: 'Offline' },
] as const;

// ---------------------------------------------------------------- extension points (Industry Packs, custom objects, labels)

/** Route of a pack page: /app/x/<packKey>/<page> (company) or /me/x/<packKey>/<page> (employee). */
export function packPageHref(panel: 'company' | 'employee', packKey: string, page: string): string {
  return `${panel === 'company' ? '/app' : '/me'}/x/${packKey}/${page}`;
}

/** Records page of a custom object. */
export const objectRecordsHref = (objectKey: string) => `/app/objects/${objectKey}`;

const packNavItem = (panel: 'company' | 'employee', i: RuntimeNavItem): NavItem => ({
  id: `pack-${i.packKey}-${i.id}`,
  label: i.label,
  href: packPageHref(panel, i.packKey, i.page),
  icon: i.icon,
  ...(i.anyOf.length ? { anyOf: i.anyOf } : {}),
});

/** Company nav + pack navigation items (appended to the item's group). Filter with visibleNav() afterwards. */
export function withPackNavigation(groups: readonly NavGroup[], items: readonly RuntimeNavItem[]): NavGroup[] {
  const company = items.filter((i) => i.panels.includes('company'));
  return groups.map((g) => {
    const extra = company.filter((i) => i.group === g.id).map((i) => packNavItem('company', i));
    return extra.length ? { ...g, items: [...g.items, ...extra] } : g;
  });
}

/** Employee "More" sheet + pack items that target the employee panel. */
export function withPackEmployeeNavigation(more: readonly NavItem[], items: readonly RuntimeNavItem[]): NavItem[] {
  return [...more, ...items.filter((i) => i.panels.includes('employee')).map((i) => packNavItem('employee', i))];
}

/** Company nav + custom objects that have showInNav (added to the "work" group, after Leads). */
export function withObjectNavigation(groups: readonly NavGroup[], objects: readonly RuntimeObject[]): NavGroup[] {
  const extra: NavItem[] = objects
    .filter((o) => o.showInNav)
    .map((o) => ({ id: `object-${o.key}`, label: o.labelPlural, href: objectRecordsHref(o.key), icon: o.icon, anyOf: ['records.read'] }));
  if (!extra.length) return [...groups];
  return groups.map((g) => {
    if (g.id !== 'work') return g;
    const at = g.items.findIndex((i) => i.id === 'leads') + 1;
    return { ...g, items: [...g.items.slice(0, at), ...extra, ...g.items.slice(at)] };
  });
}

/** Nav item ids whose label follows a configurable label (e.g. "Leads" -> "Enquiries"). */
export const NAV_LABEL_KEYS: Readonly<Record<string, LabelKey>> = { leads: 'lead', tasks: 'task', calls: 'call' };

/** Replace the default plural in a nav label with the workspace label ("Tasks and reminders" -> "Follow-ups and reminders"). */
export function labelNavItem<T extends NavItem>(item: T, labels: ResolvedLabels): T {
  const key = NAV_LABEL_KEYS[item.id];
  const children = item.children?.map((c) => labelNavItem(c, labels));
  if (!key) return children ? { ...item, children } : item;
  const label = item.label.replace(DEFAULT_LABELS[key].plural, labels[key].plural);
  return { ...item, label, ...(children ? { children } : {}) };
}

export function withNavLabels(groups: readonly NavGroup[], labels: ResolvedLabels): NavGroup[] {
  return groups.map((g) => ({ ...g, items: g.items.map((i) => labelNavItem(i, labels)) }));
}
