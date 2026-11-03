import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { SYSTEM_ACTOR } from '../leads/lib/context.js';
import { PlatformMailerService } from '../mail/platform-mailer.service.js';
import { NotificationsService, type NotifyInput } from '../notifications/notifications.service.js';

/** Notify every active company admin of a workspace (webhook auto-disable, integration alerts). */
@Injectable()
export class AdminNotifier {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    // ---- change #20: config (webhook_disabled e-mail)
    private readonly mailer: PlatformMailerService,
  ) {}

  async notifyAdmins(workspaceId: string, input: NotifyInput): Promise<void> {
    const admins = await this.prisma.forTenant(workspaceId).user.findMany({ where: { isActive: true, deletedAt: null, role: { kind: 'company_admin' } }, select: { id: true } });
    for (const a of admins) await this.notifications.notify(workspaceId, a.id, input, SYSTEM_ACTOR);
    // ---- change #20: config. The webhook switch-off also goes out by e-mail (platform template webhook_disabled).
    const data = (input.data ?? {}) as { kind?: string; endpointId?: string };
    if (data.kind === 'webhook_disabled' && data.endpointId) {
      const ep = await this.prisma.forTenant(workspaceId).webhookEndpoint.findFirst({ where: { id: data.endpointId }, select: { url: true, deadStreak: true } });
      await this.mailer.sendToCompanyUsers(workspaceId, { kind: 'company_admins' }, 'webhook_disabled', {
        endpointUrl: ep?.url ?? '',
        failures: String(ep?.deadStreak ?? ''),
        link: this.mailer.webUrl(`/app${input.path ?? '/webhooks'}`),
      });
    }
  }
}
