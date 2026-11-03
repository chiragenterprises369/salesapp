import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { getEnv } from '../../config/env.js';
import { getProdEnv } from '../prod/prod-env.js';
import { PrismaClient } from '../../generated/prisma/client.js';
import { tenantClient, type TenantPrisma } from './tenant.js';

/**
 * Root Prisma client (Prisma 7 + pg driver adapter).
 * Feature code should use `prisma.forTenant(auth.workspaceId)`; the raw client is for
 * cross-tenant system jobs only (seed, schedulers that iterate workspaces).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // ---- change #20: prod (pool size and timeouts per API process; see docs/DEPLOY.md "Database")
    const pool = getProdEnv();
    super({
      adapter: new PrismaPg({
        connectionString: getEnv().DATABASE_URL,
        max: pool.DB_POOL_MAX,
        idleTimeoutMillis: pool.DB_POOL_IDLE_MS,
        connectionTimeoutMillis: pool.DB_CONNECT_TIMEOUT_MS,
        application_name: 'vistar-api',
      }),
    });
    // ---- end change #20: prod
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  forTenant(workspaceId: string): TenantPrisma {
    return tenantClient(this, workspaceId);
  }
}
