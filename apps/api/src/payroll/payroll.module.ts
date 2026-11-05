import { Module, forwardRef } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { FinanceModule } from '../finance/finance.module';
import { HrModule } from '../hr/hr.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

@Module({
  imports: [
    forwardRef(() => WorkflowsModule),
    forwardRef(() => HrModule),
    FinanceModule,
    DocumentsModule,
  ],
  controllers: [PayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
