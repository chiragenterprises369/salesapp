'use client';

import { labelOf, type Permission } from '@vistar/shared';
import { House, LayoutDashboard, ListTodo, MessageCircle, Phone, Users, type LucideIcon } from 'lucide-react';
import dynamic from 'next/dynamic';
import { Suspense, useMemo, type ComponentType, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useLabels } from '@/lib/customization';
import { usePermissions } from '@/lib/session/session';
import type { PanelKind } from './links';
import type { ModuleId } from './store';

/**
 * Module panels of the floor workspace. Each one is the EXISTING page component (no copies), loaded on
 * first open so the floor's first load stays small. Order = keyboard shortcut 1..5.
 */
function ModuleSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading the panel">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}

// next/dynamic needs the options as an object literal at each call (Turbopack build).
const LeadsPage = dynamic(() => import('@/components/leads/leads-page').then((m) => m.LeadsPage), { ssr: false, loading: () => <ModuleSkeleton /> });
const InboxPage = dynamic(() => import('@/components/inbox/inbox-page').then((m) => m.InboxPage), { ssr: false, loading: () => <ModuleSkeleton /> });
const TasksPage = dynamic(() => import('@/components/tasks/tasks-page').then((m) => m.TasksPage), { ssr: false, loading: () => <ModuleSkeleton /> });
const CallsPage = dynamic(() => import('@/components/calls/calls-page').then((m) => m.CallsPage), { ssr: false, loading: () => <ModuleSkeleton /> });
const DashboardPage = dynamic(() => import('@/components/dashboard/dashboard-page').then((m) => m.DashboardPage), { ssr: false, loading: () => <ModuleSkeleton /> });
const TodayView = dynamic(() => import('@/components/employee/today-view').then((m) => m.TodayView), { ssr: false, loading: () => <ModuleSkeleton /> });
const TasksView = dynamic(() => import('@/components/employee/tasks-view').then((m) => m.TasksView), { ssr: false, loading: () => <ModuleSkeleton /> });
const CallsView = dynamic(() => import('@/components/employee/calls-view').then((m) => m.CallsView), { ssr: false, loading: () => <ModuleSkeleton /> });

export interface ModuleDef {
  id: ModuleId;
  label: string;
  icon: LucideIcon;
  /** Keyboard shortcut (digit). */
  key: string;
  /** Full page of the same module (link "Open as a page"). */
  href: string;
  /** Shown when the user has ANY of these (empty = everyone). */
  anyOf: readonly Permission[];
  /** The page brings its own padding (no extra padding in the panel body). */
  flush: boolean;
  Component: ComponentType;
}

function CompanyLeads() {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <LeadsPage panel="company" />
    </Suspense>
  );
}
function CompanyInbox() {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <InboxPage panel="company" />
    </Suspense>
  );
}
function EmployeeLeads() {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <LeadsPage panel="employee" />
    </Suspense>
  );
}
function EmployeeInbox() {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <InboxPage panel="employee" />
    </Suspense>
  );
}

type Def = Omit<ModuleDef, 'label'> & { label: string | ((leads: string) => string) };

const COMPANY: Def[] = [
  { id: 'leads', label: (l) => l, icon: Users, key: '1', href: '/app/leads', anyOf: ['leads.read'], flush: true, Component: CompanyLeads },
  { id: 'inbox', label: 'Inbox', icon: MessageCircle, key: '2', href: '/app/inbox', anyOf: ['messages.read'], flush: false, Component: CompanyInbox },
  { id: 'tasks', label: 'Tasks', icon: ListTodo, key: '3', href: '/app/tasks', anyOf: ['tasks.read'], flush: false, Component: TasksPage },
  { id: 'calls', label: 'Calls', icon: Phone, key: '4', href: '/app/calls', anyOf: ['calls.read'], flush: false, Component: CallsPage },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, key: '5', href: '/app', anyOf: ['dashboard.read'], flush: true, Component: DashboardPage },
];

const EMPLOYEE: Def[] = [
  { id: 'leads', label: (l) => l, icon: Users, key: '1', href: '/me/leads', anyOf: ['leads.read'], flush: true, Component: EmployeeLeads },
  { id: 'inbox', label: 'Inbox', icon: MessageCircle, key: '2', href: '/me/inbox', anyOf: ['messages.read'], flush: false, Component: EmployeeInbox },
  { id: 'tasks', label: 'Tasks', icon: ListTodo, key: '3', href: '/me/tasks', anyOf: ['tasks.read'], flush: false, Component: TasksView },
  { id: 'calls', label: 'Calls', icon: Phone, key: '4', href: '/me/calls', anyOf: ['calls.read'], flush: false, Component: CallsView },
  { id: 'today', label: 'Today', icon: House, key: '5', href: '/me', anyOf: [], flush: false, Component: TodayView },
];

/** Modules this user may open, for the panel the floor is in. */
export function useModules(panel: PanelKind): ModuleDef[] {
  const permissions = usePermissions();
  const labels = useLabels();
  const leads = labelOf(labels, 'lead', { plural: true });
  return useMemo(
    () =>
      (panel === 'company' ? COMPANY : EMPLOYEE)
        .filter((d) => d.anyOf.length === 0 || d.anyOf.some((p) => permissions.includes(p)))
        .map((d) => ({ ...d, label: typeof d.label === 'function' ? d.label(leads) : d.label })),
    [panel, permissions, leads],
  );
}

export function ModuleBody({ def }: { def: ModuleDef }): ReactNode {
  const C = def.Component;
  return <C />;
}
