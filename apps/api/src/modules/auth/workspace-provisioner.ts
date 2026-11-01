import { Injectable } from '@nestjs/common';
import {
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_ROLE_SCOPE,
  DEFAULT_STAGES,
  ROLE_KIND_LABELS,
  ROLE_KINDS,
  SYSTEM_ROLE_KEYS,
} from '@vistar/shared';
import { WHATSAPP_TEMPLATE_FIXTURES } from '@vistar/shared/fixtures';
import { randomBytes } from 'node:crypto';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { slugify } from '../workspace/util.js';

export interface ProvisionInput {
  ownerName: string;
  email: string;
  passwordHash: string | null;
  googleSub: string | null;
  workspaceName: string;
  timezone: string;
}

const DEFAULT_TRIAL_DAYS = 14;

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'P2002';
}

/**
 * Creates a new tenant in ONE transaction: workspace (trial on the free plan), the four system roles,
 * the default pipeline with DEFAULT_STAGES, approved WhatsApp templates, and the owner as
 * company_admin. Runs on the root client because the tenant client cannot create workspaces;
 * every row sets workspaceId explicitly.
 */
@Injectable()
export class WorkspaceProvisioner {
  constructor(private readonly prisma: PrismaService) {}

  async provision(input: ProvisionInput): Promise<{ workspaceId: string; userId: string }> {
    const plan = await this.prisma.planDefinition.findUnique({ where: { key: 'free' }, select: { trialDays: true } });
    const trialDays = plan?.trialDays ?? DEFAULT_TRIAL_DAYS;
    const base = slugify(input.workspaceName) || 'workspace';

    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = attempt === 0 ? base : `${base.slice(0, 40)}-${randomBytes(3).toString('hex')}`;
      if (await this.prisma.workspace.count({ where: { slug } })) continue;
      try {
        return await this.create(input, slug, trialDays);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        if (await this.prisma.user.count({ where: { email: input.email } })) {
          throw new AppException('AUTH_EMAIL_TAKEN', 'An account with this email already exists. Sign in instead');
        }
        // Slug race: try another suffix.
      }
    }
    throw new AppException('CONFLICT', 'Could not create the workspace. Try a different name');
  }

  private create(input: ProvisionInput, slug: string, trialDays: number) {
    return this.prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.create({
        data: {
          name: input.workspaceName,
          slug,
          timezone: input.timezone,
          businessHours: DEFAULT_BUSINESS_HOURS,
          holidays: [],
          status: 'trial',
          plan: 'free',
          trialEndsAt: new Date(Date.now() + trialDays * 86_400_000),
        },
      });
      const workspaceId = ws.id;
      const roles = await tx.role.createManyAndReturn({
        data: ROLE_KINDS.map((kind) => ({
          workspaceId,
          key: SYSTEM_ROLE_KEYS[kind],
          name: ROLE_KIND_LABELS[kind],
          kind,
          dataScope: DEFAULT_ROLE_SCOPE[kind],
          permissions: DEFAULT_ROLE_PERMISSIONS[kind],
          isSystem: true,
        })),
        select: { id: true, kind: true },
      });
      const adminRole = roles.find((r) => r.kind === 'company_admin')!;

      const pipeline = await tx.pipeline.create({ data: { workspaceId, name: 'Sales', isDefault: true } });
      await tx.stage.createMany({
        data: DEFAULT_STAGES.map((s, order) => ({ workspaceId, pipelineId: pipeline.id, key: s.key, name: s.name, type: s.type, order, probability: s.probability })),
      });
      await tx.template.createMany({
        data: WHATSAPP_TEMPLATE_FIXTURES.map((t) => ({
          workspaceId,
          channel: 'whatsapp' as const,
          name: t.name,
          language: 'en',
          category: t.category,
          status: 'approved' as const,
          body: t.body,
          variables: t.variables,
        })),
      });
      const user = await tx.user.create({
        data: {
          workspaceId,
          email: input.email,
          passwordHash: input.passwordHash,
          googleSub: input.googleSub,
          name: input.ownerName,
          roleId: adminRole.id,
          status: 'offline',
        },
      });
      return { workspaceId, userId: user.id };
    });
  }
}
