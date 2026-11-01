import { Global, Module } from '@nestjs/common';
import { ScopeService } from './auth/scope.service.js';

/** Cross-module helpers available everywhere. OWNER: orchestrator. */
@Global()
@Module({
  providers: [ScopeService],
  exports: [ScopeService],
})
export class CommonModule {}
