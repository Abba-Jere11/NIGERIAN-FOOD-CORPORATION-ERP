import { Module, forwardRef } from '@nestjs/common';
import { WorkflowsModule } from '../workflows/workflows.module';
import { AccountsService } from './accounts.service';
import { BudgetsService } from './budgets.service';
import { CalendarService } from './calendar.service';
import { CustomersService } from './customers.service';
import { ConsolidationService } from './consolidation.service';
import { DashboardService } from './dashboard.service';
import { ExpensesService } from './expenses.service';
import { FinanceController } from './finance.controller';
import { IncomeService } from './income.service';
import { IntegrityService } from './integrity.service';
import { IntercompanyService } from './intercompany.service';
import { JournalsService } from './journals.service';
import { LedgerPostingService } from './ledger-posting.service';
import { PayablesService } from './payables.service';
import { ReceivablesService } from './receivables.service';
import { ReportsService } from './reports.service';
import { TreasuryService } from './treasury.service';
import { ReportMailService } from '../reports/report-mail.service';

@Module({
  imports: [forwardRef(() => WorkflowsModule)],
  controllers: [FinanceController],
  providers: [
    AccountsService,
    CalendarService,
    JournalsService,
    TreasuryService,
    BudgetsService,
    LedgerPostingService,
    CustomersService,
    IncomeService,
    ExpensesService,
    ReceivablesService,
    PayablesService,
    IntercompanyService,
    DashboardService,
    ConsolidationService,
    ReportsService,
    IntegrityService,
    ReportMailService,
  ],
  exports: [
    AccountsService,
    CalendarService,
    JournalsService,
    TreasuryService,
    BudgetsService,
    LedgerPostingService,
    CustomersService,
    IncomeService,
    ExpensesService,
    ReceivablesService,
    PayablesService,
    IntercompanyService,
    DashboardService,
    ConsolidationService,
    ReportsService,
    IntegrityService,
  ],
})
export class FinanceModule {}
