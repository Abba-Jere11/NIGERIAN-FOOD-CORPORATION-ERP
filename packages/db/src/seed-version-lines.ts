import type { PoolClient } from 'pg';

export async function seedVersionLinesFromHeader(client: PoolClient, requestId: string): Promise<void> {
  // Seed fixtures insert already-submitted versions. The live trigger forbids
  // that path; disable it only for this replay of historical rows.
  await client.query(
    'ALTER TABLE procurement_version_lines DISABLE TRIGGER procurement_version_lines_forbid_submitted',
  );
  try {
    await client.query(
    `INSERT INTO procurement_version_lines (
       version_id, entity_id, line_number, description, category_id, quantity, unit_id,
       unit_price_kobo, line_amount_kobo, budget_line_id, created_by, updated_by
     )
     SELECT v.id, v.entity_id, 1, coalesce(nullif(btrim(v.description), ''), v.title),
            v.category_id, v.quantity, v.unit_id, v.unit_price_kobo, v.total_amount_kobo,
            v.budget_line_id, v.created_by, v.updated_by
       FROM procurement_versions v
      WHERE v.request_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM procurement_version_lines l WHERE l.version_id = v.id
        )`,
      [requestId],
    );
  } finally {
    await client.query(
      'ALTER TABLE procurement_version_lines ENABLE TRIGGER procurement_version_lines_forbid_submitted',
    );
  }
}
