import { Module, forwardRef } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { EdmsController } from './edms.controller';
import { EdmsService } from './edms.service';

@Module({
  imports: [DocumentsModule, forwardRef(() => WorkflowsModule)],
  controllers: [EdmsController],
  providers: [EdmsService],
  exports: [EdmsService],
})
export class EdmsModule {}
