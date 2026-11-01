import { Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';
import type { EventActor, Notification, NotificationType, Page, PushSubscriptionSchema } from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { iso } from '../../common/mappers/user.mapper.js';
import type { Notification as NotificationRow, Prisma } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { afterTimeCursor, nextTimeCursor } from '../leads/lib/cursor.js';
import { panelPrefix, publishSafe, SYSTEM_ACTOR } from '../leads/lib/context.js';

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string | null;
  /** Path inside the recipient's panel, e.g. `/leads?lead=<id>`; prefixed with /app or /me by role. */
  path?: string | null;
  data?: Record<string, unknown>;
}

export function toNotification(n: NotificationRow): Notification {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    href: n.href,
    data: n.data && typeof n.data === 'object' && !Array.isArray(n.data) ? (n.data as Record<string, unknown>) : {},
    readAt: iso(n.readAt),
    createdAt: n.createdAt.toISOString(),
  };
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
  ) {}

  /** Create a notification for one user and push `notification.created` to that user's room. */
  async notify(workspaceId: string, userId: string, input: NotifyInput, actor: EventActor | null = SYSTEM_ACTOR): Promise<Notification | null> {
    const db = this.prisma.forTenant(workspaceId);
    const user = await db.user.findFirst({ where: { id: userId, isActive: true, deletedAt: null }, select: { role: { select: { kind: true } } } });
    if (!user) return null;
    const row = await db.notification.create({
      data: {
        workspaceId,
        userId,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body?.slice(0, 1000) ?? null,
        href: input.path ? `${panelPrefix(user.role.kind)}${input.path}` : null,
        data: (input.data ?? {}) as Prisma.InputJsonObject,
      },
    });
    const notification = toNotification(row);
    await publishSafe(this.events, this.logger, 'notification.created', workspaceId, { notification }, { actor, userId });
    return notification;
  }

  async list(auth: AuthContext, q: { cursor?: string; limit: number; unread?: boolean }): Promise<Page<Notification> & { unreadCount: number }> {
    if (!auth.userId) return { items: [], nextCursor: null, unreadCount: 0 };
    const db = this.prisma.forTenant(auth.workspaceId);
    const where: Prisma.NotificationWhereInput = { userId: auth.userId, ...(q.unread ? { readAt: null } : {}) };
    const [rows, unreadCount] = await Promise.all([
      db.notification.findMany({ where: { ...where, ...afterTimeCursor(q.cursor) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1 }),
      db.notification.count({ where: { userId: auth.userId, readAt: null } }),
    ]);
    return { items: rows.slice(0, q.limit).map(toNotification), nextCursor: nextTimeCursor(rows, q.limit), unreadCount };
  }

  async markRead(auth: AuthContext, ids: string[] | undefined): Promise<{ ok: true }> {
    if (!auth.userId) return { ok: true };
    await this.prisma.forTenant(auth.workspaceId).notification.updateMany({
      where: { userId: auth.userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  /** Upsert a web push subscription for the caller (sending arrives in a later phase). */
  async subscribe(auth: AuthContext, body: z.output<typeof PushSubscriptionSchema>): Promise<{ ok: true }> {
    if (!auth.userId) throw new AppException('FORBIDDEN', 'Push subscriptions need a signed-in user');
    let url: URL;
    try {
      url = new URL(body.endpoint);
    } catch {
      throw new AppException('VALIDATION_FAILED', 'Push endpoint must be an https URL');
    }
    if (url.protocol !== 'https:') throw new AppException('VALIDATION_FAILED', 'Push endpoint must be an https URL');
    const wid = auth.workspaceId;
    // Endpoints are globally unique per browser. Holding the endpoint proves the browser is the caller's,
    // so a stale row from another workspace (same browser, other account) is released first.
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint, NOT: { workspaceId: wid } } });
    await this.prisma.forTenant(wid).pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: { workspaceId: wid, userId: auth.userId, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth },
      update: { userId: auth.userId, p256dh: body.keys.p256dh, auth: body.keys.auth },
    });
    return { ok: true };
  }
}
