import { z } from 'zod';
import type { DataScope, RoleKind } from './enums.js';

/**
 * PERMISSION MATRIX (role x resource x action). Single source of truth, enforced by API guards.
 * The UI hides what the API would reject, but the API decides.
 *
 * Permission string: `<resource>.<action>`, e.g. "leads.update".
 * Data visibility is NOT a permission: each role has a DataScope (own | team | all) that the API
 * applies to every list/detail query (Lead.ownerId, Task.assigneeId, Call.userId, Conversation.assigneeId).
 */
export const PERMISSION_MATRIX = {
  dashboard: ['read'],
  leads: ['read', 'create', 'update', 'delete', 'assign', 'bulk', 'merge', 'import', 'export'],
  pipeline: ['read', 'manage'],
  /** Custom object records (flexible data layer). Data scope applies via CustomRecord.ownerId. */
  records: ['read', 'create', 'update', 'delete'],
  tasks: ['read', 'create', 'update', 'delete'],
  calls: ['read', 'make', 'recordings'],
  messages: ['read', 'send', 'team_inbox'],
  templates: ['read', 'manage'],
  workflows: ['read', 'edit', 'publish', 'run'],
  webhooks: ['manage'],
  integrations: ['manage'],
  apikeys: ['manage'],
  reports: ['read'],
  teamfloor: ['read'],
  team: ['read', 'manage'],
  roles: ['manage'],
  targets: ['read', 'manage'],
  billing: ['read', 'manage'],
  settings: ['manage'],
  audit: ['read'],
  support_access: ['manage'],
  // change #19 wave B (SPEC 29.9). Data scope applies via ownerId (contacts, accounts, deals, quotations,
  // invoices) and organizerId / attendees (calendar).
  contacts: ['read', 'create', 'update', 'delete', 'merge'],
  accounts: ['read', 'create', 'update', 'delete', 'merge'],
  deals: ['read', 'create', 'update', 'delete'],
  products: ['read', 'manage'],
  quotations: ['read', 'create', 'update', 'send', 'delete'],
  invoices: ['read', 'create', 'update', 'issue', 'cancel', 'payments', 'delete'],
  calendar: ['read', 'create', 'update', 'delete'],
  routing: ['manage'],
  capture_forms: ['manage'],
} as const;

export type PermissionResource = keyof typeof PERMISSION_MATRIX;
export type Permission = {
  [R in PermissionResource]: `${R}.${(typeof PERMISSION_MATRIX)[R][number]}`;
}[PermissionResource];

export const PERMISSIONS = (Object.entries(PERMISSION_MATRIX) as Array<[PermissionResource, readonly string[]]>).flatMap(
  ([resource, actions]) => actions.map((a) => `${resource}.${a}` as Permission),
);
export const PermissionSchema = z.enum(PERMISSIONS as [Permission, ...Permission[]]);

const ALL: Permission[] = [...PERMISSIONS];

/** Defaults for the four system roles. Company admins build custom roles from the matrix. */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKind, Permission[]> = {
  company_admin: ALL,
  manager: [
    'dashboard.read',
    'leads.read', 'leads.create', 'leads.update', 'leads.assign', 'leads.bulk', 'leads.merge', 'leads.export',
    'pipeline.read',
    'records.read', 'records.create', 'records.update',
    'tasks.read', 'tasks.create', 'tasks.update', 'tasks.delete',
    'calls.read', 'calls.make', 'calls.recordings',
    'messages.read', 'messages.send', 'messages.team_inbox',
    'templates.read',
    'workflows.read',
    'reports.read',
    'teamfloor.read',
    'team.read',
    'targets.read', 'targets.manage',
    'contacts.read', 'contacts.create', 'contacts.update', 'contacts.merge',
    'accounts.read', 'accounts.create', 'accounts.update', 'accounts.merge',
    'deals.read', 'deals.create', 'deals.update',
    'products.read',
    'quotations.read', 'quotations.create', 'quotations.update', 'quotations.send',
    'invoices.read', 'invoices.create', 'invoices.update', 'invoices.issue', 'invoices.payments',
    'calendar.read', 'calendar.create', 'calendar.update', 'calendar.delete',
  ],
  employee: [
    'leads.read', 'leads.create', 'leads.update',
    'pipeline.read',
    'records.read', 'records.create', 'records.update',
    'tasks.read', 'tasks.create', 'tasks.update',
    'calls.read', 'calls.make', 'calls.recordings',
    'messages.read', 'messages.send',
    'templates.read',
    'reports.read',
    'teamfloor.read',
    'targets.read',
    'contacts.read', 'contacts.create', 'contacts.update',
    'accounts.read', 'accounts.create', 'accounts.update',
    'deals.read', 'deals.create', 'deals.update',
    'products.read',
    'quotations.read', 'quotations.create', 'quotations.update', 'quotations.send',
    'invoices.read',
    'calendar.read', 'calendar.create', 'calendar.update', 'calendar.delete',
  ],
  viewer: ['dashboard.read', 'leads.read', 'pipeline.read', 'records.read', 'reports.read', 'contacts.read', 'accounts.read', 'deals.read', 'products.read', 'quotations.read', 'invoices.read', 'calendar.read'],
};

/**
 * Permissions added to the SYSTEM roles of existing workspaces by migration 20261103000000_change19b_crm
 * (custom roles are left alone; company admins add them in the matrix).
 */
export const CHANGE_19B_PERMISSIONS: readonly Permission[] = (Object.keys(PERMISSION_MATRIX) as PermissionResource[])
  .filter((r) => ['contacts', 'accounts', 'deals', 'products', 'quotations', 'invoices', 'calendar', 'routing', 'capture_forms'].includes(r))
  .flatMap((r) => (PERMISSION_MATRIX[r] as readonly string[]).map((a) => `${r}.${a}` as Permission));

export const DEFAULT_ROLE_SCOPE: Record<RoleKind, DataScope> = {
  company_admin: 'all',
  manager: 'team',
  employee: 'own',
  viewer: 'all',
};

export const ROLE_KIND_LABELS: Record<RoleKind, string> = {
  company_admin: 'Company admin',
  manager: 'Manager',
  employee: 'Employee',
  viewer: 'Viewer',
};

/** System role keys (Role.key) created for every workspace; custom roles use other slugs. */
export const SYSTEM_ROLE_KEYS: Record<RoleKind, string> = {
  company_admin: 'company_admin',
  manager: 'manager',
  employee: 'employee',
  viewer: 'viewer',
};

/** Permissions a company admin can never remove from the company_admin system role (lock-out guard). */
export const LOCKED_ADMIN_PERMISSIONS: Permission[] = ['roles.manage', 'team.manage', 'settings.manage'];

/** Prefix of every public API key (plaintext shown once; SHA-256 stored). */
export const API_KEY_PREFIX = 'vst_live_';

/** API key scopes (public REST API). Subset of permissions usable by machines. */
export const API_KEY_SCOPES = [
  'leads.read',
  'leads.create',
  'leads.update',
  'tasks.read',
  'tasks.create',
  'tasks.update',
  'calls.read',
  'messages.read',
  'messages.send',
  'workflows.read',
] as const satisfies readonly Permission[];
export const ApiKeyScopeSchema = z.enum(API_KEY_SCOPES);
export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;

export function hasPermission(granted: readonly string[], required: Permission | readonly Permission[]): boolean {
  const list = (Array.isArray(required) ? required : [required]) as Permission[];
  return list.every((p) => granted.includes(p));
}

export function hasAnyPermission(granted: readonly string[], anyOf: readonly Permission[]): boolean {
  return anyOf.some((p) => granted.includes(p));
}

// ---------------------------------------------------------------- platform (Super Admin)

/** Super Admin permissions. Only valid on tokens with audience "platform". */
export const PLATFORM_PERMISSIONS = [
  'platform.overview.read',
  'platform.companies.read',
  'platform.companies.manage',
  'platform.plans.manage',
  'platform.billing.manage',
  'platform.usage.read',
  'platform.flags.manage',
  'platform.packs.manage',
  'platform.health.read',
  'platform.analytics.read',
  'platform.support.impersonate',
  'platform.content.manage',
  'platform.audit.read',
  'platform.system.manage',
  'platform.admins.manage',
] as const;
export const PlatformPermissionSchema = z.enum(PLATFORM_PERMISSIONS);
export type PlatformPermission = z.infer<typeof PlatformPermissionSchema>;

/**
 * Feature flags (per plan, overridable per company by Super Admin).
 * custom_domain: off in every plan; the Super Admin switches it on per company (D-060).
 * field_tracking: attendance and GPS for field staff (D-063); on for growth and enterprise by default.
 */
export const FEATURE_FLAGS = ['team_floor_3d', 'ai_node', 'telephony', 'api_access', 'whatsapp', 'employee_rank', 'custom_domain', 'field_tracking'] as const;
export const FeatureFlagSchema = z.enum(FEATURE_FLAGS);
export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;
export type FeatureFlags = Record<FeatureFlag, boolean>;

/** Plan limits enforced by the API (usage metering). null = unlimited. */
export const PlanLimitsSchema = z.object({
  seats: z.number().int().nullable(),
  leads: z.number().int().nullable(),
  whatsappMessagesPerMonth: z.number().int().nullable(),
  workflowRunsPerMonth: z.number().int().nullable(),
  storageMb: z.number().int().nullable(),
});
export type PlanLimits = z.infer<typeof PlanLimitsSchema>;
