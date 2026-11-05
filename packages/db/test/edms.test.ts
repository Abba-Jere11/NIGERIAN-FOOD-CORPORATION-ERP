/**
 * M15 Document Portal: auto-file, isolation, share, hold, refile, backfill.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  DEFAULT_ROLE_GRANTS,
  SEED_USERS,
  XYZ_VENDOR_ID,
  type PermissionKey,
} from '@nfc/shared';
import { systemActorContext, type ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { DocumentsService } from '../../../apps/api/src/documents/documents.service';
import { FileStorageDriver } from '../../../apps/api/src/documents/file-storage';
import { NoopMalwareScanner } from '../../../apps/api/src/documents/malware';
import { EdmsService } from '../../../apps/api/src/edms/edms.service';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import {
  ForbiddenError,
  ReasonRequiredError,
  ConflictError,
} from '../../../apps/api/src/common/errors/domain-error';
import { appPool, entityIdFor, ownerPool } from './support';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function ensureApiEnv(): void {
  process.env.SESSION_SECRET ??= 'test-session-secret-not-for-production-use-32';
  process.env.MFA_ENCRYPTION_KEY ??=
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.DOCUMENT_ENCRYPTION_KEY ??=
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.SEAL_SIGNING_KEYS ??= JSON.stringify({
    v1: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  });
  process.env.SEAL_ACTIVE_KID ??= 'v1';
  process.env.DOCUMENT_STORAGE ??= 'fs';
  resetApiEnvCache();
}

function actorFromSeed(email: string, entityIds: string[], extra: PermissionKey[] = []): ActorContext {
  const user = SEED_USERS.find((row) => row.email === email);
  if (!user) throw new Error(`Unknown seed user ${email}`);
  return {
    ref: user.id,
    name: user.name,
    role: user.role,
    scopeType: user.scopeType,
    entityIds,
    isCorporate: user.scopeType === 'CORPORATE' && user.role !== 'administrator',
    isAdmin: user.role === 'administrator',
    permissions: [...DEFAULT_ROLE_GRANTS[user.role], ...extra],
    homePath: '/',
  };
}

describe('M15 EDMS document portal', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let dma: string;
  let nfc: string;
  let edms: EdmsService;
  let documents: DocumentsService;
  let uow: UnitOfWork;
  let md: ActorContext;
  let musa: ActorContext;
  let admin: ActorContext;
  let filer: ActorContext;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-m15-owner');
    app = appPool('nfc-erp-test-m15-app');
    yfz = await entityIdFor(owner, 'YFZ');
    dma = await entityIdFor(owner, 'DMA');
    nfc = await entityIdFor(owner, 'NFC');
    uow = new UnitOfWork(app);
    documents = new DocumentsService(uow, new FileStorageDriver(), new NoopMalwareScanner());
    edms = new EdmsService(uow, documents);
    md = actorFromSeed('md@nfc.local', [yfz, dma, nfc]);
    musa = actorFromSeed('gm.yfz@nfc.local', [yfz]);
    admin = actorFromSeed('administrator@nfc.local', [nfc, yfz]);
    filer = systemActorContext('system:edms', 'EDMS archive');
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  async function insertCompleted(title: string): Promise<string> {
    const id = randomUUID();
    const musaId = SEED_USERS.find((user) => user.email === 'gm.yfz@nfc.local')!.id;
    const category = await owner.query<{ id: string }>(
      `SELECT id FROM procurement_categories WHERE key = 'services'`,
    );
    const unit = await owner.query<{ id: string }>(`SELECT id FROM units_of_measure WHERE code = 'PCS'`);
    await owner.query(
      `INSERT INTO procurement_requests (
         id, reference_number, entity_id, originator_user_id, vendor_id, current_version, status,
         accepted_quantity_total, created_by, updated_by
       ) VALUES ($1, $2, $3, $4::uuid, $5, 1, 'COMPLETED', 1, 'system:seed', 'system:seed')`,
      [id, `PR-2026-${randomUUID().slice(0, 8).toUpperCase()}`, yfz, musaId, XYZ_VENDOR_ID],
    );
    await owner.query(
      `INSERT INTO procurement_versions (
         request_id, entity_id, version_number, title, subject, category_id, reason, description,
         quantity, unit_id, unit_price_kobo, total_amount_kobo, urgency, created_by, updated_by
       ) VALUES ($1, $2, 1, $3, $3, $4, 'Archive test', 'Line', 1, $5, 1000, 1000, 'NORMAL', 'system:seed', 'system:seed')`,
      [id, yfz, title, category.rows[0]?.id, unit.rows[0]?.id],
    );
    return id;
  }

  it('files a completed YFZ request into Active/Procurement/year/subject with generated slots', async () => {
    const title = `EDMS mill bag ${randomUUID().slice(0, 6)}`;
    const requestId = await insertCompleted(title);
    const folderId = await uow.write(filer, async (tx) => edms.fileProcurementInTx(tx, filer, requestId));
    expect(folderId).toBeTruthy();
    const trail = await owner.query<{ name: string }>(
      `WITH RECURSIVE trail AS (
         SELECT id, parent_id, name, 1 AS depth FROM edms_folders WHERE id = $1
         UNION ALL
         SELECT f.id, f.parent_id, f.name, trail.depth + 1
           FROM edms_folders f JOIN trail ON trail.parent_id = f.id
       )
       SELECT name FROM trail ORDER BY depth DESC`,
      [folderId],
    );
    const names = trail.rows.map((row) => row.name);
    expect(names).toEqual(expect.arrayContaining(['Active', 'Procurement', title]));
    expect(names.some((name) => /^\d{4}$/.test(name))).toBe(true);

    const slots = await owner.query<{ name: string; n: string }>(
      `SELECT f.name, count(i.id)::text AS n
         FROM edms_folders f
         LEFT JOIN edms_folder_items i ON i.folder_id = f.id
        WHERE f.parent_id = $1
        GROUP BY f.name
        ORDER BY f.name`,
      [folderId],
    );
    const byName = Object.fromEntries(slots.rows.map((row) => [row.name, Number(row.n)]));
    expect(byName['03 Approval Documents']).toBe(1);
    expect(byName['08 Completion Record']).toBe(1);
    expect(byName['09 Audit Record']).toBe(1);
    expect(byName['01 Memo'] ?? 0).toBe(0);

    const timeline = await owner.query<{ event_text: string; actor_ref: string }>(
      `SELECT event_text, actor_ref FROM timeline_events
        WHERE subject_id = $1 AND event_text = 'EDMS archive generated.'`,
      [requestId],
    );
    expect(timeline.rows[0]?.actor_ref).toBe('system:edms');

    const again = await uow.write(filer, async (tx) => edms.fileProcurementInTx(tx, filer, requestId));
    expect(again).toBe(folderId);
    const count = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM edms_folders WHERE source_type = 'PROCUREMENT' AND source_id = $1`,
      [requestId],
    );
    expect(Number(count.rows[0]?.n)).toBe(1);
  });

  it('backfills twice as a no-op after the first package exists', async () => {
    const first = await edms.backfillCompleted(filer);
    const second = await edms.backfillCompleted(filer);
    expect(second.filed).toBe(0);
    expect(first.filed).toBeGreaterThanOrEqual(0);
  });

  it('refuses GM portal access, DMA tree and Administrator document bodies', async () => {
    await expect(edms.gateway(musa)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(edms.tree(musa, dma)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(edms.search(musa, 'mill', { entityId: dma })).rejects.toBeInstanceOf(ForbiddenError);

    const requestId = await insertCompleted(`Admin deny ${randomUUID().slice(0, 6)}`);
    const folderId = await uow.write(filer, async (tx) => edms.fileProcurementInTx(tx, filer, requestId));
    const item = await owner.query<{ document_id: string }>(
      `SELECT i.document_id FROM edms_folder_items i
         JOIN edms_folders f ON f.id = i.folder_id
        WHERE f.parent_id = $1 LIMIT 1`,
      [folderId],
    );
    await expect(edms.getDocument(admin, item.rows[0]!.document_id)).rejects.toBeInstanceOf(ForbiddenError);
    const view = await edms.getDocument(md, item.rows[0]!.document_id);
    expect(view.related.procurementId).toBe(requestId);
  });

  it('replaces to v2 with a reason, shares with an audit row, and blocks archive on legal hold', async () => {
    const categories = await edms.listCategories(md);
    const category = categories.find((row) => row.key === 'administrative');
    const tree = await edms.tree(md, yfz);
    const adminFolder = tree.active?.children.find((row) => row.name === 'Administrative');
    expect(category && adminFolder).toBeTruthy();
    const uploaded = await edms.upload(md, {
      title: `Hold ${randomUUID().slice(0, 6)}`,
      entityId: yfz,
      folderId: adminFolder!.id,
      categoryId: category!.id,
      tags: [],
      file: { buffer: PNG, originalname: 'note.png' },
    });
    const replaced = await edms.replace(md, uploaded.id, {
      reason: 'Corrected scan of the covering note.',
      file: { buffer: PNG, originalname: 'note-v2.png' },
    });
    expect(replaced.currentVersion.versionNumber).toBe(2);
    expect(replaced.currentVersion.replacementReason).toContain('Corrected scan');

    const shared = await edms.share(md, uploaded.id, { granteeRole: 'gm' });
    expect(shared.shares.some((row) => row.granteeRole === 'gm' && !row.revokedAt)).toBe(true);
    const shareAudit = await owner.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE subject_id = $1 AND action = 'document_share'`,
      [uploaded.id],
    );
    expect(shareAudit.rows.length).toBeGreaterThan(0);

    await edms.placeHold(admin, uploaded.id, 'Litigation hold for the mill bag claim.');
    await expect(edms.archive(md, uploaded.id, 'Ready to archive.')).rejects.toBeInstanceOf(ConflictError);
  });

  it('requires a reason to re-file', async () => {
    const categories = await edms.listCategories(md);
    const category = categories.find((row) => row.key === 'administrative')!;
    const tree = await edms.tree(md, yfz);
    const adminFolder = tree.active?.children.find((row) => row.name === 'Administrative')!;
    const uploaded = await edms.upload(md, {
      title: `Refile ${randomUUID().slice(0, 6)}`,
      entityId: yfz,
      folderId: adminFolder.id,
      categoryId: category.id,
      tags: [],
      file: { buffer: PNG, originalname: 'refile.png' },
    });
    await expect(
      edms.refile(md, uploaded.id, { destEntityId: dma, reason: '   ' }),
    ).rejects.toBeInstanceOf(ReasonRequiredError);
  });
});
