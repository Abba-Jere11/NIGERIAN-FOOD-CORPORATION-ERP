import {
  NFC_BANK_ACCOUNT_ID,
  NFC_YFZ_ICT_ID,
  NFC_YFZ_MISMATCH_ICT_ID,
  SEED_USERS,
  XYZ_VENDOR_ID,
  YFZ_AR_30_ID,
  YFZ_AR_60_ID,
  YFZ_AR_90_ID,
  YFZ_AR_90PLUS_ID,
  YFZ_AR_CURRENT_ID,
  YFZ_BANK_ACCOUNT_ID,
  YFZ_CUSTOMER_ID,
  YFZ_OVERDUE_BILL_ID,
  YFZ_PROCUREMENT_AWAITING_DELIVERY_ID,
  YFZ_PROCUREMENT_PARTIAL_RECEIPT_ID,
} from '@nfc/shared';
import type { Pool, PoolClient } from 'pg';
import { upsertSearchIndex } from './search';

const EMEKA_ID = SEED_USERS.find((user) => user.email === 'ed.finance@nfc.local')?.id;
const YAHUZA_ID = SEED_USERS.find((user) => user.email === 'fh.yfz@nfc.local')?.id;

export async function seedM11(pool: Pool): Promise<{ alreadyPresent: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT 1 FROM customers WHERE id = $1', [YFZ_CUSTOMER_ID]);
    if (existing.rows[0]) {
      await client.query('COMMIT');
      return { alreadyPresent: true };
    }
    if (!EMEKA_ID || !YAHUZA_ID) throw new Error('Seed identities before M11 fixtures.');

    const entities = await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM entities WHERE code IN ('NFC', 'YFZ')`,
    );
    const byCode = new Map(entities.rows.map((row) => [row.code, row.id]));
    const yfz = byCode.get('YFZ');
    const nfc = byCode.get('NFC');
    if (!yfz || !nfc) throw new Error('Seed organisations before M11 fixtures.');

    await seedCustomerAndReceivables(client, yfz);
    await seedOverdueBill(client, yfz);
    await seedOpeningCash(client, nfc, yfz);
    await seedIntercompany(client, nfc, yfz);
    await seedMismatch(client, nfc, yfz);
    await backfillPaidProcurement(client, yfz, YFZ_PROCUREMENT_AWAITING_DELIVERY_ID);
    await backfillPaidProcurement(client, yfz, YFZ_PROCUREMENT_PARTIAL_RECEIPT_ID);

    await client.query('COMMIT');
    return { alreadyPresent: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedCustomerAndReceivables(client: PoolClient, yfz: string): Promise<void> {
  const ref = await nextRef(client, 'CUS');
  await client.query(
    `INSERT INTO customers (
       id, reference_number, entity_id, name, terms_days, credit_limit_kobo, created_by, updated_by
     ) VALUES ($1, $2, $3, 'Maiduguri Grain Traders', 30, 5000000000, $4, $4)`,
    [YFZ_CUSTOMER_ID, ref, yfz, EMEKA_ID],
  );
  await upsertSearchIndex(client, {
    recordType: 'CUSTOMER',
    recordId: YFZ_CUSTOMER_ID,
    referenceNumber: ref,
    title: 'Maiduguri Grain Traders',
    searchableText: `${ref} Maiduguri Grain Traders`,
    entityId: yfz,
    permissionKey: 'finance.view',
  });

  const invoices: Array<{ id: string; daysAgo: number; amount: number }> = [
    { id: YFZ_AR_CURRENT_ID, daysAgo: -5, amount: 2_500_000_00 },
    { id: YFZ_AR_30_ID, daysAgo: 15, amount: 1_800_000_00 },
    { id: YFZ_AR_60_ID, daysAgo: 45, amount: 3_200_000_00 },
    { id: YFZ_AR_90_ID, daysAgo: 75, amount: 900_000_00 },
    { id: YFZ_AR_90PLUS_ID, daysAgo: 120, amount: 4_100_000_00 },
  ];
  for (const invoice of invoices) {
    const arRef = await nextRef(client, 'ARI');
    await client.query(
      `INSERT INTO receivable_invoices (
         id, reference_number, entity_id, customer_id, invoice_date, due_date, amount_kobo,
         created_by, updated_by
       ) VALUES ($1, $2, $3, $4, (current_date - ($5 + 30)), (current_date - $5), $6, $7, $7)`,
      [invoice.id, arRef, yfz, YFZ_CUSTOMER_ID, invoice.daysAgo, invoice.amount, EMEKA_ID],
    );
    await upsertSearchIndex(client, {
      recordType: 'AR_INVOICE',
      recordId: invoice.id,
      referenceNumber: arRef,
      title: `Receivable ${arRef}`,
      searchableText: arRef,
      entityId: yfz,
      permissionKey: 'finance.view',
    });
  }
}

async function seedOverdueBill(client: PoolClient, yfz: string): Promise<void> {
  const ref = await nextRef(client, 'BILL');
  await client.query(
    `INSERT INTO payable_invoices (
       id, reference_number, entity_id, vendor_id, source, invoice_date, due_date, amount_kobo,
       status, narration, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, 'BILL', current_date - 45, current_date - 15, 750000000, 'UNPAID',
               'Seeded overdue utilities bill', $5, $5)`,
    [YFZ_OVERDUE_BILL_ID, ref, yfz, XYZ_VENDOR_ID, EMEKA_ID],
  );
  await upsertSearchIndex(client, {
    recordType: 'BILL',
    recordId: YFZ_OVERDUE_BILL_ID,
    referenceNumber: ref,
    title: 'Seeded overdue utilities bill',
    searchableText: ref,
    entityId: yfz,
    permissionKey: 'finance.view',
  });
}

async function seedOpeningCash(client: PoolClient, nfc: string, yfz: string): Promise<void> {
  const occurred = '2026-01-15';
  await postPair(client, {
    entityId: nfc,
    debitCode: '1130',
    creditCode: '3100',
    amount: 500_000_000_000,
    occurred,
    narration: 'Opening cash — NFC Holding operating',
    key: 'seed-m11-open-nfc',
    source: 'MANUAL',
  });
  await postPair(client, {
    entityId: yfz,
    debitCode: '1120',
    creditCode: '3100',
    amount: 80_000_000_000,
    occurred,
    narration: 'Opening cash — YFZ operating',
    key: 'seed-m11-open-yfz',
    source: 'MANUAL',
  });
}

async function seedIntercompany(client: PoolClient, nfc: string, yfz: string): Promise<void> {
  const amount = 10_000_000_000;
  const occurred = '2026-03-15';
  await client.query(
    `INSERT INTO intercompany_transactions (
       id, reference_number, type, source_entity_id, destination_entity_id, amount_kobo, occurred_on,
       narration, source_bank_account_id, dest_bank_account_id, created_by, updated_by
     ) VALUES ($1, $2, 'funding_allocation', $3, $4, $5, $6, 'Seeded ₦100m NFC → YFZ', $7, $8, $9, $9)`,
    [NFC_YFZ_ICT_ID, 'TRF-2026-000901', nfc, yfz, amount, occurred, NFC_BANK_ACCOUNT_ID, YFZ_BANK_ACCOUNT_ID, EMEKA_ID],
  );
  const srcJournal = await postPair(client, {
    entityId: nfc,
    debitCode: '1210',
    creditCode: '1130',
    amount,
    occurred,
    narration: 'NFC to YFZ funding',
    key: 'seed-ict-src',
    source: 'FUNDING_TRANSFER',
    ictId: NFC_YFZ_ICT_ID,
  });
  const dstJournal = await postPair(client, {
    entityId: yfz,
    debitCode: '1120',
    creditCode: '2120',
    amount,
    occurred,
    narration: 'NFC to YFZ funding received',
    key: 'seed-ict-dst',
    source: 'FUNDING_TRANSFER',
    ictId: NFC_YFZ_ICT_ID,
  });
  await client.query(
    `UPDATE intercompany_transactions
        SET source_journal_id = $1, destination_journal_id = $2, updated_by = $3
      WHERE id = $4`,
    [srcJournal, dstJournal, EMEKA_ID, NFC_YFZ_ICT_ID],
  );
  await upsertSearchIndex(client, {
    recordType: 'INTERCOMPANY',
    recordId: NFC_YFZ_ICT_ID,
    referenceNumber: 'TRF-2026-000901',
    title: 'Seeded ₦100m NFC → YFZ',
    searchableText: 'TRF-2026-000901 NFC YFZ funding',
    entityId: nfc,
    permissionKey: 'finance.view',
  });
}

async function seedMismatch(client: PoolClient, nfc: string, yfz: string): Promise<void> {
  const amount = 2_000_000_000;
  const occurred = '2026-04-01';
  await client.query(
    `INSERT INTO intercompany_transactions (
       id, reference_number, type, source_entity_id, destination_entity_id, amount_kobo, occurred_on,
       narration, source_bank_account_id, dest_bank_account_id, created_by, updated_by
     ) VALUES ($1, $2, 'loan', $3, $4, $5, $6, 'Seeded mismatch after dest reversal', $7, $8, $9, $9)`,
    [NFC_YFZ_MISMATCH_ICT_ID, await nextRef(client, 'ICT'), nfc, yfz, amount, occurred, NFC_BANK_ACCOUNT_ID, YFZ_BANK_ACCOUNT_ID, EMEKA_ID],
  );
  const srcJournal = await postPair(client, {
    entityId: nfc,
    debitCode: '1210',
    creditCode: '1130',
    amount,
    occurred,
    narration: 'Mismatch source',
    key: 'seed-ict-mis-src',
    source: 'INTERCOMPANY',
    ictId: NFC_YFZ_MISMATCH_ICT_ID,
  });
  const dstJournal = await postPair(client, {
    entityId: yfz,
    debitCode: '1120',
    creditCode: '2120',
    amount,
    occurred,
    narration: 'Mismatch dest later reversed',
    key: 'seed-ict-mis-dst',
    source: 'INTERCOMPANY',
    ictId: NFC_YFZ_MISMATCH_ICT_ID,
  });
  await client.query(
    `UPDATE journals SET status = 'REVERSED', updated_by = $1 WHERE id = $2`,
    [EMEKA_ID, dstJournal],
  );
  await client.query(
    `UPDATE intercompany_transactions
        SET source_journal_id = $1, destination_journal_id = $2, updated_by = $3
      WHERE id = $4`,
    [srcJournal, dstJournal, EMEKA_ID, NFC_YFZ_MISMATCH_ICT_ID],
  );
}

async function backfillPaidProcurement(client: PoolClient, yfz: string, requestId: string): Promise<void> {
  const payment = await client.query<{
    id: string;
    amount_kobo: string;
    vendor_id: string | null;
    payment_date: Date;
    budget_line_id: string | null;
    paying_account_id: string;
  }>(
    `SELECT p.id, p.amount_kobo::text, p.vendor_id, p.payment_date, p.paying_account_id, v.budget_line_id
       FROM procurement_payments p
       JOIN procurement_versions v ON v.id = p.version_id
      WHERE p.request_id = $1 AND p.reversed_at IS NULL
      LIMIT 1`,
    [requestId],
  );
  const row = payment.rows[0];
  if (!row) return;
  const amount = Number(row.amount_kobo);
  const occurred = row.payment_date.toISOString().slice(0, 10);
  await postPair(client, {
    entityId: yfz,
    debitCode: '1300',
    creditCode: '1120',
    amount,
    occurred,
    narration: `Backfill payment ${requestId}`,
    key: `pay:${row.id}`,
    source: 'PROCUREMENT_PAYMENT',
    procurementRequestId: requestId,
    vendorId: row.vendor_id,
  });
  await client.query(
    `INSERT INTO bank_transactions (
       account_id, entity_id, kind, amount_kobo, occurred_on, narration, created_by
     ) VALUES ($1, $2, 'PAYMENT', $3, $4, $5, $6)`,
    [row.paying_account_id, yfz, -amount, occurred, `Backfill PAY ${requestId}`, YAHUZA_ID],
  );
  await client.query(
    `INSERT INTO budget_commitment_events (
       request_id, entity_id, budget_line_id, action, amount_kobo, created_by
     ) VALUES ($1, $2, $3, 'PAY', $4, $5)`,
    [requestId, yfz, row.budget_line_id, amount, YAHUZA_ID],
  );
}

async function postPair(
  client: PoolClient,
  input: {
    entityId: string;
    debitCode: string;
    creditCode: string;
    amount: number;
    occurred: string;
    narration: string;
    key: string;
    source: string;
    ictId?: string;
    procurementRequestId?: string;
    vendorId?: string | null;
  },
): Promise<string> {
  const period = await client.query<{ id: string }>(
    `SELECT id FROM fiscal_periods
      WHERE entity_id = $1 AND status = 'OPEN' AND $2::date BETWEEN starts_on AND ends_on`,
    [input.entityId, input.occurred],
  );
  const periodId = period.rows[0]?.id;
  if (!periodId) throw new Error(`No open period for ${input.occurred}`);
  const debit = await account(client, input.entityId, input.debitCode);
  const credit = await account(client, input.entityId, input.creditCode);
  const ref = await nextRef(client, 'JNL');
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO journals (
       reference_number, entity_id, fiscal_period_id, narration, idempotency_key, source,
       created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     RETURNING id`,
    [ref, input.entityId, periodId, input.narration, input.key, input.source, EMEKA_ID],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error('Seed journal was not created.');
  await client.query(
    `INSERT INTO journal_lines (
       journal_id, entity_id, account_id, line_number, debit_kobo, credit_kobo, narration,
       intercompany_transaction_id, procurement_request_id, vendor_id, created_by, updated_by
     ) VALUES
       ($1, $2, $3, 1, $4, 0, $5, $6, $7, $8, $9, $9),
       ($1, $2, $10, 2, 0, $4, $5, $6, $7, $8, $9, $9)`,
    [
      id,
      input.entityId,
      debit,
      input.amount,
      input.narration,
      input.ictId ?? null,
      input.procurementRequestId ?? null,
      input.vendorId ?? null,
      EMEKA_ID,
      credit,
    ],
  );
  await client.query(
    `UPDATE journals SET status = 'POSTED', posted_at = now(), posted_by = $1, updated_by = $1 WHERE id = $2`,
    [EMEKA_ID, id],
  );
  return id;
}

async function account(client: PoolClient, entityId: string, code: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM accounts WHERE entity_id = $1 AND code = $2`,
    [entityId, code],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`Missing account ${code}`);
  return id;
}

async function nextRef(client: PoolClient, kind: string): Promise<string> {
  const result = await client.query<{ ref: string }>(`SELECT app.next_reference($1) AS ref`, [kind]);
  const ref = result.rows[0]?.ref;
  if (!ref) throw new Error(`Could not allocate ${kind}`);
  return ref;
}
