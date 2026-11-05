import type { PoolClient } from 'pg';

export interface SearchIndexInput {
  recordType: string;
  recordId: string;
  referenceNumber?: string | null;
  title: string;
  searchableText: string;
  entityId: string;
  permissionKey: string;
}

export async function upsertSearchIndex(client: PoolClient, input: SearchIndexInput): Promise<void> {
  await client.query(
    `SELECT app.upsert_search_index($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.recordType,
      input.recordId,
      input.referenceNumber ?? null,
      input.title,
      input.searchableText,
      input.entityId,
      input.permissionKey,
    ],
  );
}

export interface SearchHit {
  recordType: string;
  recordId: string;
  referenceNumber: string | null;
  title: string;
  entityId: string;
  href: string | null;
}

export async function searchIndex(client: PoolClient, query: string, limit = 50): Promise<SearchHit[]> {
  const trimmed = query.trim();
  if (trimmed === '') return [];
  const fts = trimmed.replace(/[^A-Za-z0-9]+/g, ' ').trim();
  const digits = trimmed.replace(/[^\d]/g, '');

  const result = await client.query<{
    record_type: string;
    record_id: string;
    reference_number: string | null;
    title: string;
    entity_id: string;
  }>(
    `SELECT record_type, record_id, reference_number, title, entity_id
       FROM search_index
      WHERE coalesce(reference_number, '') ILIKE '%' || $1 || '%'
         OR title ILIKE '%' || $1 || '%'
         OR searchable_text ILIKE '%' || $1 || '%'
         OR ($2 <> '' AND searchable_text ILIKE '%' || $2 || '%')
         OR ($3 <> '' AND search_vector @@ plainto_tsquery('simple', $3))
         OR similarity(coalesce(reference_number, ''), $1) > 0.35
         OR similarity(title, $1) > 0.35
      ORDER BY
        CASE WHEN reference_number = $1 THEN 0
             WHEN reference_number ILIKE $1 || '%' THEN 1
             ELSE 2 END,
        updated_at DESC
      LIMIT $4`,
    [trimmed, digits, fts, limit],
  );

  return result.rows.map((row) => ({
    recordType: row.record_type,
    recordId: row.record_id,
    referenceNumber: row.reference_number,
    title: row.title,
    entityId: row.entity_id,
    href: hrefFor(row.record_type, row.record_id),
  }));
}

function hrefFor(recordType: string, recordId: string): string | null {
  if (recordType === 'ENGINE') return `/engine/${recordId}`;
  if (recordType === 'DOCUMENT') return `/documents/${recordId}`;
  if (recordType === 'WORKFLOW') return `/workflows/${recordId}`;
  if (recordType === 'VENDOR') return `/vendors/${recordId}`;
  if (recordType === 'PROCUREMENT') return `/procurement/${recordId}`;
  if (recordType === 'JOURNAL') return `/finance/journals/${recordId}`;
  if (recordType === 'ACCOUNT') return `/finance/coa`;
  if (recordType === 'BUDGET') return `/finance/budgets/${recordId}`;
  if (recordType === 'BANK_TXN') return `/finance/bank`;
  if (recordType === 'CUSTOMER') return `/finance/customers/${recordId}`;
  if (recordType === 'AR_INVOICE') return `/finance/receivables`;
  if (recordType === 'RECEIPT') return `/finance/receivables`;
  if (recordType === 'BILL') return `/finance/payables/${recordId}`;
  if (recordType === 'INCOME') return `/finance/income/${recordId}`;
  if (recordType === 'EXPENSE') return `/finance/expenses/${recordId}`;
  if (recordType === 'INTERCOMPANY') return `/finance/intercompany/${recordId}`;
  if (recordType === 'REPORT_RUN') return `/finance/reports`;
  if (recordType === 'ITEM') return `/inventory/items/${recordId}`;
  if (recordType === 'STOCK_MOVEMENT') return `/inventory`;
  if (recordType === 'STOCK_TRANSFER') return `/inventory/transfers`;
  if (recordType === 'PRODUCTION_ORDER') return `/inventory/production/${recordId}`;
  if (recordType === 'SALES_ORDER') return `/inventory/sales/${recordId}`;
  if (recordType === 'SALES_DISPATCH') return `/inventory/sales/dispatches`;
  if (recordType === 'EMPLOYEE') return `/hr/employees/${recordId}`;
  if (recordType === 'REQUISITION') return `/requisitions/${recordId}`;
  if (recordType === 'PAYROLL_RUN') return `/hr/payroll/${recordId}`;
  if (recordType === 'PAYMENT') return `/procurement/${recordId}`;
  if (recordType === 'GRN') return `/procurement/${recordId}`;
  return null;
}
