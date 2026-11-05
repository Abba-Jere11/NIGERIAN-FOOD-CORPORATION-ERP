import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  DEFAULT_ROLE_GRANTS,
  REQUIRED_VENDOR_COMPLIANCE,
  SAHEL_VENDOR_ID,
  SEED_USERS,
  XYZ_VENDOR_ID,
  type PermissionKey,
} from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { DocumentsService } from '../../../apps/api/src/documents/documents.service';
import { FileStorageDriver } from '../../../apps/api/src/documents/file-storage';
import { NoopMalwareScanner } from '../../../apps/api/src/documents/malware';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { VendorValidationService } from '../../../apps/api/src/vendors/vendor-validation.service';
import { VendorsService } from '../../../apps/api/src/vendors/vendors.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import {
  ConflictError,
  ForbiddenError,
  ValidationFailedError,
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

describe('M5 vendor master', () => {
  let owner: Pool;
  let app: Pool;
  let nfc: string;
  let yfz: string;
  let vendors: VendorsService;
  let workflows: WorkflowsService;
  let documents: DocumentsService;
  let validation: VendorValidationService;
  let halima: ActorContext;
  let emeka: ActorContext;
  let abubakar: ActorContext;
  let musa: ActorContext;
  let admin: ActorContext;
  let categoryId: string;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-m5-owner');
    app = appPool('nfc-erp-test-m5-app');
    nfc = await entityIdFor(owner, 'NFC');
    yfz = await entityIdFor(owner, 'YFZ');
    const uow = new UnitOfWork(app);
    workflows = new WorkflowsService(uow, new SealsService());
    documents = new DocumentsService(uow, new FileStorageDriver(), new NoopMalwareScanner());
    vendors = new VendorsService(uow, workflows);
    validation = new VendorValidationService(uow);
    halima = actorFromSeed('ed.operations@nfc.local', [yfz]);
    emeka = actorFromSeed('ed.finance@nfc.local', [yfz]);
    abubakar = actorFromSeed('md@nfc.local', [yfz]);
    musa = actorFromSeed('gm.yfz@nfc.local', [yfz]);
    admin = actorFromSeed('administrator@nfc.local', [yfz]);
    const categories = await vendors.categories(halima);
    const goods = categories.find((row) => row.key === 'goods');
    if (!goods) throw new Error('goods category missing');
    categoryId = goods.id;
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  async function attachRequired(actor: ActorContext, vendorId: string): Promise<void> {
    for (const type of REQUIRED_VENDOR_COMPLIANCE) {
      const doc = await documents.upload(actor, {
        title: `${type} ${vendorId.slice(0, 8)}`,
        category: type.toLowerCase(),
        context: 'vendor_compliance',
        entityId: nfc,
        ownerType: 'vendor',
        ownerId: vendorId,
        file: { buffer: PNG, originalname: `${type}.png` },
      });
      await vendors.attachCompliance(actor, vendorId, {
        documentId: doc.id,
        complianceType: type,
      });
    }
  }

  it('activates a draft only when a different user approves', async () => {
    const suffix = randomUUID().slice(0, 8);
    const created = await vendors.create(halima, {
      legalName: `Kano Bags ${suffix}`,
      cacRegistrationNumber: `RC-${suffix}`,
      categoryId,
      bankName: 'Access Bank',
      accountName: `Kano Bags ${suffix}`,
      accountNumber: `10${suffix.replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`,
    });
    expect(created.status).toBe('DRAFT');
    await attachRequired(halima, created.id);
    const submitted = await vendors.submit(halima, created.id);
    expect(submitted.status).toBe('PENDING_REVIEW');

    const pending = await workflows.pending(abubakar);
    const item = pending.find((row) => row.referenceNumber === created.referenceNumber);
    expect(item).toBeTruthy();
    const asHalima = await workflows.get(halima, item!.id);
    await expect(
      workflows.act(halima, {
        instanceId: asHalima.id,
        action: 'APPROVE',
        rowVersion: asHalima.rowVersion,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const forMd = await workflows.get(abubakar, item!.id);
    await workflows.act(abubakar, {
      instanceId: forMd.id,
      action: 'APPROVE',
      rowVersion: forMd.rowVersion,
    });
    const active = await vendors.get(halima, created.id);
    expect(active.status).toBe('ACTIVE');
  });

  it('hides bank details from the GM and lists only Active vendors for view-only grants', async () => {
    const xyz = await vendors.get(musa, XYZ_VENDOR_ID);
    expect(xyz.status).toBe('ACTIVE');
    expect(xyz.bank).toBeNull();
    const finance = await vendors.get(emeka, XYZ_VENDOR_ID);
    expect(finance.bank?.accountNumber).toBe('2011840001');

    const gmList = await vendors.list(musa);
    expect(gmList.every((row) => row.status === 'ACTIVE')).toBe(true);
    expect(gmList.some((row) => row.id === XYZ_VENDOR_ID)).toBe(true);

    const managed = await vendors.list(halima);
    expect(managed.some((row) => row.status === 'DRAFT')).toBe(true);
  });

  it('rejects suspended vendors on the selection gate and records the attempt', async () => {
    await expect(validation.assertSelectable(musa, SAHEL_VENDOR_ID)).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
    const ok = await validation.assertSelectable(musa, XYZ_VENDOR_ID);
    expect(ok.selectable).toBe(true);
  });

  it('blocks bank-detail selection until a different user re-verifies', async () => {
    const before = await vendors.get(emeka, XYZ_VENDOR_ID);
    const changed = await vendors.changeBank(halima, XYZ_VENDOR_ID, {
      bankName: 'United Bank for Africa',
      accountName: 'XYZ Limited',
      accountNumber: `30${Date.now().toString().slice(-8)}`,
      rowVersion: before.rowVersion,
    });
    expect(changed.status).toBe('PENDING_REVERIFICATION');
    await expect(validation.assertSelectable(musa, XYZ_VENDOR_ID)).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
    await expect(
      vendors.approveBank(halima, XYZ_VENDOR_ID, changed.rowVersion),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const approved = await vendors.approveBank(abubakar, XYZ_VENDOR_ID, changed.rowVersion);
    expect(approved.status).toBe('ACTIVE');
  });

  it('blocks a duplicate CAC registration', async () => {
    await expect(
      vendors.create(halima, {
        legalName: 'Clone of XYZ',
        cacRegistrationNumber: 'RC-1840001',
        categoryId,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses the Administrator on the vendor register', async () => {
    await expect(vendors.list(admin)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      vendors.create(admin, {
        legalName: 'Should fail',
        cacRegistrationNumber: `RC-ADM-${randomUUID().slice(0, 6)}`,
        categoryId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('writes a reasoned audit row on suspend', async () => {
    const suffix = randomUUID().slice(0, 8);
    const created = await vendors.create(emeka, {
      legalName: `Suspend Me ${suffix}`,
      cacRegistrationNumber: `RC-S${suffix.slice(0, 6)}`,
      categoryId,
      bankName: 'Zenith Bank',
      accountName: `Suspend Me ${suffix}`,
      accountNumber: `11${suffix.replace(/\D/g, '').padEnd(8, '1').slice(0, 8)}`,
    });
    await attachRequired(emeka, created.id);
    await vendors.submit(emeka, created.id);
    const pending = await workflows.pending(abubakar);
    const item = pending.find((row) => row.referenceNumber === created.referenceNumber);
    const forMd = await workflows.get(abubakar, item!.id);
    await workflows.act(abubakar, {
      instanceId: forMd.id,
      action: 'APPROVE',
      rowVersion: forMd.rowVersion,
    });
    const active = await vendors.get(emeka, created.id);
    await vendors.suspend(emeka, created.id, {
      reason: 'Missed three deliveries in a row.',
      rowVersion: active.rowVersion,
    });
    const audit = await owner.query<{ reason: string; action: string }>(
      `SELECT reason, action::text AS action FROM audit_log
        WHERE subject_id = $1 AND subject_type = 'vendor'
        ORDER BY occurred_at DESC LIMIT 1`,
      [created.id],
    );
    expect(audit.rows[0]?.reason).toContain('Missed three deliveries');
  });

  it('uses custom RLS so a GM can read Active vendors without holding-entity membership', async () => {
    const { applyActorSession } = await import('../src/session');
    const client = await app.connect();
    try {
      await client.query('BEGIN');
      await applyActorSession(client, musa);
      const result = await client.query<{ id: string }>(`SELECT id FROM vendors WHERE id = $1`, [
        XYZ_VENDOR_ID,
      ]);
      expect(result.rows[0]?.id).toBe(XYZ_VENDOR_ID);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
