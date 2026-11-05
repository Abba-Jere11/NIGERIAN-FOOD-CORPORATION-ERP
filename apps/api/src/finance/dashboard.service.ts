import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { FinanceDashboardTilesView, FinanceDashboardView } from '@nfc/shared';
import { assertCan, can } from '../auth/can';
import { ForbiddenError } from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';

@Injectable()
export class DashboardService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async get(actor: ActorContext, entityId?: string): Promise<FinanceDashboardView> {
    const wantsConsolidated = !entityId;
    if (wantsConsolidated && can(actor, 'finance.dashboard.consolidated')) {
      return this.unitOfWork.read(actor, async (tx) => {
        const entities = await tx.client.query<{ id: string; code: string }>(
          `SELECT id, code FROM entities WHERE type = 'SUBSIDIARY' ORDER BY code`,
        );
        const holding = await tx.client.query<{ id: string; code: string }>(
          `SELECT id, code FROM entities WHERE type = 'HOLDING' LIMIT 1`,
        );
        const tiles: FinanceDashboardTilesView[] = [];
        for (const entity of [...holding.rows, ...entities.rows]) {
          tiles.push(await this.tilesInTx(tx, entity.id, entity.code));
        }
        return {
          consolidated: this.sumTiles(tiles),
          entities: tiles,
        };
      });
    }
    const scoped = entityId ?? actor.entityIds[0];
    if (!scoped) throw new ForbiddenError('An entity is required for this dashboard.');
    assertCan(actor, 'finance.dashboard.entity', scoped);
    return this.unitOfWork.read(actor, async (tx) => {
      const code = await tx.client.query<{ code: string }>(`SELECT code FROM entities WHERE id = $1`, [scoped]);
      const tiles = await this.tilesInTx(tx, scoped, code.rows[0]?.code ?? null);
      return { consolidated: null, entities: [tiles] };
    });
  }

  private async tilesInTx(tx: TxScope, entityId: string, entityCode: string | null): Promise<FinanceDashboardTilesView> {
    const budget = await tx.client.query<{ approved: string; paid: string; committed: string }>(
      `SELECT coalesce(sum(approved_amount_kobo), 0)::text AS approved,
              coalesce((
                SELECT sum(CASE WHEN e.action = 'PAY' THEN e.amount_kobo
                                WHEN e.action = 'REVERSE_PAY' THEN -e.amount_kobo ELSE 0 END)
                  FROM budget_commitment_events e
                 WHERE e.entity_id = $1
              ), 0)::text AS paid,
              coalesce((
                SELECT sum(CASE WHEN e.action = 'OPEN' THEN e.amount_kobo ELSE -e.amount_kobo END)
                  FROM procurement_commitment_events e
                 WHERE e.entity_id = $1
              ), 0)::text AS committed
         FROM budget_lines
        WHERE entity_id = $1`,
      [entityId],
    );
    const ledger = await tx.client.query<{
      cash: string;
      revenue: string;
      expenditure: string;
      payroll: string;
    }>(
      `SELECT coalesce(sum(CASE WHEN a.code LIKE '11%' THEN l.debit_kobo - l.credit_kobo ELSE 0 END), 0)::text AS cash,
              coalesce(sum(CASE WHEN a.type = 'INCOME' THEN l.credit_kobo - l.debit_kobo ELSE 0 END), 0)::text AS revenue,
              coalesce(sum(CASE WHEN a.type = 'EXPENSE' THEN l.debit_kobo - l.credit_kobo ELSE 0 END), 0)::text AS expenditure,
              coalesce(sum(CASE WHEN j.source = 'PAYROLL' AND a.code = '5210' THEN l.debit_kobo - l.credit_kobo ELSE 0 END), 0)::text AS payroll
         FROM journal_lines l
         JOIN journals j ON j.id = l.journal_id
         JOIN accounts a ON a.id = l.account_id
        WHERE j.status = 'POSTED' AND j.entity_id = $1`,
      [entityId],
    );
    const ap = await tx.client.query<{ outstanding: string }>(
      `SELECT coalesce(sum(amount_kobo - paid_kobo), 0)::text AS outstanding
         FROM payable_invoices
        WHERE entity_id = $1 AND status IN ('UNPAID', 'PART_PAID', 'PAID')
          AND amount_kobo > paid_kobo`,
      [entityId],
    );
    const ar = await tx.client.query<{ outstanding: string }>(
      `SELECT coalesce(sum(amount_kobo - allocated_kobo), 0)::text AS outstanding
         FROM receivable_invoices
        WHERE entity_id = $1 AND amount_kobo > allocated_kobo`,
      [entityId],
    );
    const ic = await tx.client.query<{ amount: string }>(
      `SELECT coalesce(sum(amount_kobo), 0)::text AS amount
         FROM intercompany_transactions
        WHERE source_entity_id = $1 OR destination_entity_id = $1`,
      [entityId],
    );
    const approved = Number(budget.rows[0]?.approved ?? 0);
    const paid = Number(budget.rows[0]?.paid ?? 0);
    const committed = Number(budget.rows[0]?.committed ?? 0);
    const revenue = Number(ledger.rows[0]?.revenue ?? 0);
    const expenditure = Number(ledger.rows[0]?.expenditure ?? 0);
    return {
      scope: 'entity',
      entityId,
      entityCode,
      totalBudgetKobo: approved,
      availableBudgetKobo: approved - committed,
      budgetUtilizationKobo: paid,
      cashPositionKobo: Number(ledger.rows[0]?.cash ?? 0),
      totalRevenueKobo: revenue,
      totalExpenditureKobo: expenditure,
      outstandingPayablesKobo: Number(ap.rows[0]?.outstanding ?? 0),
      outstandingReceivablesKobo: Number(ar.rows[0]?.outstanding ?? 0),
      intercompanyTransfersKobo: Number(ic.rows[0]?.amount ?? 0),
      procurementCommitmentsKobo: committed,
      profitLossKobo: revenue - expenditure,
      payrollCostKobo: Number(ledger.rows[0]?.payroll ?? 0),
    };
  }

  private sumTiles(tiles: FinanceDashboardTilesView[]): FinanceDashboardTilesView {
    const sum = (pick: (row: FinanceDashboardTilesView) => number) =>
      tiles.reduce((total, row) => total + pick(row), 0);
    return {
      scope: 'consolidated',
      entityId: null,
      entityCode: null,
      totalBudgetKobo: sum((row) => row.totalBudgetKobo),
      availableBudgetKobo: sum((row) => row.availableBudgetKobo),
      budgetUtilizationKobo: sum((row) => row.budgetUtilizationKobo),
      cashPositionKobo: sum((row) => row.cashPositionKobo),
      totalRevenueKobo: sum((row) => row.totalRevenueKobo),
      totalExpenditureKobo: sum((row) => row.totalExpenditureKobo),
      outstandingPayablesKobo: sum((row) => row.outstandingPayablesKobo),
      outstandingReceivablesKobo: sum((row) => row.outstandingReceivablesKobo),
      intercompanyTransfersKobo: sum((row) => row.intercompanyTransfersKobo),
      procurementCommitmentsKobo: sum((row) => row.procurementCommitmentsKobo),
      profitLossKobo: sum((row) => row.profitLossKobo),
      payrollCostKobo: sum((row) => row.payrollCostKobo),
    };
  }
}
