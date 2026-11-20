import { Module, forwardRef } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { FinanceModule } from '../finance/finance.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { InventoryDeskService } from './desk.service';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ProductionService } from './production.service';
import { SalesService } from './sales.service';

@Module({
  imports: [FinanceModule, DocumentsModule, forwardRef(() => WorkflowsModule)],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryDeskService, ProductionService, SalesService],
  exports: [InventoryService, InventoryDeskService, ProductionService, SalesService],
})
export class InventoryModule {}
