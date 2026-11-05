import { Module } from '@nestjs/common';
import { EnginesModule } from '../engines/engines.module';
import { FinanceModule } from '../finance/finance.module';
import { HrModule } from '../hr/hr.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProcurementModule } from '../procurement/procurement.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';

@Module({
  imports: [WorkflowsModule, FinanceModule, HrModule, InventoryModule, EnginesModule, ProcurementModule],
  controllers: [HomeController],
  providers: [HomeService],
  exports: [HomeService],
})
export class HomeModule {}
