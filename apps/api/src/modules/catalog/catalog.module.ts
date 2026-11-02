import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

/** OWNER: backend-core (CRM-API, change #19 wave B). Products and price lists; line resolution helpers in line-resolver.ts. */
@Module({
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
