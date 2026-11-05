import type { PoolClient } from 'pg';

export interface VendorPaymentRow {
  referenceNumber: string;
  amountKobo: number;
  entityId: string | null;
  entityCode: string | null;
  paidAt: string;
}

export interface VendorProcurementRow {
  referenceNumber: string;
  title: string;
  status: string;
  entityId: string | null;
  entityCode: string | null;
  occurredAt: string;
}

export async function isVendorValidAndActive(client: PoolClient, vendorId: string): Promise<boolean> {
  const result = await client.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM vendors v
      WHERE v.id = $1 AND v.status = 'ACTIVE'
        AND NOT EXISTS (
          SELECT 1 FROM vendor_compliance_documents c
         WHERE c.vendor_id = v.id AND c.required AND c.expires_at IS NOT NULL AND c.expires_at < CURRENT_DATE
        )
     ) AS ok`,
    [vendorId],
  );
  return result.rows[0]?.ok === true;
}

export async function hasVendorBeenUsedBefore(client: PoolClient, vendorId: string): Promise<boolean> {
  const result = await client.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM vendor_procurement_history_v WHERE vendor_id = $1) AS ok`,
    [vendorId],
  );
  return result.rows[0]?.ok === true;
}

export async function totalSpendKobo(
  client: PoolClient,
  vendorId: string,
  entityId?: string | null,
): Promise<number> {
  const result = await client.query<{ total: string }>(
    `SELECT coalesce(sum(amount_kobo), 0)::text AS total
       FROM vendor_payment_history_v
      WHERE vendor_id = $1
        AND ($2::uuid IS NULL OR entity_id = $2)`,
    [vendorId, entityId ?? null],
  );
  return Number(result.rows[0]?.total ?? 0);
}

export async function previousPayments(
  client: PoolClient,
  vendorId: string,
): Promise<VendorPaymentRow[]> {
  const result = await client.query<{
    reference_number: string;
    amount_kobo: string;
    entity_id: string | null;
    entity_code: string | null;
    paid_at: Date;
  }>(
    `SELECT reference_number, amount_kobo::text, entity_id, entity_code, paid_at
       FROM vendor_payment_history_v
      WHERE vendor_id = $1
      ORDER BY paid_at`,
    [vendorId],
  );
  return result.rows.map((row) => ({
    referenceNumber: row.reference_number,
    amountKobo: Number(row.amount_kobo),
    entityId: row.entity_id,
    entityCode: row.entity_code,
    paidAt: row.paid_at.toISOString(),
  }));
}

export async function subsidiariesUsed(client: PoolClient, vendorId: string): Promise<string[]> {
  const result = await client.query<{ entity_code: string }>(
    `SELECT DISTINCT entity_code
       FROM vendor_procurement_history_v
      WHERE vendor_id = $1 AND entity_code IS NOT NULL
      ORDER BY entity_code`,
    [vendorId],
  );
  return result.rows.map((row) => row.entity_code);
}

export async function isInvoiceNumberUsedElsewhere(
  client: PoolClient,
  vendorId: string,
  invoiceNumber: string,
  excludeProcurementRef?: string | null,
): Promise<boolean> {
  const result = await client.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM vendor_invoice_claims
        WHERE vendor_id = $1
          AND lower(btrim(invoice_number)) = lower(btrim($2))
          AND ($3::text IS NULL OR procurement_ref IS DISTINCT FROM $3)
     ) AS ok`,
    [vendorId, invoiceNumber, excludeProcurementRef ?? null],
  );
  return result.rows[0]?.ok === true;
}

export async function findPotentialDuplicateProcurement(
  client: PoolClient,
  vendorId: string,
  invoiceNumber?: string | null,
): Promise<VendorProcurementRow[]> {
  if (!invoiceNumber || invoiceNumber.trim() === '') {
    const history = await client.query<VendorProcurementRow>(
      `SELECT reference_number AS "referenceNumber", title, status,
              entity_id AS "entityId", entity_code AS "entityCode",
              occurred_at::text AS "occurredAt"
         FROM vendor_procurement_history_v
        WHERE vendor_id = $1
        ORDER BY occurred_at DESC
        LIMIT 20`,
      [vendorId],
    );
    return history.rows;
  }
  const claims = await client.query<{ procurement_ref: string | null }>(
    `SELECT procurement_ref FROM vendor_invoice_claims
      WHERE vendor_id = $1 AND lower(btrim(invoice_number)) = lower(btrim($2))`,
    [vendorId, invoiceNumber],
  );
  if (claims.rows.length === 0) return [];
  const refs = claims.rows.map((row) => row.procurement_ref).filter((value): value is string => Boolean(value));
  if (refs.length === 0) return [];
  const history = await client.query<{
    reference_number: string;
    title: string;
    status: string;
    entity_id: string | null;
    entity_code: string | null;
    occurred_at: Date;
  }>(
    `SELECT reference_number, title, status, entity_id, entity_code, occurred_at
       FROM vendor_procurement_history_v
      WHERE vendor_id = $1 AND reference_number = ANY($2::text[])`,
    [vendorId, refs],
  );
  return history.rows.map((row) => ({
    referenceNumber: row.reference_number,
    title: row.title,
    status: row.status,
    entityId: row.entity_id,
    entityCode: row.entity_code,
    occurredAt: row.occurred_at.toISOString(),
  }));
}

export async function listProcurementHistory(
  client: PoolClient,
  vendorId: string,
): Promise<VendorProcurementRow[]> {
  const result = await client.query<{
    reference_number: string;
    title: string;
    status: string;
    entity_id: string | null;
    entity_code: string | null;
    occurred_at: Date;
  }>(
    `SELECT reference_number, title, status, entity_id, entity_code, occurred_at
       FROM vendor_procurement_history_v
      WHERE vendor_id = $1
      ORDER BY occurred_at DESC`,
    [vendorId],
  );
  return result.rows.map((row) => ({
    referenceNumber: row.reference_number,
    title: row.title,
    status: row.status,
    entityId: row.entity_id,
    entityCode: row.entity_code,
    occurredAt: row.occurred_at.toISOString(),
  }));
}
