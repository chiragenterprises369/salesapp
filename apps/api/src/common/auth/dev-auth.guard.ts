import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission, RouteAuth } from '@vistar/shared';
import type { Request } from 'express';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AppException } from '../errors/app-exception.js';
import { AUTH_MODE_KEY, PERMISSION_KEY, type AuthContext } from './auth-context.js';

/**
 * WAVE 1 ONLY: lets API modules be exercised before the real JWT guard is merged.
 * Active only when DEV_AUTH=1 and NODE_ENV=development (env.ts refuses DEV_AUTH in production).
 * Send `x-dev-user: <seeded email>`; the guard loads that user's role and enforces the route
 * permission exactly like the real guard. Removed by the orchestrator in Wave 3.
 */
@Injectable()
export class DevAuthGuard implements CanActivate {
  private readonly logger = new Logger('DevAuthGuard');

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {
    this.logger.warn('DEV_AUTH=1: x-dev-user header authentication is enabled (development only)');
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    const mode = this.reflector.getAllAndOverride<RouteAuth | undefined>(AUTH_MODE_KEY, targets) ?? 'jwt';
    if (mode === 'public' || mode === 'super_public' || mode === 'webhook') return true;
    if (mode === 'super') throw new AppException('AUTH_UNAUTHENTICATED', 'Dev auth does not cover /api/super');

    const req = ctx.switchToHttp().getRequest<Request>();
    const email = req.headers['x-dev-user'];
    if (typeof email !== 'string' || !email) {
      throw new AppException('AUTH_UNAUTHENTICATED', 'Dev auth: send header x-dev-user with a seeded email');
    }
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { role: true } });
    if (!user || !user.isActive || user.deletedAt) throw new AppException('AUTH_INVALID_CREDENTIALS', 'Unknown dev user');

    const auth: AuthContext = {
      audience: 'workspace',
      userId: user.id,
      workspaceId: user.workspaceId,
      roleId: user.roleId,
      kind: user.role.kind,
      dataScope: user.role.dataScope,
      permissions: user.role.permissions as Permission[],
      sessionId: null,
      via: 'jwt',
      apiKeyId: null,
      impersonation: null,
    };
    req.auth = auth;

    const required = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, targets);
    if (required && !auth.permissions.includes(required)) throw new AppException('FORBIDDEN', 'You do not have permission to do this');
    return true;
  }
}
