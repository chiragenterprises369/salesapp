import { Injectable, Logger } from '@nestjs/common';
import {
  CUSTOM_DOMAIN_TXT_PREFIX,
  CUSTOM_DOMAIN_TXT_VALUE_PREFIX,
  HostnameSchema,
  ThemeModeSchema,
  type CustomDomain,
  type CustomDomainState,
  type HostResolution,
  type PublicWorkspace,
} from '@vistar/shared';
import type { Request } from 'express';
import { resolveTxt } from 'node:dns/promises';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import { getEnv } from '../../config/env.js';
import type { CustomDomain as CustomDomainRow } from '../../generated/prisma/client.js';
import { randomToken } from '../../infra/crypto/secrets.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { BrandingService } from './branding.service.js';
import { SettingsService } from './settings.service.js';
import { WorkspaceService } from './workspace.service.js';

const DNS_TIMEOUT_MS = 5000;
const LIVE_STATUSES = ['active', 'trial'] as const;

/**
 * Custom domains (D-060): one per company, only with the `custom_domain` flag (Super Admin switch).
 * Ownership check: TXT `_vistar-verify.<hostname>` = `vistar-verify=<token>`. Outside production,
 * `*.localhost` names verify without DNS (local testing). Host resolution serves only verified domains of
 * companies whose switch is still on; in development `<slug>.localhost` also resolves by slug.
 */
@Injectable()
export class DomainsService {
  private readonly logger = new Logger(DomainsService.name);
  private readonly env = getEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspaceService,
    private readonly branding: BrandingService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private get dev(): boolean {
    return this.env.NODE_ENV !== 'production';
  }

  private toDomain(row: CustomDomainRow): CustomDomain {
    return {
      id: row.id,
      hostname: row.hostname,
      status: row.status,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      lastError: row.lastError,
      dns: {
        cname: { name: row.hostname, value: this.env.CUSTOM_DOMAIN_CNAME_TARGET },
        txt: { name: `${CUSTOM_DOMAIN_TXT_PREFIX}.${row.hostname}`, value: `${CUSTOM_DOMAIN_TXT_VALUE_PREFIX}${row.txtToken}` },
      },
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async enabled(workspaceId: string): Promise<boolean> {
    const db = this.prisma.forTenant(workspaceId);
    const ws = await db.workspace.findFirst({ select: { plan: true } });
    if (!ws) throw notFound('Workspace');
    return (await this.workspaces.features(db, ws.plan)).custom_domain;
  }

  async state(workspaceId: string): Promise<CustomDomainState> {
    const [enabled, row] = await Promise.all([this.enabled(workspaceId), this.prisma.forTenant(workspaceId).customDomain.findFirst({})]);
    return { enabled, domain: row ? this.toDomain(row) : null };
  }

  private async requireEnabled(workspaceId: string): Promise<void> {
    if (!(await this.enabled(workspaceId))) throw new AppException('FEATURE_DISABLED', 'Custom domains are not enabled for your company. Ask Vistar support to switch them on');
  }

  async set(auth: AuthContext, req: Request, hostname: string): Promise<CustomDomainState> {
    const wid = auth.workspaceId;
    await this.requireEnabled(wid);
    if (hostname.endsWith('.localhost') && !this.dev) throw new AppException('DOMAIN_INVALID', 'Use a public domain name');
    const apiHost = new URL(this.env.API_PUBLIC_URL).hostname;
    if (hostname === apiHost || hostname === this.env.CUSTOM_DOMAIN_CNAME_TARGET) throw new AppException('DOMAIN_INVALID', 'This domain belongs to Vistar');
    const db = this.prisma.forTenant(wid);
    // Root client: a hostname is unique across all companies.
    const taken = await this.prisma.customDomain.findUnique({ where: { hostname }, select: { workspaceId: true } });
    if (taken && taken.workspaceId !== wid) throw new AppException('DOMAIN_TAKEN', 'Another company already uses this domain');
    const before = await db.customDomain.findFirst({});
    if (before?.hostname === hostname) return this.state(wid);
    const data = { hostname, status: 'pending' as const, txtToken: randomToken(18), verifiedAt: null, lastCheckedAt: null, lastError: null };
    if (before) await db.customDomain.update({ where: { id: before.id }, data });
    else await db.customDomain.create({ data: { workspaceId: wid, ...data } });
    await this.audit.record(auth, req, { action: 'domain.set', entityType: 'custom_domain', entityId: wid, diff: { hostname: { from: before?.hostname ?? null, to: hostname } } });
    return this.state(wid);
  }

  async remove(auth: AuthContext, req: Request): Promise<CustomDomainState> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const row = await db.customDomain.findFirst({});
    if (row) {
      await db.customDomain.deleteMany({});
      await this.audit.record(auth, req, { action: 'domain.delete', entityType: 'custom_domain', entityId: auth.workspaceId, diff: { hostname: { from: row.hostname, to: null } } });
    }
    return this.state(auth.workspaceId);
  }

  async verify(auth: AuthContext, req: Request): Promise<CustomDomainState> {
    const wid = auth.workspaceId;
    await this.requireEnabled(wid);
    const db = this.prisma.forTenant(wid);
    const row = await db.customDomain.findFirst({});
    if (!row) throw notFound('Custom domain');
    const expected = `${CUSTOM_DOMAIN_TXT_VALUE_PREFIX}${row.txtToken}`;
    let ok = false;
    let error: string | null = null;
    if (this.dev && row.hostname.endsWith('.localhost')) {
      ok = true;
    } else {
      try {
        const records = await Promise.race([
          resolveTxt(`${CUSTOM_DOMAIN_TXT_PREFIX}.${row.hostname}`),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), DNS_TIMEOUT_MS)),
        ]);
        ok = records.some((parts) => parts.join('').trim() === expected);
        if (!ok) error = `TXT ${CUSTOM_DOMAIN_TXT_PREFIX}.${row.hostname} does not contain ${expected} yet. DNS changes can take up to an hour`;
      } catch (err) {
        const code = (err as { code?: string }).code;
        error = code === 'ENOTFOUND' || code === 'ENODATA' ? `No TXT record found at ${CUSTOM_DOMAIN_TXT_PREFIX}.${row.hostname}` : 'The DNS lookup failed. Try again in a few minutes';
      }
    }
    const now = new Date();
    await db.customDomain.update({
      where: { id: row.id },
      data: ok ? { status: 'verified', verifiedAt: now, lastCheckedAt: now, lastError: null } : { status: 'failed', lastCheckedAt: now, lastError: error },
    });
    await this.audit.record(auth, req, { action: ok ? 'domain.verified' : 'domain.verify_failed', entityType: 'custom_domain', entityId: wid, diff: { hostname: row.hostname } });
    if (!ok) this.logger.log(`Domain check failed for workspace ${wid}`);
    return this.state(wid);
  }

  // ---------------------------------------------------------------- public (no auth)

  async publicWorkspace(workspaceId: string): Promise<PublicWorkspace | null> {
    const db = this.prisma.forTenant(workspaceId);
    const ws = await db.workspace.findFirst({ select: { name: true, slug: true, status: true, deletedAt: true, defaultTheme: true } });
    if (!ws || ws.deletedAt || !LIVE_STATUSES.includes(ws.status as (typeof LIVE_STATUSES)[number])) return null;
    const [branding, values] = await Promise.all([this.branding.get(db, workspaceId), this.settings.getWorkspaceSettings(db, workspaceId)]);
    return { slug: ws.slug, name: branding.displayName ?? ws.name, branding, componentStyle: values.componentStyle, defaultTheme: ThemeModeSchema.catch('system').parse(ws.defaultTheme) };
  }

  async publicBySlug(slug: string): Promise<PublicWorkspace> {
    const ws = await this.prisma.workspace.findUnique({ where: { slug }, select: { id: true } });
    const out = ws ? await this.publicWorkspace(ws.id) : null;
    if (!out) throw notFound('Workspace');
    return out;
  }

  async resolveHost(rawHost: string): Promise<HostResolution> {
    const host = rawHost.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
    const parsed = HostnameSchema.safeParse(host);
    if (!parsed.success) throw notFound('Workspace');
    const domain = await this.prisma.customDomain.findUnique({ where: { hostname: parsed.data }, select: { workspaceId: true, status: true } });
    if (domain?.status === 'verified' && (await this.enabled(domain.workspaceId))) {
      const ws = await this.publicWorkspace(domain.workspaceId);
      if (ws) return { host, source: 'custom_domain', workspace: ws };
    }
    if (this.dev && host.endsWith('.localhost')) {
      const slug = host.slice(0, -'.localhost'.length).split('.').pop() ?? '';
      const ws = await this.prisma.workspace.findUnique({ where: { slug }, select: { id: true } });
      const out = ws ? await this.publicWorkspace(ws.id) : null;
      if (out) return { host, source: 'dev_localhost', workspace: out };
    }
    throw notFound('Workspace');
  }
}
