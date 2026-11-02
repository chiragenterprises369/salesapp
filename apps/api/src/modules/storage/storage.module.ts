import { Global, Module } from '@nestjs/common';
import { FilesController } from './files.controller.js';
import { StorageService } from './storage.service.js';

/**
 * OWNER: backend-core (PLATFORM stream, change #19). Upload storage adapter (D-065) and file routes.
 * Global so feature modules (branding, floors, platform config, the realtime stream's call recordings)
 * inject StorageService without importing this module.
 */
@Global()
@Module({
  controllers: [FilesController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
