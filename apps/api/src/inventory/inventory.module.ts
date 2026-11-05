import { Module, forwardRef } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ProductionService } from './production.service';
import { SalesService } from './sales.service';

@Module({
  imports: [FinanceModule, forwardRef(() => WorkflowsModule)],
  controllers: [InventoryController],
  providers: [InventoryService, ProductionService, SalesService],
  exports: [InventoryService, ProductionService, SalesService],
})
export class InventoryModule {}
