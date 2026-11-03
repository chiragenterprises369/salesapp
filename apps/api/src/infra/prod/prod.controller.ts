import { Controller, Query, Res } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { API_ROUTES, TlsAskQuerySchema } from '@vistar/shared';
import type { Response } from 'express';
import { notFound } from '../../common/errors/app-exception.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { getEnv } from '../../config/env.js';
import { DomainsService } from '../../modules/workspace/domains.service.js';
import { ReadinessService } from './readiness.service.js';
import { mayIssueCertificate } from './tls-ask.js';

/** Verified custom domain hosts are cached briefly: Caddy asks once per new host, bursts come from scanners. */
const HOSTS_CACHE_MS = 30_000;

/**
 * Production probes (change #20, PROD-HUB; contract 20b): GET /api/ready (readiness, 200 or 503 with the same
 * body) and GET /api/tls/ask (Caddy on-demand TLS: 200 allow, 404 refuse; the Caddyfile only allows it from the
 * internal network). Liveness stays GET /api/health.
 */
@Controller()
export class ProdController {
  private hostsCache: { at: number; hosts: Set<string> } | null = null;

  constructor(
    private readonly readiness: ReadinessService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** The status code depends on the result, so the response is written here (HttpCode would force 200). */
  @ApiRoute(API_ROUTES.ready)
  async ready(@Res() res: Response): Promise<void> {
    const r = await this.readiness.check();
    res.setHeader('Cache-Control', 'no-store');
    res.status(r.ok ? 200 : 503).json(r);
  }

  @ApiRoute(API_ROUTES.tlsAsk)
  async tlsAsk(@Query(new ZodPipe(TlsAskQuerySchema)) q: { domain: string }): Promise<null> {
    if (!(await mayIssueCertificate(q.domain, getEnv(), () => this.verifiedHosts()))) throw notFound('Domain');
    return null;
  }

  private async verifiedHosts(): Promise<Set<string>> {
    if (this.hostsCache && Date.now() - this.hostsCache.at < HOSTS_CACHE_MS) return this.hostsCache.hosts;
    // Resolved lazily: ProdModule is global and must not import WorkspaceModule (module cycle).
    const domains = this.moduleRef.get(DomainsService, { strict: false });
    const hosts = new Set([...(await domains.corsHosts())].map((h) => h.toLowerCase()));
    this.hostsCache = { at: Date.now(), hosts };
    return hosts;
  }
}
