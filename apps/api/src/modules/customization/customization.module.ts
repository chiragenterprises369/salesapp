import { Module } from '@nestjs/common';
import { FieldsController } from './fields.controller.js';
import { FieldsService } from './fields.service.js';
import { LabelsController } from './labels.controller.js';
import { LabelsService } from './labels.service.js';
import { ObjectsController } from './objects.controller.js';
import { ObjectsService } from './objects.service.js';
import { RecordsController } from './records.controller.js';
import { RecordsService } from './records.service.js';

/**
 * OWNER: backend-core. Flexible data layer (SPEC 22.1): field definitions on core entities and custom
 * objects, custom object records (data scope via ownerId), display labels.
 * Core entity services (leads, tasks) use the plain helpers in custom-values.ts / unique.ts.
 */
@Module({
  controllers: [FieldsController, ObjectsController, RecordsController, LabelsController],
  providers: [FieldsService, ObjectsService, RecordsService, LabelsService],
  exports: [FieldsService, ObjectsService, LabelsService],
})
export class CustomizationModule {}
