import { Injectable } from '@nestjs/common';
import type { Device, DeviceRegister } from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { notFound } from '../../common/errors/app-exception.js';
import type { Device as DeviceRow } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { requireUserId } from '../workspace/users.service.js';

const toDevice = (d: DeviceRow): Device => ({
  id: d.id,
  platform: d.platform,
  installationId: d.installationId,
  hasPushToken: !!d.fcmToken && !d.tokenInvalidAt,
  appVersion: d.appVersion,
  appBuild: d.appBuild,
  model: d.model,
  osVersion: d.osVersion,
  lastSeenAt: d.lastSeenAt.toISOString(),
  createdAt: d.createdAt.toISOString(),
});

/** Push targets of the signed-in user. Upsert key (workspace, user, installationId); an FCM token belongs to one row only. */
@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(auth: AuthContext): Promise<{ items: Device[] }> {
    const rows = await this.prisma.forTenant(auth.workspaceId).device.findMany({ where: { userId: requireUserId(auth) }, orderBy: { lastSeenAt: 'desc' } });
    return { items: rows.map(toDevice) };
  }

  async register(auth: AuthContext, body: DeviceRegister): Promise<Device> {
    const userId = requireUserId(auth);
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    if (body.fcmToken) {
      // The same phone signed in as someone else (or in another company) keeps one token owner: this row.
      await this.prisma.device.updateMany({ where: { fcmToken: body.fcmToken, NOT: { workspaceId: wid, userId, installationId: body.installationId } }, data: { fcmToken: null } });
    }
    const data = {
      platform: body.platform,
      fcmToken: body.fcmToken,
      tokenInvalidAt: null,
      appVersion: body.appVersion,
      appBuild: body.appBuild ?? null,
      model: body.model ?? null,
      osVersion: body.osVersion ?? null,
      lastSeenAt: new Date(),
    };
    const row = await db.device.upsert({
      where: { workspaceId_userId_installationId: { workspaceId: wid, userId, installationId: body.installationId } },
      create: { workspaceId: wid, userId, installationId: body.installationId, ...data },
      update: data,
    });
    return toDevice(row);
  }

  async remove(auth: AuthContext, id: string): Promise<{ ok: true }> {
    const { count } = await this.prisma.forTenant(auth.workspaceId).device.deleteMany({ where: { id, userId: requireUserId(auth) } });
    if (!count) throw notFound('Device');
    return { ok: true };
  }
}
