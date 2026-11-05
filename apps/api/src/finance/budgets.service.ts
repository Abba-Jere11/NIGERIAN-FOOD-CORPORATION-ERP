import { forwardRef, Inject, Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type {
  BudgetActivityMetric,
  BudgetActivityRowView,
  BudgetActivityView,
  BudgetLineBalanceView,
  BudgetView,
} from '@nfc/shared';
import { assertCan, can } from '../auth/can';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  StaleRecordError,
  ValidationFailedError,
} from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import { WorkflowsService } from '../workflows/workflows.service';
import type { CreateBudgetInput } from './finance.dto';

const ACTIVITY_META: Record<
  BudgetActivityMetric,
  { title: string; definition: string }
> = {
  approved: {
    title: 'Approved budget',
    definition: 'Approved line ceilings for the current fiscal year. These are the amounts procurement and finance may spend against.',
  },
  committed: {
    title: 'Procurement commitments',
    definition: 'Open encumbrance from procurement requests that still hold budget. Each row is a live commitment on a budget line.',
  },
  paid: {
    title: 'Budget paid',
    definition: 'Cash settled against budget lines via procurement payments. Each row shows what was paid and for which request.',
  },
  available: {
    title: 'Available balance',
    definition: 'Approved minus open commitments. Headroom left on each budget line before further encumbrance.',
  },
};

@Injectable()
export class BudgetsService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    @Inject(forwardRef(() => WorkflowsService))
    private readonly workflows: WorkflowsService,
  ) {}

  async list(actor: ActorContext, entityId?: string): Promise<BudgetView[]> {
    if (!can(actor, 'finance.budget.view') && !can(actor, 'finance.view')) {
      throw new ForbiddenError('You cannot view budgets.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const ids = await tx.client.query<{ id: string }>(
        `SELECT id FROM budgets WHERE ($1::uuid IS NULL OR entity_id = $1)
          ORDER BY created_at DESC`,
        [entityId ?? null],
      );
      const views: BudgetView[] = [];
      for (const row of ids.rows) views.push(await this.getInTx(tx, row.id));
      return views;
    });
  }

  async get(actor: ActorContext, id: string): Promise<BudgetView> {
    if (!can(actor, 'finance.budget.view') && !can(actor, 'finance.view')) {
      throw new ForbiddenError('You cannot view budgets.');
    }
    return this.unitOfWork.read(actor, async (tx) => this.getInTx(tx, id));
  }

  async getInTx(tx: TxScope, id: string): Promise<BudgetView> {
    const header = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      entity_code: string | null;
      fiscal_year_id: string;
      year: number;
      version_number: number;
      status: BudgetView['status'];
      workflow_instance_id: string | null;
      prepared_by_name: string | null;
      row_version: number;
    }>(
      `SELECT b.id, b.reference_number, b.entity_id, e.code AS entity_code, b.fiscal_year_id,
              y.year, b.version_number, b.status, b.workflow_instance_id,
              app.user_public_name(
                CASE WHEN b.created_by ~ '^[0-9a-f-]{36}$' THEN b.created_by::uuid ELSE NULL END
              ) AS prepared_by_name,
              b.row_version
         FROM budgets b
         JOIN entities e ON e.id = b.entity_id
         JOIN fiscal_years y ON y.id = b.fiscal_year_id
        WHERE b.id = $1`,
      [id],
    );
    const row = header.rows[0];
    if (!row) throw new NotFoundError('That budget does not exist.');
    const versionLines = await tx.client.query<{
      id: string;
      code: string;
      name: string;
      department_id: string | null;
      approved_amount_kobo: string;
    }>(
      `SELECT id, code, name, department_id, approved_amount_kobo::text
         FROM budget_version_lines WHERE budget_id = $1 ORDER BY code`,
      [id],
    );
    const liveLines = await tx.client.query<{
      id: string;
      code: string;
      name: string;
      department_id: string | null;
      budget_id: string | null;
      approved_amount_kobo: string;
      committed_kobo: string;
      approved_pending_kobo: string;
      paid_kobo: string;
      actual_kobo: string;
    }>(
      `SELECT l.id, l.code, l.name, l.department_id, l.budget_id, l.approved_amount_kobo::text,
              coalesce((
                SELECT sum(CASE WHEN e.action = 'OPEN' THEN e.amount_kobo ELSE -e.amount_kobo END)
                  FROM procurement_commitment_events e WHERE e.budget_line_id = l.id
              ), 0)::text AS committed_kobo,
              coalesce((
                SELECT sum(v.total_amount_kobo)
                  FROM procurement_versions v
                  JOIN procurement_requests r ON r.id = v.request_id AND r.current_version = v.version_number
                 WHERE v.budget_line_id = l.id
                   AND r.status IN (
                     'AWAITING_OPERATIONS','AWAITING_MD','AWAITING_ED_FINANCE','FUNDING_PENDING','AWAITING_PAYMENT'
                   )
              ), 0)::text AS approved_pending_kobo,
              coalesce((
                SELECT sum(CASE WHEN e.action = 'PAY' THEN e.amount_kobo
                                WHEN e.action = 'REVERSE_PAY' THEN -e.amount_kobo ELSE 0 END)
                  FROM budget_commitment_events e WHERE e.budget_line_id = l.id
              ), 0)::text AS paid_kobo,
              coalesce((
                SELECT sum(CASE WHEN e.action = 'ACTUAL' THEN e.amount_kobo
                                WHEN e.action = 'REVERSE_ACTUAL' THEN -e.amount_kobo ELSE 0 END)
                  FROM budget_commitment_events e WHERE e.budget_line_id = l.id
              ), 0)::text AS actual_kobo
         FROM budget_lines l
        WHERE l.entity_id = $1 AND l.fiscal_year = $2
        ORDER BY l.code`,
      [row.entity_id, row.year],
    );
    const liveByCode = new Map(liveLines.rows.map((line) => [line.code, line]));
    const source =
      versionLines.rows.length > 0
        ? versionLines.rows.map((line) => {
            const live = liveByCode.get(line.code);
            return {
              id: live?.id ?? line.id,
              code: line.code,
              name: line.name,
              department_id: line.department_id,
              approved_amount_kobo: line.approved_amount_kobo,
              committed_kobo: live?.committed_kobo ?? '0',
              approved_pending_kobo: live?.approved_pending_kobo ?? '0',
              paid_kobo: live?.paid_kobo ?? '0',
              actual_kobo: live?.actual_kobo ?? '0',
            };
          })
        : liveLines.rows.filter((line) => line.budget_id === id);
    const balances: BudgetLineBalanceView[] = source.map((line) => {
      const approved = Number(line.approved_amount_kobo);
      const committed = Number(line.committed_kobo);
      const paid = Number(line.paid_kobo);
      const actual = 'actual_kobo' in line ? Number(line.actual_kobo) : paid;
      return {
        id: line.id,
        code: line.code,
        name: line.name,
        departmentId: line.department_id,
        approvedKobo: approved,
        committedKobo: committed,
        approvedPendingKobo: Number(line.approved_pending_kobo),
        paidKobo: paid,
        actualKobo: actual,
        availableKobo: approved - committed,
        varianceKobo: approved - paid,
      };
    });
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      entityId: row.entity_id,
      entityCode: row.entity_code,
      fiscalYearId: row.fiscal_year_id,
      year: row.year,
      versionNumber: row.version_number,
      status: row.status,
      workflowInstanceId: row.workflow_instance_id,
      preparedByName: row.prepared_by_name,
      rowVersion: row.row_version,
      lines: balances,
    };
  }

  async create(actor: ActorContext, input: CreateBudgetInput): Promise<BudgetView> {
    assertCan(actor, 'finance.budget.prepare', input.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      const year = await tx.client.query<{ year: number; entity_id: string }>(
        `SELECT year, entity_id FROM fiscal_years WHERE id = $1`,
        [input.fiscalYearId],
      );
      const fiscal = year.rows[0];
      if (!fiscal || fiscal.entity_id !== input.entityId) {
        throw new ConflictError('The fiscal year does not belong to this entity.');
      }
      const version = await tx.client.query<{ n: string }>(
        `SELECT coalesce(max(version_number), 0)::text AS n
           FROM budgets WHERE entity_id = $1 AND fiscal_year_id = $2`,
        [input.entityId, input.fiscalYearId],
      );
      const nextVersion = Number(version.rows[0]?.n ?? 0) + 1;
      const ref = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('BUD') AS ref`);
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO budgets (
           reference_number, entity_id, fiscal_year_id, version_number, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING id`,
        [ref.rows[0]?.ref, input.entityId, input.fiscalYearId, nextVersion, actor.ref],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The budget was not created.');
      for (const line of input.lines) {
        await tx.client.query(
          `INSERT INTO budget_version_lines (
             budget_id, entity_id, code, name, approved_amount_kobo, department_id, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            id,
            input.entityId,
            line.code.trim(),
            line.name.trim(),
            line.approvedAmountKobo,
            line.departmentId ?? null,
            actor.ref,
          ],
        );
      }
      await tx.audit({
        action: 'create',
        subjectType: 'budget',
        subjectId: id,
        subjectLabel: ref.rows[0]?.ref ?? 'budget',
        subjectReferenceNumber: ref.rows[0]?.ref,
        entityId: input.entityId,
        newValue: { version: nextVersion },
      });
      await this.indexBudget(tx, id);
      return this.getInTx(tx, id);
    });
  }

  async submit(actor: ActorContext, id: string, rowVersion: number): Promise<BudgetView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await tx.client.query<{
        entity_id: string;
        status: string;
        created_by: string;
        row_version: number;
      }>(`SELECT entity_id, status, created_by, row_version FROM budgets WHERE id = $1 FOR UPDATE`, [id]);
      const row = current.rows[0];
      if (!row) throw new NotFoundError('That budget does not exist.');
      assertCan(actor, 'finance.budget.prepare', row.entity_id);
      if (row.created_by !== actor.ref) throw new ForbiddenError('Only the preparer can submit this budget.');
      if (row.status !== 'DRAFT') throw new ConflictError('This budget has already been submitted.');
      if (row.row_version !== rowVersion) {
        throw new StaleRecordError('This budget has changed. Refresh and try again.');
      }
      await tx.client.query(`UPDATE budgets SET status = 'PENDING_APPROVAL', updated_by = $1 WHERE id = $2`, [
        actor.ref,
        id,
      ]);
      const view = await this.getInTx(tx, id);
      const instance = await this.workflows.startBudgetInTx(tx, actor, {
        budgetId: id,
        snapshot: { reference: view.referenceNumber, lines: view.lines },
      });
      await tx.client.query(`UPDATE budgets SET workflow_instance_id = $1, updated_by = $2 WHERE id = $3`, [
        instance.id,
        actor.ref,
        id,
      ]);
      await tx.publish({
        eventType: 'budget.submitted',
        subjectType: 'BUDGET',
        subjectId: id,
        entityId: row.entity_id,
        payload: {
          type: 'budget.submitted',
          reference: view.referenceNumber,
          title: `Budget ${view.year}`,
          href: `/finance/budgets/${id}`,
        },
      });
      await this.indexBudget(tx, id);
      return this.getInTx(tx, id);
    });
  }

  async activity(
    actor: ActorContext,
    metric: string,
    entityId?: string,
    budgetId?: string,
  ): Promise<BudgetActivityView> {
    if (!can(actor, 'finance.budget.view') && !can(actor, 'finance.view')) {
      throw new ForbiddenError('You cannot view budgets.');
    }
    if (!isBudgetActivityMetric(metric)) {
      throw new ValidationFailedError('Unknown budget activity metric.', { metric: ['Must be approved, committed, paid or available.'] });
    }
    const meta = ACTIVITY_META[metric];
    return this.unitOfWork.read(actor, async (tx) => {
      const rows = await this.activityRowsInTx(tx, metric, entityId, budgetId);
      const totalKobo = rows.reduce((sum, row) => sum + row.amountKobo, 0);
      return {
        metric,
        title: meta.title,
        definition: meta.definition,
        totalKobo,
        rows,
      };
    });
  }

  private async activityRowsInTx(
    tx: TxScope,
    metric: BudgetActivityMetric,
    entityId?: string,
    budgetId?: string,
  ): Promise<BudgetActivityRowView[]> {
    if (metric === 'approved' || metric === 'available') {
      const result = await tx.client.query<{
        budget_id: string | null;
        budget_ref: string | null;
        line_code: string;
        line_name: string;
        entity_code: string | null;
        approved_kobo: string;
        committed_kobo: string;
        year: number;
      }>(
        `SELECT l.budget_id, b.reference_number AS budget_ref, l.code AS line_code, l.name AS line_name,
                e.code AS entity_code, l.approved_amount_kobo::text AS approved_kobo,
                coalesce((
                  SELECT sum(CASE WHEN pe.action = 'OPEN' THEN pe.amount_kobo ELSE -pe.amount_kobo END)
                    FROM procurement_commitment_events pe WHERE pe.budget_line_id = l.id
                ), 0)::text AS committed_kobo,
                l.fiscal_year AS year
           FROM budget_lines l
           JOIN entities e ON e.id = l.entity_id
           LEFT JOIN budgets b ON b.id = l.budget_id
          WHERE ($1::uuid IS NULL OR l.entity_id = $1)
            AND ($2::uuid IS NULL OR l.budget_id = $2)
          ORDER BY e.code, l.code`,
        [entityId ?? null, budgetId ?? null],
      );
      const rows: BudgetActivityRowView[] = [];
      for (const row of result.rows) {
        const approved = Number(row.approved_kobo);
        const committed = Number(row.committed_kobo);
        const amount = metric === 'approved' ? approved : approved - committed;
        if (metric === 'available' && amount <= 0) continue;
        if (metric === 'approved' && amount === 0) continue;
        rows.push({
          date: String(row.year),
          reference: row.budget_ref ?? row.line_code,
          description: `${row.line_code} ${row.line_name}`,
          entityCode: row.entity_code,
          budgetLineCode: row.line_code,
          amountKobo: amount,
          href: row.budget_id ? `/finance/budgets/${row.budget_id}` : '/finance/budgets',
        });
      }
      return rows;
    }

    if (metric === 'committed') {
      const result = await tx.client.query<{
        request_id: string;
        reference_number: string;
        title: string | null;
        entity_code: string | null;
        line_code: string | null;
        amount_kobo: string;
        occurred_on: string;
      }>(
        `SELECT r.id AS request_id, r.reference_number, v.title, e.code AS entity_code,
                bl.code AS line_code,
                sum(CASE WHEN pe.action = 'OPEN' THEN pe.amount_kobo ELSE -pe.amount_kobo END)::text AS amount_kobo,
                to_char(max(pe.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS occurred_on
           FROM procurement_commitment_events pe
           JOIN procurement_requests r ON r.id = pe.request_id
           JOIN entities e ON e.id = pe.entity_id
           LEFT JOIN budget_lines bl ON bl.id = pe.budget_line_id
           LEFT JOIN procurement_versions v
             ON v.request_id = r.id AND v.version_number = r.current_version
          WHERE ($1::uuid IS NULL OR pe.entity_id = $1)
            AND ($2::uuid IS NULL OR pe.budget_line_id IN (
                  SELECT id FROM budget_lines WHERE budget_id = $2
                ))
          GROUP BY r.id, r.reference_number, v.title, e.code, bl.code
         HAVING sum(CASE WHEN pe.action = 'OPEN' THEN pe.amount_kobo ELSE -pe.amount_kobo END) <> 0
          ORDER BY max(pe.created_at) DESC`,
        [entityId ?? null, budgetId ?? null],
      );
      return result.rows.map((row) => ({
        date: row.occurred_on,
        reference: row.reference_number,
        description: row.title || 'Procurement commitment',
        entityCode: row.entity_code,
        budgetLineCode: row.line_code,
        amountKobo: Number(row.amount_kobo),
        href: `/procurement/${row.request_id}`,
      }));
    }

    const paid = await tx.client.query<{
      request_id: string | null;
      reference_number: string | null;
      title: string | null;
      entity_code: string | null;
      line_code: string | null;
      amount_kobo: string;
      occurred_on: string;
    }>(
      `SELECT e.request_id, coalesce(r.reference_number, 'Payment') AS reference_number,
              v.title, ent.code AS entity_code, bl.code AS line_code,
              (CASE WHEN e.action = 'PAY' THEN e.amount_kobo ELSE -e.amount_kobo END)::text AS amount_kobo,
              to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS occurred_on
         FROM budget_commitment_events e
         JOIN entities ent ON ent.id = e.entity_id
         LEFT JOIN procurement_requests r ON r.id = e.request_id
         LEFT JOIN budget_lines bl ON bl.id = e.budget_line_id
         LEFT JOIN procurement_versions v
           ON v.request_id = r.id AND v.version_number = r.current_version
        WHERE e.action IN ('PAY', 'REVERSE_PAY')
          AND ($1::uuid IS NULL OR e.entity_id = $1)
          AND ($2::uuid IS NULL OR e.budget_line_id IN (
                SELECT id FROM budget_lines WHERE budget_id = $2
              ))
        ORDER BY e.created_at DESC`,
      [entityId ?? null, budgetId ?? null],
    );
    return paid.rows.map((row) => ({
      date: row.occurred_on,
      reference: row.reference_number ?? 'Payment',
      description: row.title || 'Budget payment',
      entityCode: row.entity_code,
      budgetLineCode: row.line_code,
      amountKobo: Number(row.amount_kobo),
      href: row.request_id ? `/procurement/${row.request_id}` : '/finance/budgets',
    }));
  }

  private async indexBudget(tx: TxScope, id: string): Promise<void> {
    const view = await this.getInTx(tx, id);
    await tx.indexSearch({
      recordType: 'BUDGET',
      recordId: id,
      referenceNumber: view.referenceNumber,
      title: `Budget ${view.year} v${view.versionNumber}`,
      searchableText: `${view.referenceNumber} ${view.lines.map((line) => line.code).join(' ')}`,
      entityId: view.entityId,
      permissionKey: 'finance.budget.view',
    });
  }
}

function isBudgetActivityMetric(value: string): value is BudgetActivityMetric {
  return value === 'approved' || value === 'committed' || value === 'paid' || value === 'available';
}
