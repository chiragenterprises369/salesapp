import { Module } from '@nestjs/common';
import { AccountStatusService } from './account-status.service.js';
import { KvStore } from './kv.store.js';

/**
 * Auth state shared by AuthModule (guard, sessions) and WorkspaceModule (which must invalidate the
 * status cache and revoke sessions when it deactivates a user or changes a role).
 */
@Module({
  providers: [KvStore, AccountStatusService],
  exports: [KvStore, AccountStatusService],
})
export class AuthStateModule {}
