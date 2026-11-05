import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { IntegrityCheckView, IntegrityReportView } from '@nfc/shared';
import { assertCan, can } from '../auth/can';
import { ForbiddenError } from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import { listEliminationRows, postedPairTotal } from './consolidation.service';
import type { ReportQuery } from './report-window';
import { resolveReportWindow } from './report-window';

@Injectable()
export class IntegrityService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async report(actor: ActorContext, query: ReportQuery): Promise<IntegrityReportView> {
    if (!can(actor, 'finance.view')) throw new ForbiddenError('You cannot view reports.');
    if (query.consolidated) assertCan(actor, 'finance.view.consolidated');
    if (query.entityId) assertCan(actor, 'finance.view', query.entityId);
    const entityId = query.consolidated
      ? null
      : (query.entityId ?? (!actor.isCorporate ? actor.entityIds[0] : null));
    const consolidated = Boolean(query.consolidated) || (!query.entityId && actor.isCorporate && can(actor, 'finance.view.consolidated'));
    return this.unitOfWork.read(actor, async (tx) => {
      const window = await resolveReportWindow(tx, query);
      const checks: IntegrityCheckView[] = [];
      checks.push(await this.unbalanced(tx, entityId));
      checks.push(await this.orphans(tx, entityId));
      checks.push(await this.bank(tx, entityId));
      checks.push(await this.receivables(tx, entityId));
      checks.push(await this.payables(tx, entityId));
      checks.push(await this.intercompany(tx, window, entityId));
      checks.push(await this.unlinkedIc(tx, entityId));
      checks.push(await this.inventory(tx, entityId));
      return {
        scope: consolidated && !entityId ? 'consolidated' : 'entity',
        entityId: entityId ?? null,
        checks,
        discrepancyCount: checks.filter((check) => check.status === 'FAIL').length,
      };
    });
  }

  private async unbalanced(tx: TxScope, entityId: string | null | undefined): Promise<IntegrityCheckView> {
    const result = await tx.client.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM journals j
        WHERE j.status = 'POSTED'
          AND ($1::uuid IS NULL OR j.entity_id = $1)
          AND EXISTS (
            SELECT 1 FROM journal_lines l WHERE l.journal_id = j.id
            GROUP BY l.journal_id
            HAVING sum(l.debit_kobo) <> sum(l.credit_kobo)
          )`,
      [entityId ?? null],
    );
    const n = Number(result.rows[0]?.n ?? 0);
    return {
      key: 'unbalanced',
      label: 'Unbalanced posted journals',
      status: n === 0 ? 'OK' : 'FAIL',
      detail: n === 0 ? 'All posted journals balance.' : `${n} posted journal(s) do not balance.`,
      differenceKobo: n,
    };
  }

  private async orphans(tx: TxScope, entityId: string | null | undefined): Promise<IntegrityCheckView> {
    const result = await tx.client.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM journal_lines l
         LEFT JOIN accounts a ON a.id = l.account_id
         LEFT JOIN journals j ON j.id = l.journal_id
        WHERE (a.id IS NULL OR j.id IS NULL OR j.fiscal_period_id IS NULL)
          AND ($1::uuid IS NULL OR l.entity_id = $1)`,
      [entityId ?? null],
    );
    const n = Number(result.rows[0]?.n ?? 0);
    return {
      key: 'orphans',
      label: 'Orphan journal lines',
      status: n === 0 ? 'OK' : 'FAIL',
      detail: n === 0 ? 'No orphaned lines.' : `${n} line(s) are missing an account or period.`,
    };
  }

  private async bank(tx: TxScope, entityId: string | null | undefined): Promise<IntegrityCheckView> {
    const result = await tx.client.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM bank_transactions t
        WHERE t.kind IN ('PAYMENT', 'RECEIPT', 'FUNDING_IN', 'FUNDING_OUT')
          AND t.journal_id IS NULL
          AND ($1::uuid IS NULL OR t.entity_id = $1)`,
      [entityId ?? null],
    );
    const n = Number(result.rows[0]?.n ?? 0);
    return {
      key: 'bank',
      label: 'Bank versus ledger',
      status: n === 0 ? 'OK' : 'INFO',
      detail:
        n === 0
          ? 'Journal-linked bank movements are present; seed opening cash is a GL journal without a bank line.'
          : `${n} payment/receipt/funding movement(s) have no journal (seed backfill or import).`,
    };
  }

  private async receivables(tx: TxScope, entityId: string | null | undefined): Promise<IntegrityCheckView> {
    const gl = await tx.client.query<{ total: string }>(
      `SELECT coalesce(sum(l.debit_kobo - l.credit_kobo), 0)::text AS total
         FROM journal_lines l
         JOIN journals j ON j.id = l.journal_id
         JOIN accounts a ON a.id = l.account_id
        WHERE j.status = 'POSTED' AND a.code = '1220'
          AND ($1::uuid IS NULL OR j.entity_id = $1)`,
      [entityId ?? null],
    );
    const sub = await tx.client.query<{ total: string }>(
      `SELECT coalesce(sum(amount_kobo - allocated_kobo), 0)::text AS total
         FROM receivable_invoices
        WHERE journal_id IS NOT NULL
          AND ($1::uuid IS NULL OR entity_id = $1)`,
      [entityId ?? null],
    );
    const difference = Number(gl.rows[0]?.total ?? 0) - Number(sub.rows[0]?.total ?? 0);
    return {
      key: 'receivables',
      label: 'Receivables versus 1220',
      status: difference === 0 ? 'OK' : 'FAIL',
      detail:
        difference === 0
          ? 'Posted receivables match account 1220. Unposted register invoices are ignored.'
          : `GL 1220 differs from posted invoice outstanding by ${difference} kobo.`,
      differenceKobo: difference,
    };
  }

  private async payables(tx: TxScope, entityId: string | null | undefined): Promise<IntegrityCheckView> {
    const gl = await tx.client.query<{ total: string }>(
      `SELECT coalesce(sum(l.credit_kobo - l.debit_kobo), 0)::text AS total
         FROM journal_lines l
         JOIN journals j ON j.id = l.journal_id
         JOIN accounts a ON a.id = l.account_id
        WHERE j.status = 'POSTED' AND a.code = '2110'
          AND ($1::uuid IS NULL OR j.entity_id = $1)`,
      [entityId ?? null],
    );
    const sub = await tx.client.query<{ total: string }>(
      `SELECT coalesce(sum(amount_kobo - paid_kobo), 0)::text AS total
         FROM payable_invoices
        WHERE journal_id IS NOT NULL AND source <> 'PROCUREMENT'
          AND ($1::uuid IS NULL OR entity_id = $1)`,
      [entityId ?? null],
    );
    const difference = Number(gl.rows[0]?.total ?? 0) - Number(sub.rows[0]?.total ?? 0);
    return {
      key: 'payables',
      label: 'Payables versus 2110',
      status: difference === 0 ? 'OK' : 'FAIL',
      detail:
        difference === 0
          ? 'Posted non-procurement payables match account 2110. Procurement prepay stays on 1300.'
          : `GL 2110 differs from posted bill outstanding by ${difference} kobo.`,
      differenceKobo: difference,
    };
  }

  private async intercompany(
    tx: TxScope,
    window: Awaited<ReturnType<typeof resolveReportWindow>>,
    entityId: string | null | undefined,
  ): Promise<IntegrityCheckView> {
    const rows = await listEliminationRows(tx, window, entityId);
    const skippedCount = rows.filter((row) => !row.eliminated).length;
    const posted = await postedPairTotal(tx, window, entityId);
    const sides = await tx.client.query<{ recv: string; pay: string; src: string; dst: string }>(
      `SELECT
          coalesce((
            SELECT sum(l.debit_kobo - l.credit_kobo)
              FROM journal_lines l
              JOIN journals j ON j.id = l.journal_id
              JOIN accounts a ON a.id = l.account_id
             WHERE j.status = 'POSTED' AND a.code = '1210'
               AND ($1::uuid IS NULL OR j.entity_id = $1)
          ), 0)::text AS recv,
          coalesce((
            SELECT sum(l.credit_kobo - l.debit_kobo)
              FROM journal_lines l
              JOIN journals j ON j.id = l.journal_id
              JOIN accounts a ON a.id = l.account_id
             WHERE j.status = 'POSTED' AND a.code = '2120'
               AND ($1::uuid IS NULL OR j.entity_id = $1)
          ), 0)::text AS pay,
          coalesce((
            SELECT sum(t.amount_kobo) FROM intercompany_transactions t
              JOIN journals sj ON sj.id = t.source_journal_id
             WHERE sj.status = 'POSTED'
               AND ($1::uuid IS NULL OR t.source_entity_id = $1)
               AND ($2::date IS NULL OR t.occurred_on <= $2::date)
          ), 0)::text AS src,
          coalesce((
            SELECT sum(t.amount_kobo) FROM intercompany_transactions t
              JOIN journals dj ON dj.id = t.destination_journal_id
             WHERE dj.status = 'POSTED'
               AND ($1::uuid IS NULL OR t.destination_entity_id = $1)
               AND ($2::date IS NULL OR t.occurred_on <= $2::date)
          ), 0)::text AS dst`,
      [entityId ?? null, window.asOf],
    );
    const recv = Number(sides.rows[0]?.recv ?? 0);
    const pay = Number(sides.rows[0]?.pay ?? 0);
    const src = Number(sides.rows[0]?.src ?? 0);
    const dst = Number(sides.rows[0]?.dst ?? 0);
    const expectedRecv = entityId ? src : posted;
    const expectedPay = entityId ? dst : posted;
    const mismatched = recv !== expectedRecv || pay !== expectedPay;
    return {
      key: 'intercompany',
      label: 'Inter-company pairs',
      status: mismatched ? 'FAIL' : 'OK',
      detail: mismatched
        ? `${skippedCount} IC row(s) not eliminated; GL 1210 ${recv} / 2120 ${pay} versus expected ${expectedRecv}/${expectedPay}.`
        : 'Posted IC pairs match 1210/2120.',
      differenceKobo: Math.abs(recv - expectedRecv) + Math.abs(pay - expectedPay),
    };
  }

  private async unlinkedIc(tx: TxScope, entityId: string | null | undefined): Promise<IntegrityCheckView> {
    const result = await tx.client.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM journal_lines l
         JOIN journals j ON j.id = l.journal_id
         JOIN accounts a ON a.id = l.account_id
        WHERE j.status = 'POSTED'
          AND a.intercompany = true
          AND l.intercompany_transaction_id IS NULL
          AND ($1::uuid IS NULL OR j.entity_id = $1)`,
      [entityId ?? null],
    );
    const n = Number(result.rows[0]?.n ?? 0);
    return {
      key: 'unlinked_ic',
      label: 'Unlinked inter-company lines',
      status: n === 0 ? 'OK' : 'FAIL',
      detail: n === 0 ? 'Every IC account line names a transaction.' : `${n} posted 1210/2120 line(s) have no ICT id.`,
    };
  }

  private async inventory(tx: TxScope, entityId: string | null | undefined): Promise<IntegrityCheckView> {
    const gl = await tx.client.query<{ total: string }>(
      `SELECT coalesce(sum(l.debit_kobo - l.credit_kobo), 0)::text AS total
         FROM journal_lines l
         JOIN journals j ON j.id = l.journal_id
         JOIN accounts a ON a.id = l.account_id
        WHERE j.status = 'POSTED' AND a.code IN ('1400', '1500', '1410')
          AND ($1::uuid IS NULL OR j.entity_id = $1)`,
      [entityId ?? null],
    );
    const sub = await tx.client.query<{ total: string }>(
      `SELECT coalesce(sum(value_kobo), 0)::text AS total
         FROM stock_movements
        WHERE ($1::uuid IS NULL OR entity_id = $1)`,
      [entityId ?? null],
    );
    const wip = await tx.client.query<{ total: string }>(
      `SELECT coalesce(sum(l.debit_kobo - l.credit_kobo), 0)::text AS total
         FROM journal_lines l
         JOIN journals j ON j.id = l.journal_id
         JOIN accounts a ON a.id = l.account_id
        WHERE j.status = 'POSTED' AND a.code = '1410'
          AND ($1::uuid IS NULL OR j.entity_id = $1)`,
      [entityId ?? null],
    );
    const difference =
      Number(gl.rows[0]?.total ?? 0) - Number(sub.rows[0]?.total ?? 0) - Number(wip.rows[0]?.total ?? 0);
    return {
      key: 'inventory',
      label: 'Inventory subledger',
      status: difference === 0 ? 'OK' : 'FAIL',
      detail:
        difference === 0
          ? 'GL 1400/1500/1410 matches valued stock movements plus open WIP.'
          : `GL 1400/1500/1410 differs from valued movements plus open WIP by ${difference} kobo.`,
      differenceKobo: difference,
    };
  }
}
