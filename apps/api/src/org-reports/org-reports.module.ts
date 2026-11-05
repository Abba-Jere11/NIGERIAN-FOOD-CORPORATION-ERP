import { Module, forwardRef } from '@nestjs/common';
import { PayrollModule } from '../payroll/payroll.module';
import { OrgReportsController } from './org-reports.controller';
import { OrgReportsService } from './org-reports.service';

@Module({
  imports: [forwardRef(() => PayrollModule)],
  controllers: [OrgReportsController],
  providers: [OrgReportsService],
  exports: [OrgReportsService],
})
export class OrgReportsModule {}
