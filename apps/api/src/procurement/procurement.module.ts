import { Module, forwardRef } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';
import { VendorsModule } from '../vendors/vendors.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { BankAccountsService } from './bank-accounts.service';
import { DeliveryService } from './delivery.service';
import { FinancialChecksService } from './financial-checks.service';
import { PaymentsService } from './payments.service';
import { ProcurementController } from './procurement.controller';
import { ProcurementService } from './procurement.service';
import { RequisitionsService } from './requisitions.service';

@Module({
  imports: [WorkflowsModule, DocumentsModule, VendorsModule, FinanceModule, forwardRef(() => InventoryModule)],
  controllers: [ProcurementController],
  providers: [
    ProcurementService,
    RequisitionsService,
    FinancialChecksService,
    BankAccountsService,
    PaymentsService,
    DeliveryService,
  ],
  exports: [
    ProcurementService,
    RequisitionsService,
    FinancialChecksService,
    BankAccountsService,
    PaymentsService,
    DeliveryService,
  ],
})
export class ProcurementModule {}
