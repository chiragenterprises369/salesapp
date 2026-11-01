import { Controller, Inject } from '@nestjs/common';
import { API_ROUTES } from '@vistar/shared';
import type { Redis } from 'ioredis';
import { ApiRoute } from '../common/http/api-route.decorator.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { REDIS } from '../infra/redis/redis.module.js';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis | null,
  ) {}

  @ApiRoute(API_ROUTES.health)
  async health() {
    const db = await this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    const redis = this.redis ? await this.redis.ping().then((r) => r === 'PONG').catch(() => false) : false;
    return { ok: db, db, redis, version: process.env.npm_package_version ?? '0.1.0' };
  }
}
