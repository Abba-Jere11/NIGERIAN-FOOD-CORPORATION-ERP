import { Module, forwardRef } from '@nestjs/common';
import { WorkflowsModule } from '../workflows/workflows.module';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';
import { InvitesService } from './invites.service';

@Module({
  imports: [forwardRef(() => WorkflowsModule)],
  controllers: [HrController],
  providers: [HrService, InvitesService],
  exports: [HrService, InvitesService],
})
export class HrModule {}
