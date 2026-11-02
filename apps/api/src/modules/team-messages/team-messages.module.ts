import { Body, Controller, Injectable, Module, Param } from '@nestjs/common';
import { API_ROUTES, IdParamSchema, IdSchema } from '@vistar/shared';
import { z } from 'zod';
import { type AuthContext, CurrentAuth } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { notFound } from '../../common/errors/app-exception.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { requestActor } from '../leads/lib/context.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const UserMessageSchema = z.object({ body: z.string().trim().min(1).max(1000), leadId: IdSchema.optional() });
type UserMessage = z.infer<typeof UserMessageSchema>;

/**
 * POST /users/{id}/messages (requests-19b #12): a short in-app message to a team member, delivered as a
 * notification (type `mention`, the "someone mentions me" preference) with a link to the lead when given.
 * The recipient must be in the sender's data scope (managers: their team); 404 otherwise.
 */
@Injectable()
export class TeamMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  async send(auth: AuthContext, userId: string, body: UserMessage): Promise<{ ok: true }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const recipient = await db.user.findFirst({ where: { id: userId, isActive: true, deletedAt: null }, select: { id: true } });
    if (!recipient || userId === auth.userId || !(await this.scope.canSee(auth, userId))) throw notFound('Team member');
    const lead = body.leadId ? await db.lead.findFirst({ where: { id: body.leadId, deletedAt: null }, select: { id: true, name: true } }) : null;
    if (body.leadId && !lead) throw notFound('Lead');
    const actor = await requestActor(db, auth);
    const from = actor.summary?.name ?? 'Your manager';
    await this.notifications.notify(
      auth.workspaceId,
      userId,
      {
        type: 'mention',
        title: `Message from ${from}${lead ? ` about ${lead.name}` : ''}`,
        body: body.body,
        path: lead ? `/leads?lead=${lead.id}` : null,
        data: { fromUserId: auth.userId, ...(lead ? { leadId: lead.id } : {}) },
      },
      actor.event,
    );
    return { ok: true };
  }
}

@Controller()
export class TeamMessagesController {
  constructor(private readonly messages: TeamMessagesService) {}

  @ApiRoute(API_ROUTES.userMessage)
  send(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: { id: string }, @Body(new ZodPipe(UserMessageSchema)) body: UserMessage) {
    return this.messages.send(auth, id, body);
  }
}

/** OWNER: backend-core (CRM-API, change #19 wave B; requests-19b #12). */
@Module({
  imports: [NotificationsModule],
  controllers: [TeamMessagesController],
  providers: [TeamMessagesService],
})
export class TeamMessagesModule {}
