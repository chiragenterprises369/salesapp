import { Module } from '@nestjs/common';
import { ActivityService } from './activity.service.js';
import { LeadExportService } from './import/lead-export.service.js';
import { LeadImportController } from './import/lead-import.controller.js';
import { LeadImportService } from './import/lead-import.service.js';
import { LeadBulkService } from './lead-bulk.service.js';
import { LeadMetaService } from './lead-meta.service.js';
import { LeadsController } from './leads.controller.js';
import { LeadsService } from './leads.service.js';

/**
 * OWNER: backend-core. Leads CRUD, search/filters, saved views, bulk actions, import/export, dedupe/merge, timeline, notes, scoring.
 * Exports LeadsService + ActivityService for the pipeline, tasks and dashboard modules.
 */
@Module({
  // LeadImportController first: its static `/leads/export` route must be registered before `/leads/:id`.
  controllers: [LeadImportController, LeadsController],
  providers: [LeadsService, LeadBulkService, LeadMetaService, LeadImportService, LeadExportService, ActivityService],
  exports: [LeadsService, ActivityService],
})
export class LeadsModule {}
