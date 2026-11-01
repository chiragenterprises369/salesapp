import { Injectable, Logger } from '@nestjs/common';
import type { CustomFieldValues, FieldDefinition, Page, Task, TaskCreate, TaskListQuery, TaskUpdate } from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import type { Activity as ActivityRow, Prisma, Task as TaskRowPlain } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { assertInTenant } from '../../infra/prisma/tenant.js';
import { applyPatch, changedKeys, validateValues } from '../customization/custom-values.js';
import { entityUniqueErrors, lockUnique, uniqueDefsIn } from '../customization/unique.js';
import { ActivityService } from '../leads/activity.service.js';
import { parseCustomFields } from '../leads/lead.mapper.js';
import { LeadsService } from '../leads/leads.service.js';
import { publishSafe, requestActor, requirePermission, type TenantDb } from '../leads/lib/context.js';
import { decodeCursor, encodeCursor, isUuid } from '../leads/lib/cursor.js';
import { safeTimezone, zonedToday } from '../leads/lib/tz.js';
import { overdueAttentionId, overdueWhere, TASK_INCLUDE, taskMappers } from './task.mapper.js';

interface TaskCursor extends Record<string, unknown> {
  t: string | null;
  id: string;
}
const isTaskCursor = (c: Record<string, unknown>): c is TaskCursor => (c.t === null || (typeof c.t === 'string' && !Number.isNaN(Date.parse(c.t)))) && isUuid(c.id);

export async function workspaceTimezone(db: TenantDb): Promise<string> {
  const ws = await db.workspace.findFirst({ select: { timezone: true } });
  return safeTimezone(ws?.timezone);
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly events: EventBus,
    private readonly activities: ActivityService,
    private readonly leads: LeadsService,
  ) {}

  /** Tasks visible to the caller: assignee within data scope, or created by the caller. */
  private async loadVisible(db: TenantDb, auth: AuthContext, id: string): Promise<TaskRowPlain> {
    const task = await db.task.findFirst({ where: { id, deletedAt: null } });
    if (!task) throw notFound('Task');
    if (task.createdById !== auth.userId && !(await this.scope.canSee(auth, task.assigneeId))) throw notFound('Task');
    return task;
  }

  /** Employees may only assign to themselves unless they hold leads.assign. */
  private async checkAssignee(db: TenantDb, auth: AuthContext, assigneeId: string): Promise<void> {
    if (assigneeId !== auth.userId) requirePermission(auth, 'leads.assign', 'You can only assign tasks to yourself');
    await this.leads.assertAssignable(db, assigneeId);
  }

  async list(auth: AuthContext, q: TaskListQuery): Promise<Page<Task> & { total: number }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const and: Prisma.TaskWhereInput[] = [{ deletedAt: null }];
    if (q.scope === 'mine' && auth.userId) and.push({ assigneeId: auth.userId });
    else and.push((await this.scope.where(auth, 'assigneeId')) as Prisma.TaskWhereInput);
    if (q.status?.length) and.push({ status: { in: q.status } });
    if (q.type?.length) and.push({ type: { in: q.type } });
    if (q.leadId) and.push({ leadId: q.leadId });
    if (q.assigneeId) and.push({ assigneeId: q.assigneeId });
    if (q.from || q.to) and.push({ dueAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } });
    if (q.due) {
      const now = new Date();
      const today = zonedToday(await workspaceTimezone(db), now);
      if (q.due === 'overdue') and.push(overdueWhere(now));
      else if (q.due === 'today') and.push({ dueAt: { gte: today.start, lt: today.end } });
      else if (q.due === 'upcoming') and.push({ dueAt: { gte: today.end } });
      else and.push({ dueAt: null });
    }
    const base: Prisma.TaskWhereInput = { AND: and };

    let after: Prisma.TaskWhereInput | null = null;
    if (q.cursor) {
      const c = decodeCursor(q.cursor, isTaskCursor);
      if (c.t === null) after = { dueAt: null, id: { gt: c.id } };
      else {
        const t = new Date(c.t);
        after = { OR: [{ dueAt: { gt: t } }, { dueAt: t, id: { gt: c.id } }, { dueAt: null }] };
      }
    }
    const [found, total] = await Promise.all([
      db.task.findMany({
        where: after ? { AND: [base, after] } : base,
        orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        take: q.limit + 1,
        include: TASK_INCLUDE,
      }),
      db.task.count({ where: base }),
    ]);
    const rows = found.slice(0, q.limit);
    const last = rows.at(-1);
    const nextCursor = found.length > q.limit && last ? encodeCursor({ t: last.dueAt?.toISOString() ?? null, id: last.id }) : null;
    const { view } = await taskMappers(db, auth);
    return { items: rows.map(view), nextCursor, total };
  }

  /** Unique task custom fields (inside the write transaction, serialised per workspace). */
  private async assertUniqueCustom(tx: TenantDb, workspaceId: string, defs: FieldDefinition[], values: CustomFieldValues, opts: { excludeId?: string; keys?: string[] } = {}): Promise<void> {
    if (!uniqueDefsIn(defs, values, opts.keys).length) return;
    await lockUnique(tx, `task-unique:${workspaceId}`);
    const errors = await entityUniqueErrors(tx, 'task', defs, values, { ...opts, pathPrefix: 'customFields' });
    if (errors.length) throw new AppException('FIELD_VALUE_NOT_UNIQUE', 'Another task already uses one of these values', { details: errors });
  }

  async create(auth: AuthContext, body: TaskCreate): Promise<Task> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const assigneeId = body.assigneeId ?? auth.userId;
    await assertInTenant(db, { lead: body.leadId, user: assigneeId });
    if (assigneeId) await this.checkAssignee(db, auth, assigneeId);
    if (body.leadId) await this.leads.loadVisible(db, auth, body.leadId);
    const mappers = await taskMappers(db, auth);
    const customFields = applyPatch({}, await validateValues(db, auth, mappers.defs, body.customFields ?? {}, { mode: 'create', pathPrefix: 'customFields' }));
    const actor = await requestActor(db, auth);
    const now = new Date();

    const { task, rows } = await db.$transaction(async (tx) => {
      await this.assertUniqueCustom(tx, wid, mappers.defs, customFields);
      const task = await tx.task.create({
        data: {
          workspaceId: wid,
          type: body.type,
          title: body.title.trim(),
          notes: body.notes?.trim() || null,
          priority: body.priority,
          leadId: body.leadId ?? null,
          assigneeId,
          createdById: auth.userId,
          dueAt: body.dueAt ? new Date(body.dueAt) : null,
          remindAt: body.remindAt ? new Date(body.remindAt) : null,
          source: 'manual',
          customFields: customFields as Prisma.InputJsonObject,
        },
        include: TASK_INCLUDE,
      });
      const rows = task.leadId ? [await tx.activity.create({ data: this.activities.data(wid, actor, task.leadId, 'task_created', { taskId: task.id, title: task.title }, now) })] : [];
      return { task, rows };
    });

    await publishSafe(this.events, this.logger, 'task.created', wid, { task: mappers.broadcast(task) }, { actor: actor.event });
    await this.activities.publishCreated(db, wid, rows, actor);
    return mappers.view(task);
  }

  async update(auth: AuthContext, id: string, body: TaskUpdate): Promise<Task> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const current = await this.loadVisible(db, auth, id);
    const now = new Date();
    const data: Prisma.TaskUncheckedUpdateInput = {};

    if (body.type !== undefined) data.type = body.type;
    if (body.title !== undefined) data.title = body.title.trim();
    if (body.notes !== undefined) data.notes = body.notes.trim() || null;
    if (body.priority !== undefined) data.priority = body.priority;
    if (body.remindAt !== undefined) data.remindAt = new Date(body.remindAt);
    if (body.dueAt !== undefined) {
      const due = new Date(body.dueAt);
      if (due.getTime() !== current.dueAt?.getTime()) Object.assign(data, { dueAt: due, overdueNotifiedAt: null, snoozedUntil: null });
    }
    if (body.assigneeId !== undefined && body.assigneeId !== current.assigneeId) {
      await assertInTenant(db, { user: body.assigneeId });
      await this.checkAssignee(db, auth, body.assigneeId);
      data.assigneeId = body.assigneeId;
    }
    if (body.leadId !== undefined && body.leadId !== current.leadId) {
      await assertInTenant(db, { lead: body.leadId });
      await this.leads.loadVisible(db, auth, body.leadId);
      data.leadId = body.leadId;
    }
    const completing = body.status === 'done' && current.status !== 'done';
    if (body.status !== undefined && body.status !== current.status) {
      data.status = body.status;
      data.completedAt = body.status === 'done' ? now : null;
      if (body.status === 'open') data.overdueNotifiedAt = null;
    }
    const mappers = await taskMappers(db, auth);
    let custom: { next: CustomFieldValues; keys: string[] } | null = null;
    if (body.customFields !== undefined) {
      const prev = parseCustomFields(current.customFields);
      const next = applyPatch(prev, await validateValues(db, auth, mappers.defs, body.customFields, { mode: 'update', pathPrefix: 'customFields' }));
      const keys = changedKeys(prev, next);
      if (keys.length) {
        custom = { next, keys };
        data.customFields = next as Prisma.InputJsonObject;
      }
    }

    const actor = await requestActor(db, auth);
    const { task, rows } = await db.$transaction(async (tx) => {
      if (custom) await this.assertUniqueCustom(tx, wid, mappers.defs, custom.next, { excludeId: id, keys: custom.keys });
      const task = await tx.task.update({ where: { id }, data, include: TASK_INCLUDE });
      const rows: ActivityRow[] = [];
      if (completing && task.leadId) {
        rows.push(await tx.activity.create({ data: this.activities.data(wid, actor, task.leadId, 'task_completed', { taskId: task.id, title: task.title }, now) }));
        await tx.lead.updateMany({ where: { id: task.leadId, deletedAt: null }, data: { lastActivityAt: now, version: { increment: 1 } } });
      }
      return { task, rows };
    });

    await publishSafe(this.events, this.logger, 'task.updated', wid, { task: mappers.broadcast(task) }, { actor: actor.event });
    await this.activities.publishCreated(db, wid, rows, actor);
    await this.resolveAttention(wid, current, task.status !== 'open' || data.overdueNotifiedAt === null);
    return mappers.view(task);
  }

  async snooze(auth: AuthContext, id: string, until: string): Promise<Task> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const current = await this.loadVisible(db, auth, id);
    const at = new Date(until);
    if (at.getTime() <= Date.now()) throw new AppException('VALIDATION_FAILED', 'Pick a time in the future', { details: [{ path: 'until', message: 'Must be in the future' }] });
    const task = await db.task.update({ where: { id }, data: { snoozedUntil: at, overdueNotifiedAt: null }, include: TASK_INCLUDE });
    const actor = await requestActor(db, auth);
    const mappers = await taskMappers(db, auth);
    await publishSafe(this.events, this.logger, 'task.updated', wid, { task: mappers.broadcast(task) }, { actor: actor.event });
    await this.resolveAttention(wid, current, true);
    return mappers.view(task);
  }

  async remove(auth: AuthContext, id: string): Promise<{ ok: true }> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const current = await this.loadVisible(db, auth, id);
    // Soft delete; status becomes cancelled so `task.updated` subscribers drop it from open lists.
    const task = await db.task.update({ where: { id }, data: { deletedAt: new Date(), status: current.status === 'open' ? 'cancelled' : current.status }, include: TASK_INCLUDE });
    const actor = await requestActor(db, auth);
    const { broadcast } = await taskMappers(db, null);
    await publishSafe(this.events, this.logger, 'task.updated', wid, { task: broadcast(task) }, { actor: actor.event });
    await this.resolveAttention(wid, current, true);
    return { ok: true };
  }

  /** Clear the "overdue" attention bubble once a notified task is done, moved, snoozed or deleted. */
  private async resolveAttention(workspaceId: string, before: TaskRowPlain, resolved: boolean): Promise<void> {
    if (!before.overdueNotifiedAt || !resolved) return;
    await publishSafe(this.events, this.logger, 'attention.resolved', workspaceId, { id: overdueAttentionId(before.id) });
  }
}
