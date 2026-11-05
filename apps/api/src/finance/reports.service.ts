import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type {
  AgingBucket,
  LedgerDrillEntryView,
  ReportCatalogItem,
  ReportFormat,
  ReportKind,
  ReportParameterSetView,
  ReportRowView,
  ReportView,
} from '@nfc/shared';
import { REPORT_KINDS } from '@nfc/shared';
import { assertCan, can } from '../auth/can';
import { ForbiddenError, NotFoundError, ValidationFailedError } from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import {
  applyEliminations,
  fetchCodeBalances,
  listEliminationRows,
  netFor,
  postedPairTotal,
  type CodeBalance,
} from './consolidation.service';
import type { ReportQuery, ReportWindow } from './report-window';
import { resolveReportWindow } from './report-window';
import { reportToCsv, reportToPdf, reportToXlsx, resultHash } from './report-export';
import { sourceHref } from './source-href';

export const REPORT_CATALOG: ReportCatalogItem[] = [
  { kind: 'income_statement', title: 'Income statement', description: 'Period income and expenditure.' },
  { kind: 'balance_sheet', title: 'Balance sheet', description: 'Position at period end, including current-year earnings.' },
  { kind: 'cash_flow', title: 'Cash-flow statement', description: 'Bank movements classified by kind.' },
  { kind: 'trial_balance', title: 'Trial balance', description: 'Posted debits and credits after eliminations when consolidated.' },
  { kind: 'general_ledger', title: 'General ledger', description: 'Posted lines for the selected window.' },
  { kind: 'budget_vs_actual', title: 'Budget vs actual', description: 'Approved budget against paid, actual and GL.' },
  { kind: 'expense_analysis', title: 'Expense analysis', description: 'Operating and other expenses by account.' },
  { kind: 'revenue_analysis', title: 'Revenue analysis', description: 'Income accounts for the period.' },
  { kind: 'payables', title: 'Payables', description: 'Outstanding vendor bills and procurement payables.' },
  { kind: 'receivables_aging', title: 'Receivables aging', description: 'Customer invoices by ageing bucket.' },
  { kind: 'procurement_expenditure', title: 'Procurement expenditure', description: 'Paid procurement against requests.' },
  {
    kind: 'subsidiary_comparison',
    title: 'Subsidiary comparison',
    description: 'Entity columns plus eliminations and group.',
    consolidatedOnly: true,
  },
  {
    kind: 'consolidated_statements',
    title: 'Consolidated statements',
    description: 'Income statement, balance sheet and trial balance pack.',
    consolidatedOnly: true,
  },
  { kind: 'intercompany', title: 'Inter-company', description: 'IC register and elimination worksheet.' },
  {
    kind: 'payroll_summary',
    title: 'Payroll summary',
    description: 'Locked and paid payroll totals. Aggregate only — no employee names.',
  },
  { kind: 'integrity', title: 'Integrity', description: 'Ledger versus subledger checks.' },
  { kind: 'eliminations', title: 'Eliminations', description: 'Inter-company pairs eliminated on consolidation.' },
];

@Injectable()
export class ReportsService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  catalog(actor: ActorContext): ReportCatalogItem[] {
    if (!can(actor, 'finance.view')) throw new ForbiddenError('You cannot view reports.');
    const consolidated = can(actor, 'finance.view.consolidated');
    return REPORT_CATALOG.filter((item) => {
      if (!consolidated && item.consolidatedOnly) return false;
      if (item.kind === 'payroll_summary' && !can(actor, 'payroll.view')) return false;
      return true;
    });
  }

  async run(
    actor: ActorContext,
    kind: ReportKind,
    query: ReportQuery,
    format: ReportFormat = 'SCREEN',
  ): Promise<ReportView> {
    this.assertKind(kind);
    if (kind === 'payroll_summary') assertCan(actor, 'payroll.view', query.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      const scope = this.resolveScope(actor, query);
      const window = await resolveReportWindow(tx, { ...query, ...scope });
      const view = await this.build(tx, kind, scope, window);
      const hash = resultHash(view);
      const reference = await this.insertRun(tx, actor, kind, scope, query, hash, format, view);
      view.runReference = reference;
      return view;
    });
  }

  async export(
    actor: ActorContext,
    kind: ReportKind,
    query: ReportQuery,
    format: Exclude<ReportFormat, 'SCREEN'>,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string; view: ReportView }> {
    const view = await this.run(actor, kind, query, format);
    const stamp = view.runReference;
    if (format === 'CSV') {
      return {
        buffer: Buffer.from(reportToCsv(view), 'utf8'),
        filename: `${stamp}.csv`,
        contentType: 'text/csv; charset=utf-8',
        view,
      };
    }
    if (format === 'XLSX') {
      return {
        buffer: await reportToXlsx(view),
        filename: `${stamp}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        view,
      };
    }
    return {
      buffer: await reportToPdf(view),
      filename: `${stamp}.pdf`,
      contentType: 'application/pdf',
      view,
    };
  }

  async drill(actor: ActorContext, query: ReportQuery & { accountCodes?: string }): Promise<LedgerDrillEntryView[]> {
    if (!can(actor, 'finance.view')) throw new ForbiddenError('You cannot view the ledger.');
    const codes = (query.accountCodes ?? '')
      .split(',')
      .map((code) => code.trim())
      .filter(Boolean);
    if (codes.length === 0) throw new ValidationFailedError('Account codes are required to drill.');
    return this.unitOfWork.read(actor, async (tx) => {
      const scope = this.resolveScope(actor, query);
      const window = await resolveReportWindow(tx, { ...query, ...scope });
      const result = await tx.client.query<{
        journal_id: string;
        journal_line_id: string;
        journal_reference: string;
        occurred_on: Date;
        narration: string;
        debit_kobo: string;
        credit_kobo: string;
        account_code: string;
        account_name: string;
        entity_id: string;
        entity_code: string | null;
        procurement_request_id: string | null;
        intercompany_transaction_id: string | null;
        payable_invoice_id: string | null;
        receivable_invoice_id: string | null;
        customer_id: string | null;
        source: string;
      }>(
        `SELECT j.id AS journal_id, l.id AS journal_line_id, j.reference_number AS journal_reference,
                p.starts_on AS occurred_on, coalesce(l.narration, j.narration) AS narration,
                l.debit_kobo::text, l.credit_kobo::text, a.code AS account_code, a.name AS account_name,
                j.entity_id, e.code AS entity_code, l.procurement_request_id, l.intercompany_transaction_id,
                l.payable_invoice_id, l.receivable_invoice_id, l.customer_id, j.source
           FROM journal_lines l
           JOIN journals j ON j.id = l.journal_id
           JOIN accounts a ON a.id = l.account_id
           JOIN entities e ON e.id = j.entity_id
           JOIN fiscal_periods p ON p.id = j.fiscal_period_id
          WHERE j.status = 'POSTED'
            AND a.consolidation_code = ANY ($1::text[])
            AND ($2::uuid IS NULL OR j.entity_id = $2)
            AND ($3::date IS NULL OR p.ends_on <= $3::date)
            AND ($4::date IS NULL OR p.starts_on >= $4::date)
          ORDER BY p.starts_on, j.reference_number`,
        [codes, scope.entityId ?? null, window.activityEnd ?? window.asOf, window.activityStart],
      );
      return result.rows.map((row) => {
        const source = sourceHref({
          procurementRequestId: row.procurement_request_id,
          intercompanyTransactionId: row.intercompany_transaction_id,
          payableInvoiceId: row.payable_invoice_id,
          receivableInvoiceId: row.receivable_invoice_id,
          customerId: row.customer_id,
          journalSource: row.source,
        });
        return {
          journalId: row.journal_id,
          journalLineId: row.journal_line_id,
          journalReference: row.journal_reference,
          occurredOn: row.occurred_on.toISOString().slice(0, 10),
          narration: row.narration,
          debitKobo: Number(row.debit_kobo),
          creditKobo: Number(row.credit_kobo),
          accountCode: row.account_code,
          accountName: row.account_name,
          entityId: row.entity_id,
          entityCode: row.entity_code,
          sourceHref: source.href,
          sourceLabel: source.label,
        };
      });
    });
  }

  async listSets(actor: ActorContext): Promise<ReportParameterSetView[]> {
    if (!can(actor, 'finance.view')) throw new ForbiddenError('You cannot view reports.');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        name: string;
        report_kind: ReportKind;
        params: Record<string, unknown>;
        status: 'ACTIVE' | 'INACTIVE';
        row_version: number;
      }>(
        `SELECT id, name, report_kind, params, status, row_version
           FROM report_parameter_sets
          WHERE user_id = $1
          ORDER BY name`,
        [actor.ref],
      );
      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        reportKind: row.report_kind,
        params: row.params,
        status: row.status,
        rowVersion: row.row_version,
      }));
    });
  }

  async saveSet(
    actor: ActorContext,
    input: { name: string; reportKind: ReportKind; params: Record<string, unknown> },
  ): Promise<ReportParameterSetView> {
    if (!can(actor, 'finance.view')) throw new ForbiddenError('You cannot save report parameters.');
    this.assertKind(input.reportKind);
    return this.unitOfWork.write(actor, async (tx) => {
      const inserted = await tx.client.query<{
        id: string;
        name: string;
        report_kind: ReportKind;
        params: Record<string, unknown>;
        status: 'ACTIVE' | 'INACTIVE';
        row_version: number;
      }>(
        `INSERT INTO report_parameter_sets (user_id, name, report_kind, params, created_by, updated_by)
         VALUES ($1, $2, $3, $4::jsonb, $5, $5)
         RETURNING id, name, report_kind, params, status, row_version`,
        [actor.ref, input.name.trim(), input.reportKind, JSON.stringify(input.params), actor.ref],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error('The parameter set was not saved.');
      await tx.audit({
        action: 'create',
        subjectType: 'report_parameter_set',
        subjectId: row.id,
        subjectLabel: input.name,
        newValue: { reportKind: input.reportKind },
      });
      return {
        id: row.id,
        name: row.name,
        reportKind: row.report_kind,
        params: row.params,
        status: row.status,
        rowVersion: row.row_version,
      };
    });
  }

  async inactivateSet(actor: ActorContext, id: string): Promise<ReportParameterSetView> {
    if (!can(actor, 'finance.view')) throw new ForbiddenError('You cannot change report parameters.');
    return this.unitOfWork.write(actor, async (tx) => {
      const updated = await tx.client.query<{
        id: string;
        name: string;
        report_kind: ReportKind;
        params: Record<string, unknown>;
        status: 'ACTIVE' | 'INACTIVE';
        row_version: number;
      }>(
        `UPDATE report_parameter_sets SET status = 'INACTIVE', updated_by = $2
          WHERE id = $1 AND user_id = $2
          RETURNING id, name, report_kind, params, status, row_version`,
        [id, actor.ref],
      );
      const row = updated.rows[0];
      if (!row) throw new NotFoundError('That parameter set does not exist.');
      await tx.audit({
        action: 'edit',
        subjectType: 'report_parameter_set',
        subjectId: id,
        subjectLabel: 'Parameter set inactive',
        newValue: { status: 'INACTIVE' },
      });
      return {
        id: row.id,
        name: row.name,
        reportKind: row.report_kind,
        params: row.params,
        status: row.status,
        rowVersion: row.row_version,
      };
    });
  }

  private resolveScope(actor: ActorContext, query: ReportQuery): { entityId?: string; consolidated: boolean } {
    if (!can(actor, 'finance.view')) throw new ForbiddenError('You cannot view reports.');
    if (query.consolidated) {
      assertCan(actor, 'finance.view.consolidated');
      return { consolidated: true };
    }
    if (query.entityId) {
      assertCan(actor, 'finance.view', query.entityId);
      return { entityId: query.entityId, consolidated: false };
    }
    if (!actor.isCorporate && actor.entityIds[0]) {
      return { entityId: actor.entityIds[0], consolidated: false };
    }
    if (can(actor, 'finance.view.consolidated')) return { consolidated: true };
    throw new ValidationFailedError('Choose an entity for this report.');
  }

  private assertKind(kind: string): asserts kind is ReportKind {
    if (!(REPORT_KINDS as readonly string[]).includes(kind)) {
      throw new ValidationFailedError('Unknown report kind.');
    }
  }

  private async build(
    tx: TxScope,
    kind: ReportKind,
    scope: { entityId?: string; consolidated: boolean },
    window: ReportWindow,
  ): Promise<ReportView> {
    const label = await this.scopeLabel(tx, scope);
    const base = {
      kind,
      title: REPORT_CATALOG.find((item) => item.kind === kind)?.title ?? kind,
      scope: scope.consolidated ? ('consolidated' as const) : ('entity' as const),
      entityId: scope.entityId ?? null,
      entityLabel: label,
      periodLabel: window.label,
      comparePeriodLabel: window.compareLabel ?? undefined,
      runReference: '',
      columns: window.compareLabel ? ['Amount', 'Comparison', 'Variance'] : ['Amount'],
      rows: [] as ReportRowView[],
    };
    if (kind === 'payroll_summary') {
      const payroll = await tx.client.query<{
        gross: string;
        net: string;
        paye: string;
        pension: string;
        n: string;
      }>(
        `SELECT coalesce(sum(r.gross_kobo), 0)::text AS gross,
                coalesce(sum(r.net_kobo), 0)::text AS net,
                coalesce(sum(r.paye_kobo), 0)::text AS paye,
                coalesce(sum(r.pension_employee_kobo + r.pension_employer_kobo), 0)::text AS pension,
                count(*)::text AS n
           FROM payroll_runs r
          WHERE r.status IN ('LOCKED', 'PAID')
            AND ($1::uuid IS NULL OR r.entity_id = $1)`,
        [scope.entityId ?? null],
      );
      const row = payroll.rows[0];
      if (!row || Number(row.n) === 0) {
        return {
          ...base,
          emptyState: {
            title: 'No payroll data yet',
            description: 'Locked or paid payroll runs will appear here as aggregate totals.',
          },
        };
      }
      const cell = (amount: number) => ({ currentKobo: amount });
      return {
        ...base,
        rows: [
          { key: 'gross', label: 'Gross pay', cells: cell(Number(row.gross)) },
          { key: 'net', label: 'Net pay', cells: cell(Number(row.net)) },
          { key: 'paye', label: 'PAYE', cells: cell(Number(row.paye)) },
          { key: 'pension', label: 'Pension', cells: cell(Number(row.pension)) },
        ],
        notes: ['Totals from locked and paid runs. Individual salaries are not shown.'],
      };
    }
    if (kind === 'income_statement') return { ...base, rows: await this.incomeRows(tx, scope, window) };
    if (kind === 'balance_sheet') return { ...base, rows: await this.balanceRows(tx, scope, window) };
    if (kind === 'cash_flow') return { ...base, rows: await this.cashFlowRows(tx, scope, window), notes: ['Classified from bank transactions. Intra-group funding is omitted when consolidated.'] };
    if (kind === 'trial_balance') return { ...base, columns: ['Debit', 'Credit'], rows: await this.trialRows(tx, scope, window) };
    if (kind === 'general_ledger') return { ...base, rows: await this.ledgerSummaryRows(tx, scope, window) };
    if (kind === 'budget_vs_actual') return { ...base, columns: ['Approved', 'Paid', 'Actual', 'GL'], rows: await this.budgetRows(tx, scope, window) };
    if (kind === 'expense_analysis') return { ...base, rows: await this.typedRows(tx, scope, window, 'EXPENSE') };
    if (kind === 'revenue_analysis') return { ...base, rows: await this.typedRows(tx, scope, window, 'INCOME') };
    if (kind === 'payables') return { ...base, rows: await this.payableRows(tx, scope) };
    if (kind === 'receivables_aging') return { ...base, rows: await this.agingRows(tx, scope) };
    if (kind === 'procurement_expenditure') return { ...base, rows: await this.procurementRows(tx, scope, window) };
    if (kind === 'subsidiary_comparison') return { ...base, columns: ['Group'], rows: await this.comparisonRows(tx, window) };
    if (kind === 'consolidated_statements') {
      const is = await this.incomeRows(tx, { consolidated: true }, window);
      const bs = await this.balanceRows(tx, { consolidated: true }, window);
      return { ...base, rows: [...is, ...bs] };
    }
    if (kind === 'intercompany' || kind === 'eliminations') {
      return { ...base, rows: await this.icRows(tx, scope, window) };
    }
    if (kind === 'integrity') {
      return { ...base, notes: ['See /api/finance/reports/integrity for structured checks.'] };
    }
    return base;
  }

  private async balances(
    tx: TxScope,
    scope: { entityId?: string; consolidated: boolean },
    window: ReportWindow,
    mode: 'activity' | 'as_of',
    compare = false,
  ): Promise<CodeBalance[]> {
    const raw = await fetchCodeBalances(tx, { entityId: scope.entityId ?? null, window, mode, compare });
    if (!scope.consolidated) return raw;
    const elim = await postedPairTotal(tx, compare ? { ...window, asOf: window.compareAsOf } : window);
    return applyEliminations(raw, elim);
  }

  private async incomeRows(
    tx: TxScope,
    scope: { entityId?: string; consolidated: boolean },
    window: ReportWindow,
  ): Promise<ReportRowView[]> {
    const current = await this.balances(tx, scope, window, 'activity');
    const compare = window.comparePeriodId ? await this.balances(tx, scope, window, 'activity', true) : null;
    const income = current.filter((row) => row.accountType === 'INCOME');
    const expense = current.filter((row) => row.accountType === 'EXPENSE');
    const rows: ReportRowView[] = [];
    rows.push(...this.sectionRows('Income', income, compare, 'INCOME', window));
    const incomeTotal = income.reduce((sum, row) => sum + netFor(row), 0);
    rows.push(this.totalRow('income_total', 'Total income', incomeTotal, this.sectionTotal(compare, 'INCOME'), ['4'], scope, window));
    rows.push(...this.sectionRows('Expenditure', expense, compare, 'EXPENSE', window));
    const expenseTotal = expense.reduce((sum, row) => sum + netFor(row), 0);
    rows.push(this.totalRow('expense_total', 'Total expenditure', expenseTotal, this.sectionTotal(compare, 'EXPENSE'), ['5'], scope, window));
    rows.push(this.totalRow('net_income', 'Net income', incomeTotal - expenseTotal, this.sectionTotal(compare, 'INCOME') - this.sectionTotal(compare, 'EXPENSE'), ['4', '5'], scope, window));
    return rows;
  }

  private async balanceRows(
    tx: TxScope,
    scope: { entityId?: string; consolidated: boolean },
    window: ReportWindow,
  ): Promise<ReportRowView[]> {
    const asOf = await this.balances(tx, scope, window, 'as_of');
    const ytd = await this.balances(tx, scope, { ...window, activityStart: window.year ? `${window.year}-01-01` : window.activityStart }, 'activity');
    const ni = ytd.filter((row) => row.accountType === 'INCOME').reduce((sum, row) => sum + netFor(row), 0)
      - ytd.filter((row) => row.accountType === 'EXPENSE').reduce((sum, row) => sum + netFor(row), 0);
    const assets = asOf.filter((row) => row.accountType === 'ASSET');
    const liab = asOf.filter((row) => row.accountType === 'LIABILITY');
    const equity = asOf.filter((row) => row.accountType === 'EQUITY');
    const rows: ReportRowView[] = [];
    rows.push(...this.sectionRows('Assets', assets, null, 'ASSET', window, 'as_of'));
    const assetTotal = assets.reduce((sum, row) => sum + netFor(row), 0);
    rows.push(this.totalRow('assets_total', 'Total assets', assetTotal, 0, ['1'], scope, window));
    rows.push(...this.sectionRows('Liabilities', liab, null, 'LIABILITY', window, 'as_of'));
    const liabTotal = liab.reduce((sum, row) => sum + netFor(row), 0);
    rows.push(this.totalRow('liab_total', 'Total liabilities', liabTotal, 0, ['2'], scope, window));
    rows.push(...this.sectionRows('Equity', equity, null, 'EQUITY', window, 'as_of'));
    rows.push(this.totalRow('current_ni', 'Current year earnings', ni, 0, ['4', '5'], scope, window));
    const equityTotal = equity.reduce((sum, row) => sum + netFor(row), 0) + ni;
    rows.push(this.totalRow('equity_total', 'Total equity', equityTotal, 0, ['3'], scope, window));
    rows.push(this.totalRow('liab_equity', 'Liabilities and equity', liabTotal + equityTotal, 0, ['2', '3'], scope, window));
    return rows;
  }

  private async cashFlowRows(
    tx: TxScope,
    scope: { entityId?: string; consolidated: boolean },
    window: ReportWindow,
  ): Promise<ReportRowView[]> {
    const result = await tx.client.query<{ kind: string; total: string }>(
      `SELECT kind, coalesce(sum(amount_kobo), 0)::text AS total
         FROM bank_transactions
        WHERE ($1::uuid IS NULL OR entity_id = $1)
          AND ($2::date IS NULL OR occurred_on >= $2::date)
          AND ($3::date IS NULL OR occurred_on <= $3::date)
          AND kind <> 'STATEMENT'
        GROUP BY kind`,
      [scope.entityId ?? null, window.activityStart, window.activityEnd],
    );
    const byKind = new Map(result.rows.map((row) => [row.kind, Number(row.total)]));
    const receipt = byKind.get('RECEIPT') ?? 0;
    const payment = byKind.get('PAYMENT') ?? 0;
    const fundingIn = scope.consolidated ? 0 : (byKind.get('FUNDING_IN') ?? 0);
    const fundingOut = scope.consolidated ? 0 : (byKind.get('FUNDING_OUT') ?? 0);
    const adjustment = byKind.get('ADJUSTMENT') ?? 0;
    const operating = receipt + payment;
    const financing = fundingIn + fundingOut;
    const other = adjustment;
    const net = operating + financing + other;
    const opening = await this.cashBalance(tx, scope, window, true);
    const closing = await this.cashBalance(tx, scope, window, false);
    return [
      this.amountRow('cf_receipts', 'Receipts', receipt, ['11'], scope, window, 'Cash from operations'),
      this.amountRow('cf_payments', 'Payments', payment, ['11'], scope, window, 'Cash from operations'),
      this.totalRow('cf_operating', 'Net operating', operating, 0, ['11'], scope, window),
      this.amountRow('cf_fin_in', 'Funding in', fundingIn, ['11'], scope, window, 'Financing'),
      this.amountRow('cf_fin_out', 'Funding out', fundingOut, ['11'], scope, window, 'Financing'),
      this.totalRow('cf_financing', 'Net financing', financing, 0, ['11'], scope, window),
      this.amountRow('cf_other', 'Adjustments', other, ['11'], scope, window, 'Other'),
      this.totalRow('cf_net', 'Net cash movement', net, 0, ['11'], scope, window),
      this.amountRow('cf_open', 'Opening cash (GL)', opening, ['11'], scope, window),
      this.amountRow('cf_close', 'Closing cash (GL)', closing, ['11'], scope, window),
    ];
  }

  private async cashBalance(
    tx: TxScope,
    scope: { entityId?: string; consolidated: boolean },
    window: ReportWindow,
    opening: boolean,
  ): Promise<number> {
    const asOf = opening
      ? window.activityStart
        ? new Date(`${window.activityStart}T00:00:00Z`)
        : null
      : window.asOf;
    let asOfDate: string | null = null;
    if (asOf instanceof Date) {
      asOfDate = new Date(asOf.getTime() - (opening ? 86_400_000 : 0)).toISOString().slice(0, 10);
    } else {
      asOfDate = asOf;
    }
    const result = await tx.client.query<{ total: string }>(
      `SELECT coalesce(sum(l.debit_kobo - l.credit_kobo), 0)::text AS total
         FROM journal_lines l
         JOIN journals j ON j.id = l.journal_id
         JOIN accounts a ON a.id = l.account_id
         JOIN fiscal_periods p ON p.id = j.fiscal_period_id
        WHERE j.status = 'POSTED'
          AND a.code LIKE '11%'
          AND ($1::uuid IS NULL OR j.entity_id = $1)
          AND ($2::date IS NULL OR p.ends_on <= $2::date)`,
      [scope.entityId ?? null, asOfDate],
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  private async trialRows(
    tx: TxScope,
    scope: { entityId?: string; consolidated: boolean },
    window: ReportWindow,
  ): Promise<ReportRowView[]> {
    const balances = await this.balances(tx, scope, window, window.periodId ? 'activity' : 'as_of');
    return balances.map((row) => {
      const net = row.debitKobo - row.creditKobo;
      return {
        key: row.consolidationCode,
        label: `${row.consolidationCode} ${row.accountName}`,
        section: row.accountType,
        cells: {
          currentKobo: net > 0 ? net : 0,
          compareKobo: net < 0 ? -net : 0,
          drill: { accountCodes: [row.consolidationCode], entityId: scope.entityId, periodId: window.periodId },
        },
      };
    });
  }

  private async ledgerSummaryRows(
    tx: TxScope,
    scope: { entityId?: string; consolidated: boolean },
    window: ReportWindow,
  ): Promise<ReportRowView[]> {
    return this.trialRows(tx, scope, window);
  }

  private async budgetRows(
    tx: TxScope,
    scope: { entityId?: string; consolidated: boolean },
    window: ReportWindow,
  ): Promise<ReportRowView[]> {
    const result = await tx.client.query<{
      id: string;
      code: string;
      name: string;
      approved: string;
      paid: string;
      actual: string;
    }>(
      `SELECT bl.id, bl.code, bl.name, bl.approved_amount_kobo::text AS approved,
              coalesce((SELECT sum(CASE WHEN e.action IN ('PAY') THEN e.amount_kobo
                                        WHEN e.action = 'REVERSE_PAY' THEN -e.amount_kobo ELSE 0 END)
                          FROM budget_commitment_events e WHERE e.budget_line_id = bl.id), 0)::text AS paid,
              coalesce((SELECT sum(CASE WHEN e.action IN ('ACTUAL') THEN e.amount_kobo
                                        WHEN e.action = 'REVERSE_ACTUAL' THEN -e.amount_kobo ELSE 0 END)
                          FROM budget_commitment_events e WHERE e.budget_line_id = bl.id), 0)::text AS actual
         FROM budget_lines bl
        WHERE ($1::uuid IS NULL OR bl.entity_id = $1)
          AND ($2::int IS NULL OR bl.fiscal_year = $2)
        ORDER BY bl.code`,
      [scope.entityId ?? null, window.year],
    );
    return result.rows.map((row) => ({
      key: row.id,
      label: `${row.code} ${row.name}`,
      cells: {
        currentKobo: Number(row.approved),
        compareKobo: Number(row.paid),
        varianceKobo: Number(row.actual),
      },
    }));
  }

  private async typedRows(
    tx: TxScope,
    scope: { entityId?: string; consolidated: boolean },
    window: ReportWindow,
    type: 'INCOME' | 'EXPENSE',
  ): Promise<ReportRowView[]> {
    const balances = (await this.balances(tx, scope, window, 'activity')).filter((row) => row.accountType === type);
    return this.sectionRows(type === 'INCOME' ? 'Revenue' : 'Expenses', balances, null, type, window);
  }

  private async payableRows(tx: TxScope, scope: { entityId?: string; consolidated: boolean }): Promise<ReportRowView[]> {
    const result = await tx.client.query<{
      id: string;
      reference_number: string;
      vendor_name: string | null;
      outstanding: string;
    }>(
      `SELECT p.id, p.reference_number, v.legal_name AS vendor_name,
              (p.amount_kobo - p.paid_kobo)::text AS outstanding
         FROM payable_invoices p
         LEFT JOIN vendors v ON v.id = p.vendor_id
        WHERE p.status NOT IN ('DRAFT', 'REJECTED', 'PAID')
          AND ($1::uuid IS NULL OR p.entity_id = $1)
        ORDER BY p.due_date`,
      [scope.entityId ?? null],
    );
    return result.rows.map((row) => ({
      key: row.id,
      label: `${row.reference_number} ${row.vendor_name ?? ''}`.trim(),
      cells: { currentKobo: Number(row.outstanding), drill: { accountCodes: ['2110'], extra: { payableId: row.id } } },
    }));
  }

  private async agingRows(tx: TxScope, scope: { entityId?: string; consolidated: boolean }): Promise<ReportRowView[]> {
    const result = await tx.client.query<{
      due_date: Date;
      outstanding: string;
    }>(
      `SELECT due_date, (amount_kobo - allocated_kobo)::text AS outstanding
         FROM receivable_invoices
        WHERE amount_kobo > allocated_kobo
          AND ($1::uuid IS NULL OR entity_id = $1)`,
      [scope.entityId ?? null],
    );
    const buckets: Record<AgingBucket, number> = {
      current: 0,
      '1_30': 0,
      '31_60': 0,
      '61_90': 0,
      '90_plus': 0,
    };
    const now = Date.now();
    for (const row of result.rows) {
      const days = Math.floor((now - row.due_date.getTime()) / 86_400_000);
      const amount = Number(row.outstanding);
      if (days <= 0) buckets.current += amount;
      else if (days <= 30) buckets['1_30'] += amount;
      else if (days <= 60) buckets['31_60'] += amount;
      else if (days <= 90) buckets['61_90'] += amount;
      else buckets['90_plus'] += amount;
    }
    const labels: Array<[AgingBucket, string]> = [
      ['current', 'Current'],
      ['1_30', '1–30 days'],
      ['31_60', '31–60 days'],
      ['61_90', '61–90 days'],
      ['90_plus', '90+ days'],
    ];
    return labels.map(([key, label]) => ({
      key,
      label,
      cells: { currentKobo: buckets[key], drill: { accountCodes: ['1220'] } },
    }));
  }

  private async procurementRows(
    tx: TxScope,
    scope: { entityId?: string; consolidated: boolean },
    window: ReportWindow,
  ): Promise<ReportRowView[]> {
    const result = await tx.client.query<{
      request_id: string;
      reference_number: string;
      paid: string;
    }>(
      `SELECT e.request_id, r.reference_number, sum(e.amount_kobo)::text AS paid
         FROM budget_commitment_events e
         JOIN procurement_requests r ON r.id = e.request_id
        WHERE e.action = 'PAY'
          AND ($1::uuid IS NULL OR e.entity_id = $1)
        GROUP BY e.request_id, r.reference_number
        ORDER BY r.reference_number`,
      [scope.entityId ?? null],
    );
    return result.rows.map((row) => ({
      key: row.request_id,
      label: row.reference_number,
      cells: {
        currentKobo: Number(row.paid),
        drill: { accountCodes: ['1300'], extra: { procurementId: row.request_id }, periodId: window.periodId },
      },
    }));
  }

  private async comparisonRows(tx: TxScope, window: ReportWindow): Promise<ReportRowView[]> {
    const entities = await tx.client.query<{ id: string; code: string }>(
      `SELECT id, code FROM entities WHERE type IN ('HOLDING', 'SUBSIDIARY') ORDER BY code`,
    );
    const group = await this.balances(tx, { consolidated: true }, window, 'activity');
    const income = group.filter((row) => row.accountType === 'INCOME').reduce((sum, row) => sum + netFor(row), 0);
    const expense = group.filter((row) => row.accountType === 'EXPENSE').reduce((sum, row) => sum + netFor(row), 0);
    const rows: ReportRowView[] = [
      this.totalRow('cmp_income', 'Group income', income, 0, ['4'], { consolidated: true }, window),
      this.totalRow('cmp_expense', 'Group expenditure', expense, 0, ['5'], { consolidated: true }, window),
      this.totalRow('cmp_ni', 'Group net income', income - expense, 0, ['4', '5'], { consolidated: true }, window),
    ];
    for (const entity of entities.rows) {
      const local = await this.balances(tx, { entityId: entity.id, consolidated: false }, window, 'activity');
      const ni = local.filter((row) => row.accountType === 'INCOME').reduce((sum, row) => sum + netFor(row), 0)
        - local.filter((row) => row.accountType === 'EXPENSE').reduce((sum, row) => sum + netFor(row), 0);
      rows.push(this.amountRow(`cmp_${entity.code}`, `${entity.code} net income`, ni, ['4', '5'], { entityId: entity.id, consolidated: false }, window));
    }
    const elim = await postedPairTotal(tx, window);
    rows.push(this.amountRow('cmp_elim', 'Eliminations (IC)', elim, ['1210', '2120'], { consolidated: true }, window));
    return rows;
  }

  private async icRows(
    tx: TxScope,
    scope: { entityId?: string; consolidated: boolean },
    window: ReportWindow,
  ): Promise<ReportRowView[]> {
    const rows = await listEliminationRows(tx, window, scope.entityId ?? null);
    return rows.map((row) => ({
      key: row.id,
      label: `${row.referenceNumber} ${row.sourceEntityCode}→${row.destinationEntityCode} ${row.eliminated ? 'eliminated' : row.skipReason}`,
      cells: {
        currentKobo: row.amountKobo,
        drill: { accountCodes: ['1210', '2120'], extra: { intercompanyId: row.id } },
      },
    }));
  }

  private sectionRows(
    section: string,
    rows: CodeBalance[],
    compare: CodeBalance[] | null,
    type: CodeBalance['accountType'],
    window: ReportWindow,
    _mode = 'activity',
  ): ReportRowView[] {
    return rows.map((row) => {
      const current = netFor(row);
      const prior = compare?.find((item) => item.consolidationCode === row.consolidationCode);
      const compareKobo = prior ? netFor(prior) : undefined;
      return {
        key: row.consolidationCode,
        label: `${row.consolidationCode} ${row.accountName}`,
        section,
        cells: {
          currentKobo: current,
          compareKobo,
          varianceKobo: compareKobo === undefined ? undefined : current - compareKobo,
          drill: { accountCodes: [row.consolidationCode], periodId: window.periodId },
        },
      };
    }).concat(type ? [] : []);
  }

  private sectionTotal(compare: CodeBalance[] | null, type: CodeBalance['accountType']): number {
    if (!compare) return 0;
    return compare.filter((row) => row.accountType === type).reduce((sum, row) => sum + netFor(row), 0);
  }

  private amountRow(
    key: string,
    label: string,
    amount: number,
    codes: string[],
    scope: { entityId?: string; consolidated?: boolean },
    window: ReportWindow,
    section?: string,
  ): ReportRowView {
    return {
      key,
      label,
      section,
      cells: {
        currentKobo: amount,
        drill: { accountCodes: codes, entityId: scope.entityId, periodId: window.periodId },
      },
    };
  }

  private totalRow(
    key: string,
    label: string,
    amount: number,
    compare: number,
    codes: string[],
    scope: { entityId?: string; consolidated?: boolean },
    window: ReportWindow,
  ): ReportRowView {
    return {
      key,
      label,
      bold: true,
      cells: {
        currentKobo: amount,
        compareKobo: compare || undefined,
        varianceKobo: compare ? amount - compare : undefined,
        drill: { accountCodes: codes, entityId: scope.entityId, periodId: window.periodId },
      },
    };
  }

  private async scopeLabel(tx: TxScope, scope: { entityId?: string; consolidated: boolean }): Promise<string> {
    if (scope.consolidated) return 'Consolidated';
    if (!scope.entityId) return 'Entity';
    const result = await tx.client.query<{ code: string; name: string }>(
      `SELECT code, name FROM entities WHERE id = $1`,
      [scope.entityId],
    );
    const row = result.rows[0];
    return row ? `${row.code} — ${row.name}` : 'Entity';
  }

  private async insertRun(
    tx: TxScope,
    actor: ActorContext,
    kind: ReportKind,
    scope: { entityId?: string; consolidated: boolean },
    query: ReportQuery,
    hash: string,
    format: ReportFormat,
    view: ReportView,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const ref = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('RPT', $1) AS ref`, [year]);
    const reference = ref.rows[0]?.ref;
    if (!reference) throw new Error('Could not allocate a report reference.');
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO report_runs (
         reference_number, report_kind, entity_id, consolidated, params, result_hash, format, created_by
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       RETURNING id`,
      [
        reference,
        kind,
        scope.entityId ?? null,
        scope.consolidated,
        JSON.stringify(query),
        hash,
        format,
        actor.ref,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error('The report run was not recorded.');
    const searchEntity = scope.entityId ?? (await this.holdingId(tx));
    await tx.indexSearch({
      recordType: 'REPORT_RUN',
      recordId: id,
      referenceNumber: reference,
      title: view.title,
      searchableText: `${reference} ${view.title} ${kind}`,
      entityId: searchEntity,
      permissionKey: 'finance.view',
    });
    await tx.audit({
      action: format === 'SCREEN' ? 'create' : 'download',
      subjectType: 'report_run',
      subjectId: id,
      subjectLabel: `${view.title} ${reference}`,
      subjectReferenceNumber: reference,
      entityId: scope.entityId ?? null,
      newValue: { kind, format, hash, rowCount: view.rows.length },
    });
    return reference;
  }

  private async holdingId(tx: TxScope): Promise<string> {
    const result = await tx.client.query<{ id: string }>(
      `SELECT id FROM entities WHERE type = 'HOLDING' LIMIT 1`,
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('Holding entity is required to index a consolidated run.');
    return id;
  }
}
