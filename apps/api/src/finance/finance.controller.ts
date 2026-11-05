import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ReportKind } from '@nfc/shared';
import { FileInterceptor } from '@nestjs/platform-express';
import type { ActorContext } from '@nfc/db';
import { memoryStorage } from 'multer';
import { ActorOnly, RequirePermission } from '../auth/require-permission.decorator';
import { CurrentActor } from '../auth/current-actor.decorator';
import { ValidationFailedError } from '../common/errors/domain-error';
import { zodPipe } from '../common/validation/zod-validation.pipe';
import { AccountsService } from './accounts.service';
import { BudgetsService } from './budgets.service';
import { CalendarService } from './calendar.service';
import {
  acknowledgeIntercompanySchema,
  bankTransferSchema,
  closePeriodSchema,
  createBillSchema,
  createBudgetSchema,
  createExpenseSchema,
  createFiscalYearSchema,
  createIncomeSchema,
  createIntercompanySchema,
  createJournalSchema,
  createReceiptSchema,
  entityScopeQuery,
  reconcileSchema,
  reverseJournalSchema,
  statementMapSchema,
  submitBudgetSchema,
  submitFinanceDocSchema,
  submitJournalSchema,
  unmatchSchema,
  updateJournalSchema,
  upsertAccountSchema,
  upsertCustomerSchema,
  reportQuerySchema,
  saveReportSetSchema,
  shareReportSchema,
  type BankTransferInput,
  type ClosePeriodInput,
  type CreateBillInput,
  type CreateBudgetInput,
  type CreateExpenseInput,
  type CreateFiscalYearInput,
  type CreateIncomeInput,
  type CreateIntercompanyInput,
  type CreateJournalInput,
  type CreateReceiptInput,
  type EntityScopeQuery,
  type ReportQueryInput,
  type SaveReportSetInput,
  type ShareReportInput,
  type ReconcileInput,
  type ReverseJournalInput,
  type UpdateJournalInput,
  type UpsertAccountInput,
  type UpsertCustomerInput,
} from './finance.dto';
import { CustomersService } from './customers.service';
import { DashboardService } from './dashboard.service';
import { ExpensesService } from './expenses.service';
import { IncomeService } from './income.service';
import { IntercompanyService } from './intercompany.service';
import { JournalsService } from './journals.service';
import { PayablesService } from './payables.service';
import { ReceivablesService } from './receivables.service';
import { IntegrityService } from './integrity.service';
import { ReportsService } from './reports.service';
import { TreasuryService } from './treasury.service';
import { ReportMailService } from '../reports/report-mail.service';

@Controller()
export class FinanceController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly calendar: CalendarService,
    private readonly journals: JournalsService,
    private readonly treasury: TreasuryService,
    private readonly budgets: BudgetsService,
    private readonly customers: CustomersService,
    private readonly income: IncomeService,
    private readonly expenses: ExpensesService,
    private readonly receivables: ReceivablesService,
    private readonly payables: PayablesService,
    private readonly intercompany: IntercompanyService,
    private readonly dashboard: DashboardService,
    private readonly reports: ReportsService,
    private readonly integrity: IntegrityService,
    private readonly reportMail: ReportMailService,
  ) {}

  @Get('api/finance/context')
  @RequirePermission('finance.view')
  context(@CurrentActor() actor: ActorContext) {
    return this.accounts.context(actor);
  }

  @Get('api/finance/queues')
  @ActorOnly()
  queues(@CurrentActor() actor: ActorContext) {
    return this.accounts.queues(actor);
  }

  @Get('api/finance/years')
  @ActorOnly()
  years(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.calendar.listYears(actor, entityId);
  }

  @Post('api/finance/years')
  @RequirePermission('finance.period.close')
  createYear(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createFiscalYearSchema)) body: CreateFiscalYearInput,
  ) {
    return this.calendar.createYear(actor, body);
  }

  @Post('api/finance/periods/:id/close')
  @RequirePermission('finance.period.close')
  closePeriod(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(closePeriodSchema)) body: ClosePeriodInput,
  ) {
    return this.calendar.closePeriod(actor, id, body.rowVersion);
  }

  @Get('api/finance/accounts')
  @RequirePermission('finance.view')
  accountsList(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.accounts.list(actor, entityId);
  }

  @Post('api/finance/accounts')
  @RequirePermission('finance.coa.manage')
  createAccount(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(upsertAccountSchema)) body: UpsertAccountInput,
  ) {
    return this.accounts.upsert(actor, body);
  }

  @Patch('api/finance/accounts/:id')
  @RequirePermission('finance.coa.manage')
  updateAccount(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(upsertAccountSchema)) body: UpsertAccountInput,
  ) {
    return this.accounts.upsert(actor, body, id);
  }

  @Post('api/finance/accounts/:id/deactivate')
  @RequirePermission('finance.coa.manage')
  deactivateAccount(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(closePeriodSchema)) body: ClosePeriodInput,
  ) {
    return this.accounts.deactivate(actor, id, body.rowVersion);
  }

  @Post('api/finance/accounts/copy-template')
  @RequirePermission('finance.coa.manage')
  copyTemplate(@CurrentActor() actor: ActorContext, @Body() body: { entityId?: string }) {
    if (!body.entityId) throw new ValidationFailedError('An entity is required.');
    return this.accounts.copyTemplate(actor, body.entityId);
  }

  @Get('api/finance/journals')
  @RequirePermission('finance.view')
  journalsList(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.journals.list(actor, entityId);
  }

  @Get('api/finance/journals/:id')
  @RequirePermission('finance.view')
  journalGet(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.journals.get(actor, id);
  }

  @Post('api/finance/journals')
  @RequirePermission('finance.journal.prepare')
  createJournal(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createJournalSchema)) body: CreateJournalInput,
  ) {
    return this.journals.create(actor, body);
  }

  @Patch('api/finance/journals/:id')
  @RequirePermission('finance.journal.prepare')
  updateJournal(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateJournalSchema)) body: UpdateJournalInput,
  ) {
    return this.journals.update(actor, id, body);
  }

  @Post('api/finance/journals/:id/submit')
  @RequirePermission('finance.journal.prepare')
  submitJournal(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(submitJournalSchema)) body: { rowVersion: number },
  ) {
    return this.journals.submit(actor, id, body.rowVersion);
  }

  @Post('api/finance/journals/:id/reverse')
  @RequirePermission('finance.journal.prepare')
  reverseJournal(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(reverseJournalSchema)) body: ReverseJournalInput,
  ) {
    return this.journals.reverse(actor, id, body);
  }

  @Get('api/finance/trial-balance')
  @RequirePermission('finance.view')
  trialBalance(
    @CurrentActor() actor: ActorContext,
    @Query(zodPipe(entityScopeQuery)) query: EntityScopeQuery,
  ) {
    return this.journals.trialBalance(actor, {
      entityId: query.entityId,
      consolidated: query.consolidated,
      periodId: query.periodId,
    });
  }

  @Get('api/finance/ledger')
  @RequirePermission('finance.view')
  ledger(
    @CurrentActor() actor: ActorContext,
    @Query('accountId') accountId?: string,
    @Query('periodId') periodId?: string,
  ) {
    if (!accountId) throw new ValidationFailedError('An account is required.');
    return this.journals.ledger(actor, accountId, periodId);
  }

  @Get('api/finance/bank-accounts/:id/transactions')
  @ActorOnly()
  bankTransactions(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.treasury.listTransactions(actor, id);
  }

  @Post('api/finance/bank-transfers')
  @RequirePermission('finance.bank.manage')
  bankTransfer(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(bankTransferSchema)) body: BankTransferInput,
  ) {
    return this.treasury.transfer(actor, body);
  }

  @Get('api/finance/bank-accounts/:id/statements')
  @ActorOnly()
  statements(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.treasury.listStatements(actor, id);
  }

  @Post('api/finance/bank-accounts/:id/statements')
  @RequirePermission('finance.bank.manage')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5_000_000 } }))
  importStatement(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('mapping') mappingJson?: string,
  ) {
    if (!file) throw new ValidationFailedError('A statement file is required.');
    const mapping = statementMapSchema.parse(mappingJson ? JSON.parse(mappingJson) : {});
    return this.treasury.importStatement(actor, id, file.originalname, file.buffer, mapping);
  }

  @Post('api/finance/reconcile')
  @RequirePermission('finance.reconcile')
  reconcile(@CurrentActor() actor: ActorContext, @Body(zodPipe(reconcileSchema)) body: ReconcileInput) {
    return this.treasury.match(actor, body);
  }

  @Post('api/finance/reconcile/:lineId/unmatch')
  @RequirePermission('finance.reconcile')
  unmatch(
    @CurrentActor() actor: ActorContext,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body(zodPipe(unmatchSchema)) body: { reason: string },
  ) {
    return this.treasury.unmatch(actor, lineId, body.reason);
  }

  @Get('api/finance/bank-accounts/:id/reconciliation')
  @ActorOnly()
  reconciliation(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('periodId') periodId?: string,
  ) {
    return this.treasury.report(actor, id, periodId);
  }

  @Get('api/finance/budgets')
  @ActorOnly()
  budgetsList(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.budgets.list(actor, entityId);
  }

  @Get('api/finance/budget-activity')
  @ActorOnly()
  budgetActivity(
    @CurrentActor() actor: ActorContext,
    @Query('metric') metric: string,
    @Query('entityId') entityId?: string,
    @Query('budgetId') budgetId?: string,
  ) {
    return this.budgets.activity(actor, metric ?? '', entityId, budgetId);
  }

  @Get('api/finance/budgets/:id')
  @ActorOnly()
  budgetGet(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.budgets.get(actor, id);
  }

  @Post('api/finance/budgets')
  @RequirePermission('finance.budget.prepare')
  createBudget(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createBudgetSchema)) body: CreateBudgetInput,
  ) {
    return this.budgets.create(actor, body);
  }

  @Post('api/finance/budgets/:id/submit')
  @RequirePermission('finance.budget.prepare')
  submitBudget(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(submitBudgetSchema)) body: { rowVersion: number },
  ) {
    return this.budgets.submit(actor, id, body.rowVersion);
  }

  @Get('api/finance/dashboard')
  @ActorOnly()
  financeDashboard(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.dashboard.get(actor, entityId);
  }

  @Get('api/finance/customers')
  @ActorOnly()
  customersList(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.customers.list(actor, entityId);
  }

  @Get('api/finance/customers/:id')
  @ActorOnly()
  customerGet(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(actor, id);
  }

  @Get('api/finance/customers/:id/statement')
  @ActorOnly()
  customerStatement(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.receivables.statement(actor, id);
  }

  @Post('api/finance/customers')
  @RequirePermission('finance.customer.manage')
  createCustomer(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(upsertCustomerSchema)) body: UpsertCustomerInput,
  ) {
    return this.customers.upsert(actor, body);
  }

  @Patch('api/finance/customers/:id')
  @RequirePermission('finance.customer.manage')
  updateCustomer(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(upsertCustomerSchema)) body: UpsertCustomerInput,
  ) {
    return this.customers.upsert(actor, body, id);
  }

  @Get('api/finance/income')
  @ActorOnly()
  incomeList(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.income.list(actor, entityId);
  }

  @Get('api/finance/income/:id')
  @ActorOnly()
  incomeGet(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.income.get(actor, id);
  }

  @Post('api/finance/income')
  @RequirePermission('finance.income.manage')
  createIncome(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createIncomeSchema)) body: CreateIncomeInput,
  ) {
    return this.income.create(actor, body);
  }

  @Post('api/finance/income/:id/submit')
  @RequirePermission('finance.income.manage')
  submitIncome(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(submitFinanceDocSchema)) body: { rowVersion: number },
  ) {
    return this.income.submit(actor, id, body.rowVersion);
  }

  @Get('api/finance/expenses')
  @ActorOnly()
  expensesList(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.expenses.list(actor, entityId);
  }

  @Get('api/finance/expenses/:id')
  @ActorOnly()
  expenseGet(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.expenses.get(actor, id);
  }

  @Post('api/finance/expenses')
  @RequirePermission('finance.expense.manage')
  createExpense(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createExpenseSchema)) body: CreateExpenseInput,
  ) {
    return this.expenses.create(actor, body);
  }

  @Post('api/finance/expenses/:id/submit')
  @RequirePermission('finance.expense.manage')
  submitExpense(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(submitFinanceDocSchema)) body: { rowVersion: number },
  ) {
    return this.expenses.submit(actor, id, body.rowVersion);
  }

  @Get('api/finance/receivables')
  @ActorOnly()
  receivablesList(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.receivables.listInvoices(actor, entityId);
  }

  @Get('api/finance/receivables/aging')
  @ActorOnly()
  receivablesAging(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.receivables.aging(actor, entityId);
  }

  @Post('api/finance/receipts')
  @RequirePermission('finance.receivables.manage')
  createReceipt(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createReceiptSchema)) body: CreateReceiptInput,
  ) {
    return this.receivables.recordReceipt(actor, body);
  }

  @Get('api/finance/payables')
  @ActorOnly()
  payablesList(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.payables.list(actor, entityId);
  }

  @Get('api/finance/payables/:id')
  @ActorOnly()
  payableGet(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.payables.get(actor, id);
  }

  @Post('api/finance/payables')
  @RequirePermission('finance.payables.manage')
  createBill(@CurrentActor() actor: ActorContext, @Body(zodPipe(createBillSchema)) body: CreateBillInput) {
    return this.payables.createBill(actor, body);
  }

  @Post('api/finance/payables/:id/submit')
  @RequirePermission('finance.payables.manage')
  submitBill(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(submitFinanceDocSchema)) body: { rowVersion: number },
  ) {
    return this.payables.submit(actor, id, body.rowVersion);
  }

  @Get('api/finance/intercompany')
  @ActorOnly()
  intercompanyList(@CurrentActor() actor: ActorContext) {
    return this.intercompany.list(actor);
  }

  @Get('api/finance/intercompany/mismatches')
  @ActorOnly()
  intercompanyMismatches(@CurrentActor() actor: ActorContext) {
    return this.intercompany.mismatches(actor);
  }

  @Get('api/finance/intercompany/:id')
  @ActorOnly()
  intercompanyGet(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.intercompany.get(actor, id);
  }

  @Post('api/finance/intercompany')
  @RequirePermission('finance.intercompany.create')
  createIntercompany(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createIntercompanySchema)) body: CreateIntercompanyInput,
  ) {
    return this.intercompany.create(actor, body);
  }

  @Post('api/finance/intercompany/:id/acknowledge')
  @RequirePermission('finance.intercompany.acknowledge')
  acknowledgeIntercompany(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(acknowledgeIntercompanySchema)) body: { rowVersion: number; reason?: string },
  ) {
    return this.intercompany.acknowledge(actor, id, body.rowVersion, body.reason);
  }

  @Get('api/finance/reports')
  @RequirePermission('finance.view')
  reportCatalog(@CurrentActor() actor: ActorContext) {
    return this.reports.catalog(actor);
  }

  @Get('api/finance/reports/integrity')
  @RequirePermission('finance.view')
  integrityReport(
    @CurrentActor() actor: ActorContext,
    @Query(zodPipe(reportQuerySchema)) query: ReportQueryInput,
  ) {
    return this.integrity.report(actor, query);
  }

  @Get('api/finance/reports/eliminations')
  @RequirePermission('finance.view')
  async eliminations(
    @CurrentActor() actor: ActorContext,
    @Query(zodPipe(reportQuerySchema)) query: ReportQueryInput,
  ) {
    return this.reports.run(actor, 'eliminations', query);
  }

  @Get('api/finance/reports/drill')
  @RequirePermission('finance.view')
  reportDrill(
    @CurrentActor() actor: ActorContext,
    @Query(zodPipe(reportQuerySchema)) query: ReportQueryInput,
  ) {
    return this.reports.drill(actor, query);
  }

  @Get('api/finance/report-sets')
  @RequirePermission('finance.view')
  reportSets(@CurrentActor() actor: ActorContext) {
    return this.reports.listSets(actor);
  }

  @Post('api/finance/report-sets')
  @RequirePermission('finance.view')
  saveReportSet(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(saveReportSetSchema)) body: SaveReportSetInput,
  ) {
    return this.reports.saveSet(actor, { ...body, params: body.params ?? {} });
  }

  @Post('api/finance/report-sets/:id/inactive')
  @RequirePermission('finance.view')
  inactivateReportSet(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.inactivateSet(actor, id);
  }

  @Post('api/finance/reports/:kind/email')
  @RequirePermission('reports.email')
  shareReport(
    @CurrentActor() actor: ActorContext,
    @Param('kind') kind: ReportKind,
    @Body(zodPipe(shareReportSchema)) body: ShareReportInput,
  ) {
    return this.reportMail.share(actor, kind, body);
  }

  @Get('api/finance/reports/:kind/export')
  @RequirePermission('finance.view')
  async exportReport(
    @CurrentActor() actor: ActorContext,
    @Param('kind') kind: ReportKind,
    @Query(zodPipe(reportQuerySchema)) query: ReportQueryInput,
    @Res() response: Response,
  ): Promise<void> {
    const raw = (query.format ?? 'csv').toUpperCase();
    const format = raw === 'XLSX' || raw === 'PDF' || raw === 'CSV' ? raw : 'CSV';
    const exported = await this.reports.export(actor, kind, query, format);
    response.setHeader('Content-Type', exported.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    response.send(exported.buffer);
  }

  @Get('api/finance/reports/:kind')
  @RequirePermission('finance.view')
  runReport(
    @CurrentActor() actor: ActorContext,
    @Param('kind') kind: ReportKind,
    @Query(zodPipe(reportQuerySchema)) query: ReportQueryInput,
  ) {
    return this.reports.run(actor, kind, query);
  }
}
