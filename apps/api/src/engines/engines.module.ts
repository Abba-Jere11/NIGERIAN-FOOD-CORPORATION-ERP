import { Module, forwardRef } from '@nestjs/common';
import { EdmsModule } from '../edms/edms.module';
import { InventoryModule } from '../inventory/inventory.module';
import { HrModule } from '../hr/hr.module';
import { PayrollModule } from '../payroll/payroll.module';
import { OrgReportsModule } from '../org-reports/org-reports.module';
import { ProcurementModule } from '../procurement/procurement.module';
import { DiscoveryController } from './discovery.controller';
import { EnginesController } from './engines.controller';
import { EnginesService } from './engines.service';
import { JobsService } from './jobs.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { OverdueService } from './overdue.service';
import { SearchService } from './search.service';
import { TimelineService } from './timeline.service';

@Module({
  imports: [
    ProcurementModule,
    InventoryModule,
    forwardRef(() => EdmsModule),
    OrgReportsModule,
    forwardRef(() => HrModule),
    forwardRef(() => PayrollModule),
  ],
  controllers: [EnginesController, NotificationsController, DiscoveryController],
  providers: [
    NotificationsService,
    JobsService,
    EnginesService,
    SearchService,
    TimelineService,
    OverdueService,
  ],
  exports: [JobsService, NotificationsService],
})
export class EnginesModule {}
