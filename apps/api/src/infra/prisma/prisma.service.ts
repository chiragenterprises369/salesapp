import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { getEnv } from '../../config/env.js';
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
    super({ adapter: new PrismaPg({ connectionString: getEnv().DATABASE_URL }) });
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
