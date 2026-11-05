import { PR_2026_000184, PR_2026_000184_SUBJECT_ID } from '@nfc/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { captureError, ownerPool } from './support';

describe('M4 seals and workflow tables', () => {
  let owner: Pool;

  beforeAll(async () => {
    owner = ownerPool('nfc-erp-test-seal-owner');
  });

  afterAll(async () => {
    await owner.end();
  });

  it('refuses UPDATE and DELETE on seals', async () => {
    const error = await captureError(() => owner.query("UPDATE seals SET action = 'approved'"));
    expect(error.message).toMatch(/append-only/);
  });

  it('refuses UPDATE and DELETE on workflow_actions', async () => {
    const error = await captureError(() => owner.query('DELETE FROM workflow_actions'));
    expect(error.message).toMatch(/append-only/);
  });

  it('seeds the milling-machine subject as PR-2026-000184', async () => {
    const row = await owner.query<{ reference_number: string; title: string }>(
      'SELECT reference_number, title FROM workflow_demo_subjects WHERE id = $1',
      [PR_2026_000184_SUBJECT_ID],
    );
    expect(row.rows[0]?.reference_number).toBe(PR_2026_000184);
    expect(row.rows[0]?.title).toMatch(/Milling machine/);

    const stages = await owner.query<{ key: string }>(
      `SELECT s.key FROM workflow_stages s
         JOIN workflow_definitions d ON d.id = s.definition_id
        WHERE d.key = 'procurement-v1'
        ORDER BY s.sort_order`,
    );
    expect(stages.rows.map((row) => row.key)).toEqual([
      'gm-submission',
      'need-approval',
      'prepared',
      'ed-operations',
      'md',
      'ed-finance',
      'finance-head',
    ]);
  });
});
