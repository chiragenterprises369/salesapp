import { Body, Controller, Param, Query, Req } from '@nestjs/common';
import {
  API_ROUTES,
  IdParamSchema,
  OfficeMarkerCreateSchema,
  PresenceHeartbeatSchema,
  PresenceHistoryQuerySchema,
  StatusUpdateSchema,
  ZoneSignalSchema,
  type MyPresence,
  type OfficeMarker,
  type PresenceEvent,
} from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentAuth, type AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { addZonedDays, safeTimezone, zonedMidnight } from '../leads/lib/tz.js';
import { localDateOf } from './engine/working-hours.js';
import { OfficeMarkersService } from './office-markers.service.js';
import { PresenceService } from './presence.service.js';

export function requireUser(auth: AuthContext): string {
  if (!auth.userId) throw new AppException('FORBIDDEN', 'This action needs a signed-in user');
  return auth.userId;
}

/** Device id of REST heartbeats: one per session and client (the socket uses its own ids). */
export const restDeviceId = (auth: AuthContext, client: string) => `rest:${auth.sessionId ?? auth.userId}:${client}`;

/**
 * My presence (status control, heartbeat over HTTP, office zone signals), a person's status history
 * (D-062) and the office zone markers (SPEC 29.11).
 */
@Controller()
export class PresenceController {
  constructor(
    private readonly presence: PresenceService,
    private readonly markers: OfficeMarkersService,
    private readonly scope: ScopeService,
    private readonly prisma: PrismaService,
  ) {}

  @ApiRoute(API_ROUTES.myStatusUpdate)
  async setStatus(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(StatusUpdateSchema)) body: z.output<typeof StatusUpdateSchema>): Promise<MyPresence> {
    const userId = requireUser(auth);
    if (auth.impersonation) throw new AppException('FORBIDDEN', 'Support sessions cannot change a status');
    const status = body.status === 'idle' ? 'available' : body.status;
    await this.presence.manual({ workspaceId: auth.workspaceId, userId }, status, body.note ?? null);
    return this.presence.myPresence(auth.workspaceId, userId);
  }

  @ApiRoute(API_ROUTES.myPresenceGet)
  get(@CurrentAuth() auth: AuthContext): Promise<MyPresence> {
    return this.presence.myPresence(auth.workspaceId, requireUser(auth));
  }

  @ApiRoute(API_ROUTES.myPresenceHeartbeat)
  async heartbeat(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(PresenceHeartbeatSchema)) body: z.output<typeof PresenceHeartbeatSchema>): Promise<MyPresence> {
    const userId = requireUser(auth);
    if (!auth.impersonation) {
      // An app in the background is not in front of the employee, whatever it reports.
      const activity = body.appState === 'background' && body.activity === 'active' ? 'hidden' : body.activity;
      await this.presence.heartbeat(
        { workspaceId: auth.workspaceId, userId, sessionId: auth.sessionId },
        { deviceId: restDeviceId(auth, body.client), client: body.client, activity, screen: body.screen ?? undefined, appDeviceId: body.deviceId ?? null, zone: body.zone ?? null },
      );
    }
    return this.presence.myPresence(auth.workspaceId, userId);
  }

  @ApiRoute(API_ROUTES.myZoneSignal)
  async zone(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(ZoneSignalSchema)) body: z.output<typeof ZoneSignalSchema>): Promise<MyPresence> {
    const userId = requireUser(auth);
    if (auth.impersonation) throw new AppException('FORBIDDEN', 'Support sessions cannot report a location');
    await this.presence.zoneSignal({ workspaceId: auth.workspaceId, userId, sessionId: auth.sessionId }, body);
    return this.presence.myPresence(auth.workspaceId, userId);
  }

  @ApiRoute(API_ROUTES.officeMarkerList)
  markerList(@CurrentAuth() auth: AuthContext): Promise<{ items: OfficeMarker[] }> {
    return this.markers.list(auth);
  }

  @ApiRoute(API_ROUTES.officeMarkerCreate)
  markerCreate(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(OfficeMarkerCreateSchema)) body: z.output<typeof OfficeMarkerCreateSchema>): Promise<OfficeMarker> {
    return this.markers.create(auth, req, body);
  }

  @ApiRoute(API_ROUTES.officeMarkerDelete)
  markerDelete(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) params: z.output<typeof IdParamSchema>): Promise<{ ok: true }> {
    return this.markers.remove(auth, req, params.id);
  }

  @ApiRoute(API_ROUTES.presenceHistory)
  async history(
    @CurrentAuth() auth: AuthContext,
    @Param(new ZodPipe(IdParamSchema)) params: z.output<typeof IdParamSchema>,
    @Query(new ZodPipe(PresenceHistoryQuerySchema)) query: z.output<typeof PresenceHistoryQuerySchema>,
  ): Promise<{ items: PresenceEvent[] }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const user = await db.user.findFirst({ where: { id: params.id, deletedAt: null }, select: { id: true } });
    if (!user || !(await this.scope.canSee(auth, user.id))) throw notFound('User');
    const ws = await db.workspace.findFirst({ select: { timezone: true } });
    const tz = safeTimezone(ws?.timezone);
    const date = query.date ?? localDateOf(Date.now(), tz);
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    const from = zonedMidnight(y, m, d, tz);
    const to = addZonedDays(from, 1, tz);
    return { items: await this.presence.history(auth.workspaceId, user.id, from, to) };
  }
}
