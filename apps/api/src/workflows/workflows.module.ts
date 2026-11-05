import { Module, forwardRef } from '@nestjs/common';
import { EdmsModule } from '../edms/edms.module';
import { FinanceModule } from '../finance/finance.module';
import { HrModule } from '../hr/hr.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PayrollModule } from '../payroll/payroll.module';
import { SealsService } from '../seals/seals.service';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

@Module({
  imports: [
    forwardRef(() => FinanceModule),
    forwardRef(() => InventoryModule),
    forwardRef(() => EdmsModule),
    forwardRef(() => HrModule),
    forwardRef(() => PayrollModule),
  ],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, SealsService],
  exports: [WorkflowsService, SealsService],
})
export class WorkflowsModule {}
