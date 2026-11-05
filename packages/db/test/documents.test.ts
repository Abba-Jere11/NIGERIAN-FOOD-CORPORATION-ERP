import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { appPool, captureError, entityIdFor, inCommittedTransaction, ownerPool, userActor } from './support';

describe('M4 documents schema', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;

  beforeAll(async () => {
    owner = ownerPool('nfc-erp-test-doc-owner');
    app = appPool('nfc-erp-test-doc-app');
    yfz = await entityIdFor(owner, 'YFZ');
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  it('refuses UPDATE and DELETE on document_versions', async () => {
    const actor = userActor({
      isCorporate: true,
      permissions: ['document.upload', 'document.view'],
      entityIds: [yfz],
    });
    const versionId = await inCommittedTransaction(app, actor, async (client) => {
      const doc = await client.query<{ id: string }>(
        `INSERT INTO documents (reference_number, owner_type, entity_id, category, title, created_by, updated_by)
         VALUES ($1, 'standalone', $2, 'general', 'Trigger fixture', $3, $3)
         RETURNING id`,
        [`DOC-TEST-${Date.now()}`, yfz, actor.ref],
      );
      const version = await client.query<{ id: string }>(
        `INSERT INTO document_versions (
           document_id, entity_id, version_number, storage_key, sha256, size_bytes, mime_type,
           original_filename, wrapped_key, iv, auth_tag, uploaded_by, created_by
         ) VALUES ($1, $2, 1, 'k', $3, 12, 'application/pdf', 'a.pdf', 'wrap', $4, $4, $5, $5)
         RETURNING id`,
        [doc.rows[0]?.id, yfz, 'a'.repeat(64), Buffer.from('iv'), actor.ref],
      );
      return version.rows[0]?.id ?? '';
    });

    const update = await captureError(() =>
      owner.query('UPDATE document_versions SET mime_type = $1 WHERE id = $2', ['image/png', versionId]),
    );
    expect(update.message).toMatch(/append-only/);

    const deletion = await captureError(() =>
      owner.query('DELETE FROM document_versions WHERE id = $1', [versionId]),
    );
    expect(deletion.message).toMatch(/append-only/);
  });

  it('requires a replacement reason on version 2', async () => {
    const actor = userActor({
      isCorporate: true,
      permissions: ['document.upload'],
      entityIds: [yfz],
    });
    const error = await captureError(() =>
      inCommittedTransaction(app, actor, async (client) => {
        const doc = await client.query<{ id: string }>(
          `INSERT INTO documents (reference_number, owner_type, entity_id, category, title, created_by, updated_by)
           VALUES ($1, 'standalone', $2, 'general', 'Reason fixture', $3, $3)
           RETURNING id`,
          [`DOC-REASON-${Date.now()}`, yfz, actor.ref],
        );
        await client.query(
          `INSERT INTO document_versions (
             document_id, entity_id, version_number, storage_key, sha256, size_bytes, mime_type,
             original_filename, wrapped_key, iv, auth_tag, uploaded_by, created_by
           ) VALUES ($1, $2, 2, 'k2', $3, 12, 'application/pdf', 'b.pdf', 'wrap', $4, $4, $5, $5)`,
          [doc.rows[0]?.id, yfz, 'b'.repeat(64), Buffer.from('iv'), actor.ref],
        );
      }),
    );
    expect(error.message).toMatch(/document_versions_reason_required|violates check constraint/);
  });
});
