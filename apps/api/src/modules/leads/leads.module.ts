import { Module } from '@nestjs/common';
import { ActivityService } from './activity.service.js';
import { LeadBulkService } from './lead-bulk.service.js';
import { LeadMetaService } from './lead-meta.service.js';
import { LeadsController } from './leads.controller.js';
import { LeadsService } from './leads.service.js';

/**
 * OWNER: backend-core. Leads CRUD, search/filters, saved views, bulk actions, import/export, dedupe/merge, timeline, notes, scoring.
 * Exports LeadsService + ActivityService for the pipeline, tasks and dashboard modules.
 */
@Module({
  controllers: [LeadsController],
  providers: [LeadsService, LeadBulkService, LeadMetaService, ActivityService],
  exports: [LeadsService, ActivityService],
})
export class LeadsModule {}
