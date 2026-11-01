import { Injectable, Logger } from '@nestjs/common';
import { ActivitySchema, type Activity, type ActivityOf, type EventActor, type UserSummary } from '@vistar/shared';
import { toUserSummary, USER_SUMMARY_SELECT } from '../../common/mappers/user.mapper.js';
import type { Activity as ActivityRow, Prisma } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { publishSafe, type RequestActor, type TenantDb } from './lib/context.js';

type ActivityType = Activity['type'];

/** Lead timeline writer/reader. Payload shapes follow ActivitySchema in @vistar/shared. */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(private readonly events: EventBus) {}

  /** Create input for one timeline entry (use inside the same transaction as the change it records). */
  data<T extends ActivityType>(
    workspaceId: string,
    actor: RequestActor | null,
    leadId: string,
    type: T,
    payload: ActivityOf<T>['payload'],
    createdAt?: Date,
  ): Prisma.ActivityUncheckedCreateInput {
    return {
      workspaceId,
      leadId,
      type,
      actorType: actor?.activityActorType ?? 'system',
      actorId: actor?.activityActorId ?? null,
      payload: payload as Prisma.InputJsonValue,
      ...(createdAt ? { createdAt } : {}),
    };
  }

  /** Map rows to ActivitySchema (actors resolved in one query). Rows whose payload does not match the contract are dropped. */
  async toDtos(db: TenantDb, rows: ActivityRow[], known?: UserSummary | null): Promise<Activity[]> {
    const ids = [...new Set(rows.map((r) => r.actorId).filter((id): id is string => !!id && id !== known?.id))];
    const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: USER_SUMMARY_SELECT }) : [];
    const actors = new Map<string, UserSummary>(users.map((u) => [u.id, toUserSummary(u)]));
    if (known) actors.set(known.id, known);
    const out: Activity[] = [];
    for (const r of rows) {
      const parsed = ActivitySchema.safeParse({
        id: r.id,
        leadId: r.leadId,
        type: r.type,
        actor: r.actorId ? (actors.get(r.actorId) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
        payload: r.payload,
      });
      if (parsed.success) out.push(parsed.data);
      else this.logger.warn(`Skipped activity ${r.id} (${r.type}): payload does not match the contract`);
    }
    return out;
  }

  /** Publish `activity.created` for rows written in a committed transaction. */
  async publishCreated(db: TenantDb, workspaceId: string, rows: ActivityRow[], actor: RequestActor | null, eventActor?: EventActor): Promise<void> {
    if (!rows.length) return;
    const dtos = await this.toDtos(db, rows, actor?.summary ?? null);
    for (const activity of dtos) {
      await publishSafe(this.events, this.logger, 'activity.created', workspaceId, { activity }, { actor: eventActor ?? actor?.event ?? null });
    }
  }
}
