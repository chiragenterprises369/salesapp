import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthStateModule } from '../../modules/auth/state/auth-state.module.js';
import { UserRateLimitInterceptor } from './rate-limit.js';
import { ReadinessService } from './readiness.service.js';

/**
 * Production pieces (change #20, PROD-HUB): readiness and draining, the per-user rate limit (after the guards)
 * and the request context for logs. HTTP middleware (request ids, access log, per-IP limits, body limits,
 * helmet) and the shutdown handler are installed in main.ts.
 */
@Global()
@Module({
  imports: [AuthStateModule],
  providers: [ReadinessService, { provide: APP_INTERCEPTOR, useClass: UserRateLimitInterceptor }],
  exports: [ReadinessService],
})
export class ProdModule {}
