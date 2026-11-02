import { Module } from '@nestjs/common';
import { FloorsController, SuperFloorsController } from './floors.controller.js';
import { FloorsService } from './floors.service.js';

/**
 * OWNER: backend-core (PLATFORM stream, change #19). Custom Team Floors (D-061): company floor requests with
 * reference images, Super Admin floor uploads (GLB, zipped glTF, AI-written floor plan JSON), seat maps,
 * publishing, and GET /team-floor/layout. Exports FloorsService.layoutRef() for the Team Floor snapshot.
 */
@Module({
  controllers: [FloorsController, SuperFloorsController],
  providers: [FloorsService],
  exports: [FloorsService],
})
export class FloorsModule {}
