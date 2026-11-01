import { Module } from '@nestjs/common';
import { PacksController } from './packs.controller.js';
import { PacksService } from './packs.service.js';
import { SuperPacksController } from './super-packs.controller.js';
import { SuperPacksService } from './super-packs.service.js';

/**
 * OWNER: backend-core. Industry Packs (SPEC 22): installer (pack-installer.ts), registry sync
 * (pack-registry.ts), company admin routes (/packs*) and the Super Admin registry (/api/super/packs*).
 * The installer and registry are plain functions taking the root Prisma client so scripts/packs-sync.ts,
 * the workspace provisioner and prisma/seed.ts reuse them.
 */
@Module({
  controllers: [PacksController, SuperPacksController],
  providers: [PacksService, SuperPacksService],
  exports: [PacksService],
})
export class PacksModule {}
