import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module.js';
import { PipelineController } from './pipeline.controller.js';
import { PipelineService } from './pipeline.service.js';

/** OWNER: backend-core. Pipelines, kanban board (filters + column paging), stage CRUD/reorder, lead moves (fractional index). */
@Module({
  imports: [LeadsModule],
  controllers: [PipelineController],
  providers: [PipelineService],
})
export class PipelineModule {}
