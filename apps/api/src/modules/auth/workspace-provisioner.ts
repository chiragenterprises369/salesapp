import { Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_PIPELINE_KEY,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_ROLE_SCOPE,
  DEFAULT_STAGES,
  GENERIC_SALES_PACK_KEY,
  ROLE_KIND_LABELS,
  ROLE_KINDS,
  SYSTEM_ROLE_KEYS,
  type Plan,
} from '@vistar/shared';
import { WHATSAPP_TEMPLATE_FIXTURES } from '@vistar/shared/fixtures';
import { randomBytes } from 'node:crypto';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { installPack, SYSTEM_PACK_ACTOR } from '../packs/pack-installer.js';
import { ensurePackRegistered } from '../packs/pack-registry.js';
import { slugify } from '../workspace/util.js';

export interface ProvisionInput {
  ownerName: string;
  email: string;
  passwordHash: string | null;
  googleSub: string | null;
  workspaceName: string;
  timezone: string;
}

/** Company created by the Super Admin (no owner yet: the admin joins through an invite). */
export interface CompanyProvisionInput {
  name: string;
  plan: Plan;
  timezone: string;
  /** 0 = active right away (no trial). */
  trialDays: number;
}

interface TenantInput {
  name: string;
  slug: string;
  timezone: string;
  plan: Plan;
  trialDays: number;
}

interface OwnerInput {
  name: string;
  email: string;
  passwordHash: string | null;
  googleSub: string | null;
}

export interface ProvisionedTenant {
  workspaceId: string;
  adminRoleId: string;
  userId: string | null;
}

const DEFAULT_TRIAL_DAYS = 14;

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'P2002';
}

/**
 * Creates a new tenant in ONE transaction: workspace (sign-up: trial on the free plan; Super Admin: the chosen
 * plan and trial), the four system roles, the default pipeline with DEFAULT_STAGES, approved WhatsApp templates,
 * and (sign-up only) the owner as company_admin. Runs on the root client because the tenant client cannot create
 * workspaces; every row sets workspaceId explicitly. Afterwards the core pack generic-sales is installed: it adopts
 * the pipeline and templates created here and adds its lead fields (WorkspacePack row + install log).
 */
@Injectable()
export class WorkspaceProvisioner {
  private readonly logger = new Logger(WorkspaceProvisioner.name);

  constructor(private readonly prisma: PrismaService) {}

  async provision(input: ProvisionInput): Promise<{ workspaceId: string; userId: string }> {
    const plan = await this.prisma.planDefinition.findUnique({ where: { key: 'free' }, select: { trialDays: true } });
    const trialDays = plan?.trialDays ?? DEFAULT_TRIAL_DAYS;
    const owner: OwnerInput = { name: input.ownerName, email: input.email, passwordHash: input.passwordHash, googleSub: input.googleSub };
    const created = await this.withUniqueSlug(input.workspaceName, 'workspace', (slug) => this.create({ name: input.workspaceName, slug, timezone: input.timezone, plan: 'free', trialDays }, owner), async () => {
      if (await this.prisma.user.count({ where: { email: input.email } })) {
        throw new AppException('AUTH_EMAIL_TAKEN', 'An account with this email already exists. Sign in instead');
      }
    });
    return { workspaceId: created.workspaceId, userId: created.userId! };
  }

  /** Super Admin "create company": tenant without users; the caller invites the company admin (adminRoleId). */
  async provisionCompany(input: CompanyProvisionInput): Promise<ProvisionedTenant> {
    return this.withUniqueSlug(input.name, 'company', (slug) => this.create({ name: input.name, slug, timezone: input.timezone, plan: input.plan, trialDays: input.trialDays }, null));
  }

  /** Try the slug of `name`, then up to 4 random suffixes (slug races); installs the core packs on success. */
  private async withUniqueSlug(name: string, fallback: string, create: (slug: string) => Promise<ProvisionedTenant>, onUniqueViolation?: () => Promise<void>): Promise<ProvisionedTenant> {
    const base = slugify(name) || fallback;
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = attempt === 0 ? base : `${base.slice(0, 40)}-${randomBytes(3).toString('hex')}`;
      if (await this.prisma.workspace.count({ where: { slug } })) continue;
      let created: ProvisionedTenant;
      try {
        created = await create(slug);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        await onUniqueViolation?.();
        continue; // Slug race: try another suffix.
      }
      await this.installCorePacks(created.workspaceId);
      return created;
    }
    throw new AppException('CONFLICT', 'Could not create the workspace. Try a different name');
  }

  /**
   * Install generic-sales (registers it first when the registry is empty). A failure does not block signup:
   * it is recorded on the WorkspacePack row and `pnpm packs:sync` repairs it.
   */
  async installCorePacks(workspaceId: string): Promise<void> {
    try {
      await ensurePackRegistered(this.prisma, GENERIC_SALES_PACK_KEY);
      await installPack(this.prisma, workspaceId, GENERIC_SALES_PACK_KEY, { action: 'install', actor: SYSTEM_PACK_ACTOR, onError: (m) => this.logger.error(m) });
    } catch (err) {
      this.logger.error(`Core pack install failed for workspace ${workspaceId}: ${(err as Error).name}. Run pnpm packs:sync to repair.`);
    }
  }

  private create(input: TenantInput, owner: OwnerInput | null): Promise<ProvisionedTenant> {
    return this.prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.create({
        data: {
          name: input.name,
          slug: input.slug,
          timezone: input.timezone,
          businessHours: DEFAULT_BUSINESS_HOURS,
          holidays: [],
          status: input.trialDays > 0 ? 'trial' : 'active',
          plan: input.plan,
          trialEndsAt: input.trialDays > 0 ? new Date(Date.now() + input.trialDays * 86_400_000) : null,
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

      const pipeline = await tx.pipeline.create({ data: { workspaceId, key: DEFAULT_PIPELINE_KEY, packKey: GENERIC_SALES_PACK_KEY, name: 'Sales', isDefault: true } });
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
          packKey: GENERIC_SALES_PACK_KEY,
        })),
      });
      if (!owner) return { workspaceId, adminRoleId: adminRole.id, userId: null };
      const user = await tx.user.create({
        data: {
          workspaceId,
          email: owner.email,
          passwordHash: owner.passwordHash,
          googleSub: owner.googleSub,
          name: owner.name,
          roleId: adminRole.id,
          status: 'offline',
        },
      });
      return { workspaceId, adminRoleId: adminRole.id, userId: user.id };
    });
  }
}
