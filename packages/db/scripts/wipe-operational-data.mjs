/**
 * Development wipe: clear procurement/finance/inventory transactional rows,
 * the inventory catalogue (items/categories), and official reports (M16)
 * while keeping org, users, vendors, COA, fiscal calendar, budgets,
 * warehouses, and org_report_templates.
 *
 * Budget lines are reset to ₦500,000,000 (50_000_000_000 kobo) each.
 * Uses session_replication_role=replica to bypass R3 forbid-delete triggers
 * (postgres owner only). Never run against production.
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
config({ path: resolve(root, '.env') });

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to wipe while NODE_ENV=production');
  process.exit(1);
}

const BUDGET_KOBO = '50000000000'; // ₦500,000,000.00

const host = process.env.PGHOST ?? 'localhost';
const port = process.env.PGPORT ?? '5432';
const user = process.env.PGUSER ?? 'postgres';
const dbPassword = process.env.PGPASSWORD ?? '';
const database = process.env.PGDATABASE ?? 'nfc_erp_dev';
const override = process.env.DATABASE_URL_OWNER?.trim();
const connectionString =
  override ||
  `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(dbPassword)}@${host}:${port}/${database}`;

/** Leaf → root so FKs do not block (triggers disabled). */
const TABLES = [
  'receipt_allocations',
  'bank_reconciliation_matches',
  'budget_commitment_events',
  'procurement_payment_reversals',
  'procurement_receipt_documents',
  'procurement_close_short_requests',
  'procurement_shortage_deadlines',
  'procurement_recoveries',
  'procurement_invoice_variances',
  'procurement_deliveries',
  'procurement_quotations',
  'vendor_open_claims',
  'vendor_invoice_claims',
  'procurement_goods_receipts',
  'procurement_delivery_notes',
  'procurement_payments',
  'funding_transfer_records',
  'procurement_financial_reviews',
  'entity_bank_balance_events',
  'bank_statement_lines',
  'bank_statements',
  'bank_transactions',
  'bank_transfers',
  'journal_lines',
  'receipts',
  'receivable_invoices',
  'payable_invoices',
  'income_entries',
  'expense_entries',
  'intercompany_transactions',
  'budget_version_lines',
  'procurement_commitment_events',
  'procurement_comments',
  'procurement_invoices',
  'procurement_memo_snapshots',
  'procurement_version_lines',
  'procurement_versions',
  'journals',
  'procurement_requests',
  // Dual-approval requisitions (after procurement_requests clears requisition_id FKs)
  'requisition_memo_snapshots',
  'requisition_lines',
  'requisition_versions',
  'requisitions',
  // Inventory transactional + catalogue (keep warehouses, posting rules, UoM)
  'sales_return_lines',
  'sales_returns',
  'sales_dispatch_lines',
  'sales_dispatches',
  'stock_reservations',
  'sales_order_lines',
  'sales_orders',
  'production_batch_links',
  'production_order_outputs',
  'production_order_inputs',
  'production_orders',
  'stock_count_lines',
  'stock_counts',
  'stock_adjustment_lines',
  'stock_adjustments',
  'stock_transfer_lines',
  'stock_transfers',
  'stock_issue_lines',
  'stock_issues',
  'stock_movements',
  'stock_serials',
  'stock_batches',
  'expected_stock',
  'inventory_item_vendors',
  'inventory_items',
  'inventory_categories',
  'workflow_reminders',
  'workflow_actions',
  'workflow_holds',
  'demo_commitment_events',
  'workflow_demo_subject_versions',
  'workflow_demo_subjects',
  'workflow_instances',
  'notification_deliveries',
  'notifications',
  'event_deliveries',
  'domain_events',
  'mail_outbox',
  // Official reports (keep org_report_templates)
  'org_external_correspondence',
  'org_decisions',
  'org_minute_responses',
  'org_minute_recipients',
  'org_minutes',
  'org_report_access',
  'org_report_recipients',
  'org_report_forwards',
  'org_report_revisions',
  'org_reports',
  'document_access_log',
  'document_versions',
  'documents',
  'seals',
  'search_index',
  'timeline_events',
  'report_runs',
  'engine_records',
  'login_attempts',
  'audit_log',
];

async function main() {
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 120_000,
  });
  console.log(`Connecting to ${database} as ${user}…`);
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL session_replication_role = replica`);

    // Break FK pointers that would keep workflow / revision rows alive after wipe.
    await client.query(`UPDATE budgets SET workflow_instance_id = NULL`);
    await client.query(`
      DO $$
      BEGIN
        IF to_regclass('public.org_reports') IS NOT NULL THEN
          UPDATE org_reports SET current_revision_id = NULL;
        END IF;
        IF to_regclass('public.org_minutes') IS NOT NULL THEN
          UPDATE org_minutes SET issued_revision_id = NULL;
        END IF;
        IF to_regclass('public.org_report_forwards') IS NOT NULL THEN
          UPDATE org_report_forwards SET document_revision_id = NULL;
        END IF;
        IF to_regclass('public.org_external_correspondence') IS NOT NULL THEN
          UPDATE org_external_correspondence SET document_revision_id = NULL;
        END IF;
      END $$;
    `);

    const deleted = {};
    for (const table of TABLES) {
      const exists = await client.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${table}`]);
      if (!exists.rows[0]?.ok) {
        deleted[table] = 'missing';
        continue;
      }
      const result = await client.query(`DELETE FROM ${table}`);
      deleted[table] = result.rowCount ?? 0;
    }

    await client.query(
      `
      UPDATE budget_lines
         SET approved_amount_kobo = $1::bigint,
             updated_by = 'system:wipe',
             updated_at = now()
       WHERE fiscal_year = 2026
    `,
      [BUDGET_KOBO],
    );

    await client.query(`
      UPDATE budgets b
         SET status = CASE WHEN e.type = 'HOLDING' THEN 'DRAFT' ELSE 'APPROVED' END,
             workflow_instance_id = NULL,
             updated_by = 'system:wipe',
             updated_at = now()
        FROM entities e
       WHERE e.id = b.entity_id
    `);

    await client.query(`
      UPDATE entity_bank_accounts ba
         SET recorded_balance_kobo = CASE WHEN e.code = 'NFC' THEN 500000000000 ELSE 100000000000 END,
             balance_as_of = CURRENT_DATE,
             updated_by = 'system:wipe',
             updated_at = now()
        FROM entities e
       WHERE e.id = ba.entity_id
    `);

    await client.query(`
      UPDATE reference_counters
         SET last_value = 0
       WHERE kind IN (
         'PR','REQ','JNL','BUD','INC','EXP','PAY','RCV','RCP','IC','PMT','FND','DOC','GRN','DN',
         'INV','SO','PRD','TRF','ICT','ISS','ADJ','MOV','ITM',
         'ORG','MIN','RSP','DEC'
       )
    `);

    // Restore inventory categories wiped above so ED Finance expected-stock can create items.
    await client.query(`
      INSERT INTO inventory_categories (entity_id, key, name, created_by, updated_by)
      SELECT e.id, c.key, c.name, 'system:wipe', 'system:wipe'
        FROM entities e
        JOIN (VALUES
          ('YFZ', 'raw_materials', 'Raw Materials'),
          ('YFZ', 'finished_goods', 'Finished Goods'),
          ('YFZ', 'spare_parts', 'Spare Parts'),
          ('YFZ', 'packaging', 'Packaging'),
          ('YFZ', 'equipment', 'Equipment'),
          ('YFZ', 'consumables', 'Consumables'),
          ('YFW', 'wheat', 'Wheat'),
          ('YFW', 'flour', 'Flour'),
          ('YFW', 'bran', 'Bran'),
          ('YFW', 'packaging', 'Packaging'),
          ('YFW', 'spare_parts', 'Spare Parts'),
          ('YFW', 'equipment', 'Equipment'),
          ('YFW', 'consumables', 'Consumables'),
          ('DMA', 'livestock', 'Livestock'),
          ('DMA', 'meat', 'Meat'),
          ('DMA', 'cold_room', 'Cold-room'),
          ('DMA', 'spare_parts', 'Spare Parts'),
          ('DMA', 'equipment', 'Equipment'),
          ('DMA', 'consumables', 'Consumables'),
          ('NOM', 'seeds', 'Seeds'),
          ('NOM', 'oil', 'Oil'),
          ('NOM', 'by_products', 'By-products'),
          ('NOM', 'packaging', 'Packaging'),
          ('NOM', 'spare_parts', 'Spare Parts'),
          ('NOM', 'equipment', 'Equipment'),
          ('NOM', 'consumables', 'Consumables')
        ) AS c(code, key, name) ON c.code = e.code
      ON CONFLICT (entity_id, key) DO NOTHING
    `);

    await client.query('COMMIT');

    const summary = await client.query(`
      SELECT e.code,
             count(bl.id)::int AS lines,
             coalesce(sum(bl.approved_amount_kobo), 0)::text AS approved_kobo
        FROM entities e
        LEFT JOIN budget_lines bl ON bl.entity_id = e.id AND bl.fiscal_year = 2026
       WHERE e.type = 'SUBSIDIARY'
       GROUP BY e.code
       ORDER BY e.code
    `);
    const leftover = await client.query(`
      SELECT 'procurement_requests' AS t, count(*)::int AS n FROM procurement_requests
      UNION ALL SELECT 'journals', count(*)::int FROM journals
      UNION ALL SELECT 'payable_invoices', count(*)::int FROM payable_invoices
      UNION ALL SELECT 'receivable_invoices', count(*)::int FROM receivable_invoices
      UNION ALL SELECT 'documents', count(*)::int FROM documents
      UNION ALL SELECT 'workflow_instances', count(*)::int FROM workflow_instances
      UNION ALL SELECT 'procurement_memo_snapshots', count(*)::int FROM procurement_memo_snapshots
      UNION ALL SELECT 'requisitions', count(*)::int FROM requisitions
      UNION ALL SELECT 'stock_movements', count(*)::int FROM stock_movements
      UNION ALL SELECT 'expected_stock', count(*)::int FROM expected_stock
      UNION ALL SELECT 'inventory_items', count(*)::int FROM inventory_items
      UNION ALL SELECT 'inventory_categories', count(*)::int FROM inventory_categories
      UNION ALL SELECT 'report_runs', count(*)::int FROM report_runs
      UNION ALL SELECT 'org_reports', count(*)::int FROM org_reports
      UNION ALL SELECT 'org_minutes', count(*)::int FROM org_minutes
      UNION ALL SELECT 'org_report_templates', count(*)::int FROM org_report_templates
    `);

    console.log(JSON.stringify({ ok: true, deleted, budgets: summary.rows, leftover: leftover.rows }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
