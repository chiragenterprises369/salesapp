import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { SYSTEM_ACTOR } from '../leads/lib/context.js';
import { NotificationsService, type NotifyInput } from '../notifications/notifications.service.js';

/** Notify every active company admin of a workspace (webhook auto-disable, integration alerts). */
@Injectable()
export class AdminNotifier {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async notifyAdmins(workspaceId: string, input: NotifyInput): Promise<void> {
    const admins = await this.prisma.forTenant(workspaceId).user.findMany({ where: { isActive: true, deletedAt: null, role: { kind: 'company_admin' } }, select: { id: true } });
    for (const a of admins) await this.notifications.notify(workspaceId, a.id, input, SYSTEM_ACTOR);
  }
}
