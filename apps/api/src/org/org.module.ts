import { Module } from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { EntitiesService } from './entities.service';
import { DepartmentsController, EntitiesController } from './org.controller';

@Module({
  controllers: [EntitiesController, DepartmentsController],
  providers: [EntitiesService, DepartmentsService],
  exports: [EntitiesService, DepartmentsService],
})
export class OrgModule {}
