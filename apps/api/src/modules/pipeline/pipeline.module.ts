import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module.js';
import { LeadsModule } from '../leads/leads.module.js';
import { PipelineController } from './pipeline.controller.js';
import { PipelineService } from './pipeline.service.js';

/** OWNER: backend-core. Pipelines, kanban board (filters + column paging), stage CRUD/reorder, lead moves (fractional index). */
@Module({
  imports: [LeadsModule, CrmModule],
  controllers: [PipelineController],
  providers: [PipelineService],
})
export class PipelineModule {}
