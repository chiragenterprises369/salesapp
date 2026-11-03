import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { UsageService } from './usage.service.js';

/** Meters requests made with an API key (usage metric api_calls; D-072). Runs after the auth guard; never blocks. */
@Injectable()
export class ApiCallMeterInterceptor implements NestInterceptor {
  constructor(private readonly usage: UsageService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const req = context.switchToHttp().getRequest<Request>();
      if (req.auth?.via === 'api_key' && req.auth.workspaceId) this.usage.countApiCall(req.auth.workspaceId);
    }
    return next.handle();
  }
}
