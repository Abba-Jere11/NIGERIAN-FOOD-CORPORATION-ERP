import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { VendorQueriesService } from './vendor-queries.service';
import { VendorValidationService } from './vendor-validation.service';
import { VendorsController } from './vendors.controller';
import { VendorsService } from './vendors.service';

@Module({
  imports: [WorkflowsModule, DocumentsModule],
  controllers: [VendorsController],
  providers: [VendorsService, VendorValidationService, VendorQueriesService],
  exports: [VendorsService, VendorValidationService, VendorQueriesService],
})
export class VendorsModule {}
