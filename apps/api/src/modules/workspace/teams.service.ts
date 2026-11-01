import { Injectable } from '@nestjs/common';
import type { Team } from '@vistar/shared';
import type { Request } from 'express';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { conflict, notFound } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { assertInTenant } from '../../infra/prisma/tenant.js';
import { TEAM_INCLUDE, toTeam } from './mappers.js';

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext): Promise<{ items: Team[] }> {
    const rows = await this.prisma.forTenant(auth.workspaceId).team.findMany({ include: TEAM_INCLUDE, orderBy: { name: 'asc' } });
    return { items: rows.map(toTeam) };
  }

  async create(auth: AuthContext, req: Request, body: { name: string; managerId?: string | null; memberIds: string[] }): Promise<Team> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const name = body.name.trim();
    const memberIds = [...new Set(body.memberIds)];
    await assertInTenant(db, { user: body.managerId });
    if (memberIds.length) {
      const found = await db.user.count({ where: { id: { in: memberIds }, deletedAt: null } });
      if (found !== memberIds.length) throw notFound('user');
    }
    if (await db.team.count({ where: { name: { equals: name, mode: 'insensitive' } } })) {
      throw conflict('A team with this name already exists. Choose another name');
    }

    const team = await db.$transaction(async (tx) => {
      const created = await tx.team.create({ data: { workspaceId: wid, name, managerId: body.managerId ?? null } });
      if (memberIds.length) await tx.user.updateMany({ where: { id: { in: memberIds } }, data: { teamId: created.id } });
      return tx.team.findFirstOrThrow({ where: { id: created.id }, include: TEAM_INCLUDE });
    });
    await this.audit.record(auth, req, {
      action: 'team.create',
      entityType: 'team',
      entityId: team.id,
      diff: { name, managerId: body.managerId ?? null, memberIds },
    });
    return toTeam(team);
  }
}
