import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { AccountType, EliminationReportView, EliminationRowView } from '@nfc/shared';
import { can } from '../auth/can';
import { ForbiddenError } from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import type { ReportWindow } from './report-window';

export interface CodeBalance {
  consolidationCode: string;
  accountType: AccountType;
  accountName: string;
  debitKobo: number;
  creditKobo: number;
}

export async function postedPairTotal(
  tx: TxScope,
  window: ReportWindow,
  entityId?: string | null,
): Promise<number> {
  const result = await tx.client.query<{ total: string }>(
    `SELECT coalesce(sum(t.amount_kobo), 0)::text AS total
       FROM intercompany_transactions t
       JOIN journals sj ON sj.id = t.source_journal_id
       JOIN journals dj ON dj.id = t.destination_journal_id
      WHERE sj.status = 'POSTED' AND dj.status = 'POSTED'
        AND ($1::uuid IS NULL OR t.source_entity_id = $1 OR t.destination_entity_id = $1)
        AND ($2::date IS NULL OR t.occurred_on <= $2::date)`,
    [entityId ?? null, window.asOf],
  );
  return Number(result.rows[0]?.total ?? 0);
}

export function applyEliminations(balances: CodeBalance[], eliminatedKobo: number): CodeBalance[] {
  if (eliminatedKobo === 0) return balances;
  return balances.map((row) => {
    if (row.consolidationCode === '1210') {
      return { ...row, creditKobo: row.creditKobo + eliminatedKobo };
    }
    if (row.consolidationCode === '2120') {
      return { ...row, debitKobo: row.debitKobo + eliminatedKobo };
    }
    return row;
  });
}

export function netFor(row: CodeBalance): number {
  if (row.accountType === 'ASSET' || row.accountType === 'EXPENSE') {
    return row.debitKobo - row.creditKobo;
  }
  return row.creditKobo - row.debitKobo;
}

export async function fetchCodeBalances(
  tx: TxScope,
  opts: {
    entityId?: string | null;
    window: ReportWindow;
    mode: 'activity' | 'as_of';
    compare?: boolean;
  },
): Promise<CodeBalance[]> {
  const start = opts.compare ? opts.window.compareStart : opts.window.activityStart;
  const end = opts.compare ? opts.window.compareEnd : opts.window.activityEnd;
  const asOf = opts.compare ? opts.window.compareAsOf : opts.window.asOf;
  const result = await tx.client.query<{
    consolidation_code: string;
    account_type: AccountType;
    account_name: string;
    debit: string;
    credit: string;
  }>(
    `SELECT a.consolidation_code, a.type AS account_type, min(a.name) AS account_name,
            coalesce(sum(l.debit_kobo), 0)::text AS debit,
            coalesce(sum(l.credit_kobo), 0)::text AS credit
       FROM journal_lines l
       JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id
       JOIN fiscal_periods p ON p.id = j.fiscal_period_id
      WHERE j.status = 'POSTED'
        AND ($1::uuid IS NULL OR j.entity_id = $1)
        AND (
          $2::text = 'as_of'
            AND ($3::date IS NULL OR p.ends_on <= $3::date)
          OR $2::text = 'activity'
            AND ($4::date IS NULL OR p.starts_on >= $4::date)
            AND ($5::date IS NULL OR p.ends_on <= $5::date)
        )
        AND ($6::uuid IS NULL OR l.department_id = $6)
        AND ($7::uuid IS NULL OR l.project_id = $7)
      GROUP BY a.consolidation_code, a.type
      ORDER BY a.consolidation_code`,
    [
      opts.entityId ?? null,
      opts.mode,
      asOf,
      start,
      end,
      opts.window.departmentId,
      opts.window.projectId,
    ],
  );
  return result.rows.map((row) => ({
    consolidationCode: row.consolidation_code,
    accountType: row.account_type,
    accountName: row.account_name,
    debitKobo: Number(row.debit),
    creditKobo: Number(row.credit),
  }));
}

export async function listEliminationRows(
  tx: TxScope,
  window: ReportWindow,
  entityId?: string | null,
): Promise<EliminationRowView[]> {
  const result = await tx.client.query<{
    id: string;
    reference_number: string;
    type: EliminationRowView['type'];
    source_code: string | null;
    dest_code: string | null;
    amount_kobo: string;
    occurred_on: Date;
    source_journal_id: string | null;
    dest_journal_id: string | null;
    source_status: string | null;
    dest_status: string | null;
  }>(
    `SELECT t.id, t.reference_number, t.type, se.code AS source_code, de.code AS dest_code,
            t.amount_kobo::text, t.occurred_on, t.source_journal_id, t.destination_journal_id,
            sj.status AS source_status, dj.status AS dest_status
       FROM intercompany_transactions t
       JOIN entities se ON se.id = t.source_entity_id
       JOIN entities de ON de.id = t.destination_entity_id
       LEFT JOIN journals sj ON sj.id = t.source_journal_id
       LEFT JOIN journals dj ON dj.id = t.destination_journal_id
      WHERE ($1::uuid IS NULL OR t.source_entity_id = $1 OR t.destination_entity_id = $1)
        AND ($2::date IS NULL OR t.occurred_on <= $2::date)
      ORDER BY t.occurred_on, t.reference_number`,
    [entityId ?? null, window.asOf],
  );
  return result.rows.map((row) => {
    const bothPosted = row.source_status === 'POSTED' && row.dest_status === 'POSTED';
    let skipReason: string | null = null;
    if (!row.source_journal_id || !row.dest_journal_id) skipReason = 'journal missing';
    else if (!bothPosted) skipReason = 'not both POSTED';
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      type: row.type,
      sourceEntityCode: row.source_code,
      destinationEntityCode: row.dest_code,
      amountKobo: Number(row.amount_kobo),
      occurredOn: row.occurred_on.toISOString().slice(0, 10),
      sourceJournalId: row.source_journal_id,
      destinationJournalId: row.dest_journal_id,
      eliminated: bothPosted,
      skipReason,
    };
  });
}

@Injectable()
export class ConsolidationService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async eliminationReport(
    actor: ActorContext,
    window: ReportWindow,
    entityId?: string | null,
  ): Promise<EliminationReportView> {
    if (!can(actor, 'finance.view')) throw new ForbiddenError('You cannot view reports.');
    return this.unitOfWork.read(actor, async (tx) => this.eliminationReportInTx(tx, window, entityId));
  }

  async eliminationReportInTx(
    tx: TxScope,
    window: ReportWindow,
    entityId?: string | null,
  ): Promise<EliminationReportView> {
    const rows = await listEliminationRows(tx, window, entityId);
    return {
      rows,
      eliminatedTotalKobo: rows.filter((row) => row.eliminated).reduce((sum, row) => sum + row.amountKobo, 0),
      skippedTotalKobo: rows.filter((row) => !row.eliminated).reduce((sum, row) => sum + row.amountKobo, 0),
    };
  }
}
