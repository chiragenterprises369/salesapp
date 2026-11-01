import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { publishSafe, SYSTEM_ACTOR } from '../leads/lib/context.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { overdueAttention, overdueWhere, TASK_INCLUDE, toTask } from './task.mapper.js';

const BATCH = 200;
const MAX_BATCHES_PER_TICK = 5;

/**
 * Every minute: open tasks past due (not snoozed) that were not notified yet, across all workspaces.
 * Each task is claimed atomically (`overdueNotifiedAt IS NULL` -> now), so several API instances never
 * notify twice. Then: `task_overdue` notification + `task.overdue` (assignee room) + `attention.raised`.
 */
@Injectable()
export class TaskOverdueScheduler {
  private readonly logger = new Logger(TaskOverdueScheduler.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'task-overdue' })
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.scan();
      if (n) this.logger.log(`Flagged ${n} overdue task(s)`);
    } catch (err) {
      this.logger.error(`Overdue scan failed: ${(err as Error).name}`);
    } finally {
      this.running = false;
    }
  }

  /** Root client on purpose: this job iterates every workspace. Per-workspace reads go through forTenant(). */
  async scan(now = new Date()): Promise<number> {
    let flagged = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_TICK; batch++) {
      const candidates = await this.prisma.task.findMany({
        where: { ...overdueWhere(now), overdueNotifiedAt: null, assigneeId: { not: null } },
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        take: BATCH,
        select: { id: true },
      });
      if (!candidates.length) break;
      const claimed = await this.prisma.task.updateManyAndReturn({
        where: { id: { in: candidates.map((c) => c.id) }, overdueNotifiedAt: null },
        data: { overdueNotifiedAt: now },
        select: { id: true, workspaceId: true },
      });
      const byWorkspace = new Map<string, string[]>();
      for (const c of claimed) byWorkspace.set(c.workspaceId, [...(byWorkspace.get(c.workspaceId) ?? []), c.id]);
      for (const [workspaceId, ids] of byWorkspace) {
        const tasks = await this.prisma.forTenant(workspaceId).task.findMany({ where: { id: { in: ids } }, include: TASK_INCLUDE });
        for (const t of tasks) {
          if (!t.assigneeId) continue;
          const task = toTask(t);
          await this.notifications.notify(workspaceId, t.assigneeId, {
            type: 'task_overdue',
            title: `Task overdue: ${t.title}`,
            body: t.lead ? `For ${t.lead.name}` : null,
            path: `/tasks?task=${t.id}`,
            data: { taskId: t.id, leadId: t.leadId },
          });
          await publishSafe(this.events, this.logger, 'task.overdue', workspaceId, { task }, { actor: SYSTEM_ACTOR, userId: t.assigneeId });
          await publishSafe(this.events, this.logger, 'attention.raised', workspaceId, { item: overdueAttention(t, now) }, { actor: SYSTEM_ACTOR });
        }
      }
      flagged += claimed.length;
      if (candidates.length < BATCH) break;
    }
    return flagged;
  }
}
