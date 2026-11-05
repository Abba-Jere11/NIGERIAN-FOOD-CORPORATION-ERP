import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { captureError, ownerPool } from './support';

const APPEND_ONLY_TABLES = [
  'seals',
  'workflow_actions',
  'procurement_memo_snapshots',
  'document_versions',
  'journal_lines',
  'budget_commitment_events',
] as const;

describe('append-only inventory (M19)', () => {
  let owner: Pool;

  beforeAll(() => {
    owner = ownerPool('nfc-erp-test-append-inv');
  });

  afterAll(async () => {
    await owner.end();
  });

  it.each(APPEND_ONLY_TABLES)('%s rejects UPDATE', async (table) => {
    const row = await owner.query(`SELECT * FROM ${table} LIMIT 1`);
    if (!row.rows[0]) return;
    const idCol = row.fields.find((field) => field.name === 'id') ? 'id' : Object.keys(row.rows[0])[0];
    const id = row.rows[0][idCol as keyof (typeof row.rows)[0]];
    const error = await captureError(() =>
      owner.query(`UPDATE ${table} SET created_by = created_by WHERE ${idCol} = $1`, [id]),
    );
    expect(error.message.toLowerCase()).toMatch(/append-only|forbidden|not allowed|update|cannot be edited/);
  });
});
