import { Global, Module } from '@nestjs/common';
import { PublicPlatformController, SuperConfigRegistryController } from './config-registry.controller.js';
import { GoLiveService } from './go-live.service.js';
import { PlatformConfigService } from './platform-config.service.js';

/**
 * OWNER: backend-core (CONFIG-API stream, change #20). Platform config registry (Super Admin > Config), the
 * in-memory snapshot read by every module (`snapshot.ts`), the go-live checklist and the public platform info.
 * Global: PlatformConfigService.onChange() and GoLiveService.evaluate() are used by other modules.
 */
@Global()
@Module({
  controllers: [SuperConfigRegistryController, PublicPlatformController],
  providers: [PlatformConfigService, GoLiveService],
  exports: [PlatformConfigService, GoLiveService],
})
export class ConfigRegistryModule {}
