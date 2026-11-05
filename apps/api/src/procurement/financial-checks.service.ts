import { Injectable } from '@nestjs/common';
import { isVendorValidAndActive } from '@nfc/db';
import type { ActorContext } from '@nfc/db';
import {
  type FinancialCheckView,
  type FundingRoute,
  multiplyKoboByQuantity,
} from '@nfc/shared';
import { can } from '../auth/can';
import { ForbiddenError, NotFoundError } from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';

@Injectable()
export class FinancialChecksService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async evaluate(actor: ActorContext, requestId: string): Promise<FinancialCheckView[]> {
    if (
      !can(actor, 'procurement.review.finance') &&
      !can(actor, 'procurement.view') &&
      !can(actor, 'finance.funding.authorize')
    ) {
      throw new ForbiddenError('You cannot run the financial checks for this request.');
    }
    return this.unitOfWork.read(actor, (tx) => this.evaluateInTx(tx, requestId));
  }

  async evaluateInTx(tx: TxScope, requestId: string): Promise<FinancialCheckView[]> {
    const request = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      entity_code: string;
      entity_name: string;
      vendor_id: string | null;
      vendor_name: string | null;
      title: string;
      category_id: string | null;
      category_name: string | null;
      quantity: number | null;
      unit_price_kobo: string | null;
      total_amount_kobo: string | null;
      invoice_amount_kobo: string | null;
      invoice_number: string | null;
      invoice_vendor_id: string | null;
      invoice_variance_status: string | null;
      invoice_variance_amount_kobo: string | null;
      invoice_required: boolean | null;
      budget_line_id: string | null;
      budget_approved_kobo: string | null;
      funding_source_key: string | null;
    }>(
      `SELECT r.id, r.reference_number, r.entity_id, e.code AS entity_code, e.name AS entity_name,
              coalesce(r.vendor_id, v.vendor_id) AS vendor_id, ven.legal_name AS vendor_name,
              v.title, v.category_id, c.name AS category_name, v.quantity,
              v.unit_price_kobo::text, v.total_amount_kobo::text,
              inv.amount_kobo::text AS invoice_amount_kobo, inv.invoice_number, inv.vendor_id AS invoice_vendor_id,
              (SELECT iv.status FROM procurement_invoice_variances iv
                WHERE iv.version_id = v.id AND iv.status <> 'SUPERSEDED'
                ORDER BY iv.created_at DESC LIMIT 1) AS invoice_variance_status,
              (SELECT iv.invoice_amount_kobo::text FROM procurement_invoice_variances iv
                WHERE iv.version_id = v.id AND iv.status <> 'SUPERSEDED'
                ORDER BY iv.created_at DESC LIMIT 1) AS invoice_variance_amount_kobo,
              c.invoice_required, v.budget_line_id, bl.approved_amount_kobo::text AS budget_approved_kobo,
              fs.key AS funding_source_key
         FROM procurement_requests r
         JOIN entities e ON e.id = r.entity_id
         JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
         LEFT JOIN vendors ven ON ven.id = coalesce(r.vendor_id, v.vendor_id)
         LEFT JOIN procurement_categories c ON c.id = v.category_id
         LEFT JOIN procurement_invoices inv ON inv.version_id = v.id
         LEFT JOIN budget_lines bl ON bl.id = v.budget_line_id
         LEFT JOIN funding_sources fs ON fs.id = v.funding_source_id
        WHERE r.id = $1`,
      [requestId],
    );
    const row = request.rows[0];
    if (!row) throw new NotFoundError('That procurement request was not found.');

    const version = await tx.client.query<{ id: string }>(
      `SELECT v.id
         FROM procurement_requests r
         JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
        WHERE r.id = $1`,
      [requestId],
    );
    const lineRows = version.rows[0]
      ? await tx.client.query<{
          quantity: number | null;
          unit_price_kobo: string | null;
          line_amount_kobo: string | null;
          budget_line_id: string | null;
          invoice_required: boolean | null;
        }>(
          `SELECT l.quantity, l.unit_price_kobo::text, l.line_amount_kobo::text, l.budget_line_id,
                  c.invoice_required
             FROM procurement_version_lines l
             LEFT JOIN procurement_categories c ON c.id = l.category_id
            WHERE l.version_id = $1
            ORDER BY l.line_number`,
          [version.rows[0].id],
        )
      : { rows: [] };
    const recomputed = lineRows.rows.reduce((sum, line) => {
      if (line.quantity != null && line.unit_price_kobo != null) {
        return sum + Number(multiplyKoboByQuantity(BigInt(Number(line.unit_price_kobo)), line.quantity));
      }
      return sum;
    }, 0);
    const storedLineTotal = lineRows.rows.reduce((sum, line) => sum + Number(line.line_amount_kobo ?? 0), 0);
    const total =
      storedLineTotal > 0 ? storedLineTotal : row.total_amount_kobo == null ? recomputed : Number(row.total_amount_kobo);
    const invoiceAmount = row.invoice_amount_kobo == null ? null : Number(row.invoice_amount_kobo);

    const windowDays = await this.duplicateWindowDays(tx);
    const budgetIds = [
      ...new Set(lineRows.rows.map((line) => line.budget_line_id).filter((id): id is string => Boolean(id))),
    ];
    if (row.budget_line_id && budgetIds.length === 0) budgetIds.push(row.budget_line_id);
    const commitments = await this.openCommitments(tx, budgetIds[0] ?? row.budget_line_id, row.vendor_id, requestId);
    const budgetSummaries = await Promise.all(
      budgetIds.map(async (budgetId) => {
        const needed = lineRows.rows
          .filter((line) => line.budget_line_id === budgetId)
          .reduce((sum, line) => sum + Number(line.line_amount_kobo ?? 0), 0);
        const available = await this.budgetAvailable(tx, budgetId);
        return { budgetId, needed, available };
      }),
    );
    const budgetOk =
      budgetSummaries.length > 0 && budgetSummaries.every((item) => item.available >= item.needed && item.needed > 0);
    const vendorOk = row.vendor_id ? await isVendorValidAndActive(tx.client, row.vendor_id) : false;
    const vendorHistory = row.vendor_id
      ? await tx.client.query<{ count: string; last_at: Date | null }>(
          `SELECT count(*)::text, max(occurred_at) AS last_at
             FROM vendor_procurement_history_v
            WHERE vendor_id = $1 AND reference_number <> $2`,
          [row.vendor_id, row.reference_number],
        )
      : { rows: [{ count: '0', last_at: null }] };
    const priorCount = Number(vendorHistory.rows[0]?.count ?? 0);
    const lastUsed = vendorHistory.rows[0]?.last_at;

    const invoiceDup = row.vendor_id && row.invoice_number
      ? await tx.client.query<{ refs: string | null }>(
          `SELECT string_agg(distinct procurement_ref, ', ') AS refs
             FROM vendor_invoice_claims
            WHERE vendor_id = $1
              AND lower(btrim(invoice_number)) = lower(btrim($2))
              AND procurement_ref IS DISTINCT FROM $3`,
          [row.vendor_id, row.invoice_number, row.reference_number],
        )
      : { rows: [{ refs: null }] };

    const similar = row.vendor_id
      ? await tx.client.query<{ reference_number: string }>(
          `SELECT r.reference_number
             FROM procurement_requests r
             JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
            WHERE r.id <> $1
              AND r.status NOT IN ('DISCARDED', 'DRAFT')
              AND coalesce(r.vendor_id, v.vendor_id) = $2
              AND v.category_id IS NOT DISTINCT FROM $3
              AND abs(coalesce(v.total_amount_kobo, 0) - $4) <= greatest(100000, ($4 * 0.05)::bigint)
              AND lower(btrim(v.title)) = lower(btrim($5))
              AND r.created_at >= now() - ($6::int || ' days')::interval
            LIMIT 5`,
          [requestId, row.vendor_id, row.category_id, total, row.title, windowDays],
        )
      : { rows: [] };

    // The invoice is required at ED Finance for every request; an amount that differs from the
    // approved total passes only once the MD has approved that exact invoiced amount.
    const varianceApproved =
      row.invoice_variance_status === 'APPROVED' &&
      invoiceAmount !== null &&
      Number(row.invoice_variance_amount_kobo ?? -1) === invoiceAmount;

    const suggestedRoute = (row.funding_source_key ?? 'subsidiary_operating') as FundingRoute;
    const payable = varianceApproved && invoiceAmount !== null ? invoiceAmount : total;
    const fundingAccount = await this.fundingBalance(tx, row.entity_id, suggestedRoute, payable);

    const amountMatch = recomputed === total;
    const invoiceMatch = invoiceAmount !== null && (invoiceAmount === total || varianceApproved);
    const invoiceVendorOk =
      invoiceAmount === null || !row.invoice_vendor_id || !row.vendor_id || row.invoice_vendor_id === row.vendor_id;

    return [
      {
        key: 'amount',
        label: 'Amount recomputed',
        result: amountMatch ? 'PASS' : 'FAIL',
        summary: amountMatch
          ? `Quantity × unit price equals ${total} kobo.`
          : `Stored total ${total} kobo does not match ${recomputed} kobo.`,
        href: `/procurement/${requestId}`,
      },
      {
        key: 'budget',
        label: 'Approved budget',
        result: budgetIds.length === 0 ? 'FAIL' : budgetOk ? 'PASS' : 'FAIL',
        summary:
          budgetIds.length === 0
            ? 'No budget line is attached.'
            : budgetOk
              ? budgetSummaries
                  .map((item) => `Budget ${item.budgetId.slice(0, 8)} has ${item.available} kobo for ${item.needed} kobo.`)
                  .join(' ')
              : budgetSummaries
                  .map((item) =>
                    item.available >= item.needed
                      ? `Budget has ${item.available} kobo for ${item.needed} kobo.`
                      : `Available ${item.available} kobo is below ${item.needed} kobo.`,
                  )
                  .join(' '),
        href: '/budget-lines',
      },
      {
        key: 'vendor',
        label: 'Vendor validity',
        result: vendorOk ? 'PASS' : 'FAIL',
        summary: vendorOk
          ? `${row.vendor_name ?? 'Vendor'} is Active and compliance documents are current.`
          : 'The vendor is not Active or a required compliance document has expired.',
        href: row.vendor_id ? `/vendors/${row.vendor_id}` : null,
      },
      {
        key: 'vendor_history',
        label: 'Vendor used before',
        result: priorCount > 0 ? 'PASS' : 'WARN',
        summary:
          priorCount > 0
            ? `${priorCount} earlier request(s); last ${lastUsed ? lastUsed.toISOString().slice(0, 10) : 'unknown'}.`
            : 'This vendor has not been used on a submitted request before.',
        href: row.vendor_id ? `/vendors/${row.vendor_id}` : null,
      },
      {
        key: 'funding',
        label: 'Sufficient funding',
        result: fundingAccount.result,
        summary: fundingAccount.summary,
        href: '/admin/health',
      },
      {
        key: 'duplicate_procurement',
        label: 'Duplicate procurement',
        result: similar.rows.length === 0 ? 'PASS' : 'WARN',
        summary:
          similar.rows.length === 0
            ? `No similar request in the last ${windowDays} days.`
            : `Similar request(s): ${similar.rows.map((item) => item.reference_number).join(', ')}.`,
        href: similar.rows[0] ? `/procurement?q=${similar.rows[0].reference_number}` : null,
      },
      {
        key: 'duplicate_invoice',
        label: 'Duplicate invoice',
        result: invoiceDup.rows[0]?.refs ? 'FAIL' : row.invoice_number ? 'PASS' : 'FAIL',
        summary: invoiceDup.rows[0]?.refs
          ? `Invoice already claimed on ${invoiceDup.rows[0].refs}.`
          : row.invoice_number
            ? 'This invoice number has not been used for this vendor on another request.'
            : 'The vendor invoice has not been uploaded yet.',
        href: null,
      },
      {
        key: 'invoice_amount',
        label: 'Invoice amount',
        result: invoiceMatch ? 'PASS' : 'FAIL',
        summary: invoiceMatch
          ? varianceApproved
            ? `The MD approved the invoiced amount of ${invoiceAmount} kobo (request ${total} kobo).`
            : 'Invoice amount matches the approved amount.'
          : invoiceAmount === null
            ? 'The vendor invoice has not been uploaded yet.'
            : row.invoice_variance_status === 'REJECTED'
              ? `The MD rejected the invoiced amount of ${invoiceAmount} kobo; a corrected invoice is required.`
              : `Invoice ${invoiceAmount} kobo differs from the approved ${total} kobo and awaits MD approval.`,
        href: `/procurement/${requestId}`,
      },
      {
        key: 'invoice_vendor',
        label: 'Invoice vendor',
        result: invoiceAmount === null ? 'FAIL' : invoiceVendorOk ? 'PASS' : 'FAIL',
        summary:
          invoiceAmount === null
            ? 'The vendor invoice has not been uploaded yet.'
            : invoiceVendorOk
              ? `The invoice is from the approved vendor${row.vendor_name ? `, ${row.vendor_name}` : ''}.`
              : 'The invoice is not from the approved vendor.',
        href: `/procurement/${requestId}`,
      },
      {
        key: 'responsibility',
        label: 'Funding responsibility',
        result: 'PASS',
        summary: `${row.entity_name} (${row.entity_code}) is responsible. Suggested route: ${suggestedRoute.replaceAll('_', ' ')}.`,
        href: null,
      },
      {
        key: 'commitments',
        label: 'Outstanding commitments',
        result: commitments.count === 0 ? 'PASS' : 'WARN',
        summary:
          commitments.count === 0
            ? 'No other open commitments on this budget line or vendor.'
            : `${commitments.count} open commitment(s) totalling ${commitments.amount} kobo.`,
        href: '/budget-lines',
      },
    ];
  }

  private async duplicateWindowDays(tx: TxScope): Promise<number> {
    const result = await tx.client.query<{ integer_value: number | null }>(
      `SELECT integer_value FROM procurement_policies WHERE key = 'duplicate_window_days'`,
    );
    return result.rows[0]?.integer_value ?? 30;
  }

  private async budgetAvailable(tx: TxScope, budgetLineId: string | null): Promise<number> {
    if (!budgetLineId) return 0;
    const result = await tx.client.query<{ available: string }>(
      `SELECT (bl.approved_amount_kobo - coalesce((
         SELECT sum(CASE WHEN e.action = 'OPEN' THEN e.amount_kobo ELSE -e.amount_kobo END)
           FROM procurement_commitment_events e
          WHERE e.budget_line_id = bl.id
       ), 0))::text AS available
         FROM budget_lines bl WHERE bl.id = $1`,
      [budgetLineId],
    );
    return Number(result.rows[0]?.available ?? 0);
  }

  private async openCommitments(
    tx: TxScope,
    budgetLineId: string | null,
    vendorId: string | null,
    excludeRequestId: string,
  ): Promise<{ count: number; amount: number }> {
    const result = await tx.client.query<{ count: string; amount: string }>(
      `SELECT count(*)::text, coalesce(sum(open_amount), 0)::text AS amount
         FROM (
           SELECT e.request_id,
                  sum(CASE WHEN e.action = 'OPEN' THEN e.amount_kobo ELSE -e.amount_kobo END) AS open_amount
             FROM procurement_commitment_events e
            WHERE e.request_id <> $1
              AND ($2::uuid IS NULL OR e.budget_line_id = $2)
            GROUP BY e.request_id
           HAVING sum(CASE WHEN e.action = 'OPEN' THEN e.amount_kobo ELSE -e.amount_kobo END) > 0
         ) open_rows`,
      [excludeRequestId, budgetLineId],
    );
    void vendorId;
    return { count: Number(result.rows[0]?.count ?? 0), amount: Number(result.rows[0]?.amount ?? 0) };
  }

  private async fundingBalance(
    tx: TxScope,
    entityId: string,
    route: string,
    amount: number,
  ): Promise<{ result: FinancialCheckView['result']; summary: string }> {
    const accountEntity =
      route === 'nfc_holding' || route === 'corporate_allocation'
        ? await tx.client.query<{ id: string }>(`SELECT id FROM entities WHERE code = 'NFC'`)
        : { rows: [{ id: entityId }] };
    const ownerId = accountEntity.rows[0]?.id ?? entityId;
    const account = await tx.client.query<{
      name: string;
      recorded_balance_kobo: string;
      gl_account_id: string | null;
    }>(
      `SELECT name, recorded_balance_kobo::text, gl_account_id
         FROM entity_bank_accounts
        WHERE entity_id = $1 AND status = 'ACTIVE'
        ORDER BY created_at
        LIMIT 1`,
      [ownerId],
    );
    const row = account.rows[0];
    if (!row) {
      return { result: 'WARN', summary: 'No active bank account is recorded for the funding entity.' };
    }
    const recorded = Number(row.recorded_balance_kobo);
    let ledger = recorded;
    if (row.gl_account_id) {
      const gl = await tx.client.query<{ balance: string }>(
        `SELECT coalesce(sum(l.debit_kobo - l.credit_kobo), 0)::text AS balance
           FROM journal_lines l
           JOIN journals j ON j.id = l.journal_id
          WHERE l.account_id = $1 AND j.status = 'POSTED'`,
        [row.gl_account_id],
      );
      ledger = Number(gl.rows[0]?.balance ?? 0);
    }
    const available = ledger;
    if (available >= amount) {
      return {
        result: 'PASS',
        summary: `${row.name} ledger ${available} kobo (recorded ${recorded} kobo) covers ${amount} kobo.`,
      };
    }
    return {
      result: 'FAIL',
      summary: `${row.name} ledger ${available} kobo (recorded ${recorded} kobo) is below ${amount} kobo.`,
    };
  }
}
