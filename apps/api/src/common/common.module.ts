import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service.js';
import { ScopeService } from './auth/scope.service.js';

/** Cross-module helpers available everywhere. OWNER: orchestrator. */
@Global()
@Module({
  providers: [ScopeService, AuditService],
  exports: [ScopeService, AuditService],
})
export class CommonModule {}
