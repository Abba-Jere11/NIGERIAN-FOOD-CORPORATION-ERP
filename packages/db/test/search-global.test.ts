import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { applyActorSession } from '../src/session';
import { searchIndex } from '../src/search';
import { appPool, entityIdFor, ownerPool, userActor } from './support';

describe('global search (M19)', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;

  beforeAll(async () => {
    owner = ownerPool('nfc-erp-test-search-global-owner');
    app = appPool('nfc-erp-test-search-global-app');
    yfz = await entityIdFor(owner, 'YFZ');
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  it('finds seeded procurement reference for MD and respects entity scope for GM', async () => {
    const demo = await owner.query<{ reference_number: string }>(
      `SELECT reference_number FROM procurement_requests WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [yfz],
    );
    const ref = demo.rows[0]?.reference_number;
    if (!ref) return;

    const mdClient = await app.connect();
    const gmClient = await app.connect();
    try {
      await mdClient.query('BEGIN');
      await applyActorSession(
        mdClient,
        userActor({
          isCorporate: true,
          permissions: ['procurement.view', 'organization.view'],
          entityIds: [yfz],
        }),
      );
      const mdHits = await searchIndex(mdClient, ref, 10);
      await mdClient.query('ROLLBACK');

      await gmClient.query('BEGIN');
      await applyActorSession(
        gmClient,
        userActor({
          isCorporate: false,
          permissions: ['procurement.view', 'requisition.create'],
          entityIds: [yfz],
        }),
      );
      const gmHits = await searchIndex(gmClient, ref, 10);
      await gmClient.query('ROLLBACK');

      expect(mdHits.some((hit) => hit.referenceNumber === ref)).toBe(true);
      expect(gmHits.some((hit) => hit.referenceNumber === ref)).toBe(true);
      expect(gmHits.every((hit) => hit.entityId === yfz)).toBe(true);
    } finally {
      mdClient.release();
      gmClient.release();
    }
  });
});
