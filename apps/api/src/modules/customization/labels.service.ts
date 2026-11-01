import { Injectable, Logger } from '@nestjs/common';
import { resolveLabels, type LabelOverrides, type LabelsResponse } from '@vistar/shared';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { publishSafe, requestActor } from '../leads/lib/context.js';
import { readLabelOverrides, writeLabelOverrides } from './labels.store.js';

/** GET/PUT /labels. Display text only; URLs, API paths, events and DB names keep the core names. */
@Injectable()
export class LabelsService {
  private readonly logger = new Logger(LabelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  async get(auth: AuthContext): Promise<LabelsResponse> {
    const overrides = await readLabelOverrides(this.prisma.forTenant(auth.workspaceId), auth.workspaceId);
    return { labels: resolveLabels(overrides), overrides };
  }

  async update(auth: AuthContext, req: Request, body: { overrides: LabelOverrides }): Promise<LabelsResponse> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const before = await readLabelOverrides(db, wid);
    await writeLabelOverrides(db, wid, body.overrides);
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'labels.update', entityType: 'setting', diff: { from: before, to: body.overrides } }, actor.summary?.name);
    await publishSafe(this.events, this.logger, 'customization.changed', wid, { scope: 'labels', target: null }, { actor: actor.event });
    return { labels: resolveLabels(body.overrides), overrides: body.overrides };
  }
}
