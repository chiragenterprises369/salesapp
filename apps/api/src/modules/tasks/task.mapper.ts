import type { AttentionItem, FieldDefinition, Task } from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { iso, toUserSummary, USER_SUMMARY_SELECT } from '../../common/mappers/user.mapper.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { loadFieldDefs, publicValues, roleKeyOf, visibleFor } from '../customization/custom-values.js';
import { parseCustomFields } from '../leads/lead.mapper.js';
import type { TenantDb } from '../leads/lib/context.js';

export const TASK_INCLUDE = {
  assignee: { select: USER_SUMMARY_SELECT },
  lead: { select: { name: true } },
} as const satisfies Prisma.TaskInclude;

export type TaskRow = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;

export function toTask(t: TaskRow): Task {
  return {
    id: t.id,
    type: t.type,
    title: t.title,
    notes: t.notes,
    status: t.status,
    priority: t.priority,
    leadId: t.leadId,
    leadName: t.lead?.name ?? null,
    assignee: toUserSummary(t.assignee),
    dueAt: iso(t.dueAt),
    remindAt: iso(t.remindAt),
    snoozedUntil: iso(t.snoozedUntil),
    completedAt: iso(t.completedAt),
    source: t.source,
    workflowRunId: t.workflowRunId,
    customFields: parseCustomFields(t.customFields),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** Stable attention key for an overdue task (dashboard "Needs attention", Team Floor bubble). */
export const overdueAttentionId = (taskId: string) => `task_overdue:${taskId}`;

export interface TaskMappers {
  defs: FieldDefinition[];
  /** DTO for the caller: custom values hidden for the caller's role are removed. */
  view: (t: TaskRow) => Task;
  /** DTO for broadcast events: values of fields hidden for any role are removed. */
  broadcast: (t: TaskRow) => Task;
}

/** Task mappers with custom field visibility for one caller (auth null = system: broadcast rules for both). */
export async function taskMappers(db: TenantDb, auth: AuthContext | null): Promise<TaskMappers> {
  const [defs, roleKey] = await Promise.all([loadFieldDefs(db, 'task'), auth ? roleKeyOf(db, auth) : Promise.resolve(null)]);
  const broadcast = (t: TaskRow): Task => {
    const dto = toTask(t);
    return { ...dto, customFields: publicValues(defs, dto.customFields) };
  };
  const view = auth
    ? (t: TaskRow): Task => {
        const dto = toTask(t);
        return { ...dto, customFields: visibleFor(defs, dto.customFields, roleKey) };
      }
    : broadcast;
  return { defs, view, broadcast };
}

export function overdueAttention(t: TaskRow, now: Date): AttentionItem {
  const hoursLate = t.dueAt ? (now.getTime() - t.dueAt.getTime()) / 3_600_000 : 0;
  return {
    id: overdueAttentionId(t.id),
    kind: 'task_overdue',
    title: `Overdue: ${t.title}`.slice(0, 200),
    subtitle: [t.assignee?.name, t.lead?.name].filter(Boolean).join(' · ') || null,
    href: `/app/tasks?task=${t.id}`,
    leadId: t.leadId,
    userId: t.assigneeId,
    severity: hoursLate >= 24 ? 'critical' : 'warning',
    createdAt: (t.dueAt ?? now).toISOString(),
  };
}

/** Open, past due and not snoozed (as of `now`). */
export const overdueWhere = (now: Date): Prisma.TaskWhereInput => ({
  status: 'open',
  deletedAt: null,
  dueAt: { lt: now },
  OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
});
