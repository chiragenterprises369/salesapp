'use client';

import {
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_ROLE_SCOPE,
  PERMISSION_MATRIX,
  ROLE_KIND_LABELS,
  ROLE_KINDS,
  SYSTEM_ROLE_KEYS,
  type DataScope,
  type Permission,
  type PermissionResource,
  type Role,
  type RoleCreate,
} from '@vistar/shared';
import { EMPLOYEE_FIXTURES } from '@vistar/shared/fixtures';
import { create } from 'zustand';

/** Labels for the permission matrix (resource rows, action columns). */
export const RESOURCE_LABELS: Record<PermissionResource, { label: string; hint: string }> = {
  dashboard: { label: 'Dashboard', hint: 'KPIs, funnel and live feed' },
  leads: { label: 'Leads', hint: 'Lead records, owners and imports' },
  pipeline: { label: 'Pipeline', hint: 'Stages and the Board' },
  records: { label: 'Custom records', hint: 'Records of custom objects (e.g. Projects, Units)' },
  tasks: { label: 'Tasks', hint: 'Follow-ups and reminders' },
  calls: { label: 'Calls', hint: 'Click-to-call and recordings' },
  messages: { label: 'WhatsApp messages', hint: 'Chats with leads' },
  templates: { label: 'Message templates', hint: 'Approved WhatsApp templates' },
  workflows: { label: 'Workflows', hint: 'Automations' },
  webhooks: { label: 'Webhooks', hint: 'Event delivery to other systems' },
  integrations: { label: 'Integrations', hint: 'IndiaMART, WhatsApp, telephony' },
  apikeys: { label: 'API keys', hint: 'Access for other software' },
  reports: { label: 'Reports', hint: 'Performance reports' },
  teamfloor: { label: 'Team Floor', hint: 'Live view of the team' },
  team: { label: 'Team', hint: 'People and teams' },
  roles: { label: 'Roles', hint: 'This permission matrix' },
  targets: { label: 'Targets', hint: 'Monthly targets' },
  billing: { label: 'Billing', hint: 'Plan and invoices' },
  settings: { label: 'Workspace settings', hint: 'Hours, stages, fields, branding' },
  audit: { label: 'Audit log', hint: 'Who changed what' },
  support_access: { label: 'Support access', hint: 'Let Vistar support view the workspace' },
};

export const ACTION_LABELS: Record<string, string> = {
  read: 'View',
  create: 'Create',
  update: 'Edit',
  edit: 'Edit',
  delete: 'Delete',
  manage: 'Manage',
  assign: 'Assign',
  bulk: 'Bulk edit',
  merge: 'Merge',
  import: 'Import',
  export: 'Export',
  make: 'Make calls',
  recordings: 'Recordings',
  send: 'Send',
  team_inbox: 'Team inbox',
  publish: 'Publish',
  run: 'Run',
};

export const SCOPE_LABELS: Record<DataScope, { label: string; sentence: string }> = {
  own: { label: 'Own records', sentence: 'Only the leads, tasks, calls and chats assigned to them' },
  team: { label: 'Their team', sentence: 'Their own records plus those of the teams they manage' },
  all: { label: 'Whole workspace', sentence: 'Every record in the workspace' },
};

export const PERMISSION_RESOURCES = Object.keys(PERMISSION_MATRIX) as PermissionResource[];

const systemRoleId = (i: number) => `0190f5a0-0000-7000-8000-30000000000${i}`;

function systemRoles(): Role[] {
  return ROLE_KINDS.map((kind, i) => ({
    id: systemRoleId(i),
    key: SYSTEM_ROLE_KEYS[kind],
    name: ROLE_KIND_LABELS[kind],
    kind,
    dataScope: DEFAULT_ROLE_SCOPE[kind],
    permissions: [...DEFAULT_ROLE_PERMISSIONS[kind]],
    isSystem: true,
    memberCount: EMPLOYEE_FIXTURES.filter((e) => e.role === kind).length,
  }));
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'custom_role';

interface RolesState {
  roles: Role[];
  saveRole: (id: string, patch: { permissions: Permission[]; dataScope: DataScope }) => Promise<Role>;
  createRole: (input: RoleCreate) => Promise<Role>;
  deleteRole: (id: string) => Promise<void>;
}

const wait = () => new Promise((r) => setTimeout(r, 300));

/**
 * Wave 1 mock of GET/POST/PATCH/DELETE /roles. In memory for this browser tab (resets on reload).
 */
export const useRolesStore = create<RolesState>()((set, get) => ({
  roles: systemRoles(),
  saveRole: async (id, patch) => {
    await wait();
    const roles = get().roles.map((r) => (r.id === id ? { ...r, ...patch } : r));
    set({ roles });
    return roles.find((r) => r.id === id)!;
  },
  createRole: async (input) => {
    await wait();
    const taken = new Set(get().roles.map((r) => r.key));
    let key = slug(input.name);
    for (let n = 2; taken.has(key); n++) key = `${slug(input.name)}_${n}`;
    const role: Role = { id: crypto.randomUUID(), key, ...input, isSystem: false, memberCount: 0 };
    set({ roles: [...get().roles, role] });
    return role;
  },
  deleteRole: async (id) => {
    await wait();
    set({ roles: get().roles.filter((r) => r.id !== id || r.isSystem) });
  },
}));
