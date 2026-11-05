/**
 * M6 procurement request: structured draft, server totals, invoice flags,
 * frozen memo + PDF + GM seal, submit into procurement-v1.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  DEFAULT_ROLE_GRANTS,
  SAHEL_VENDOR_ID,
  SEED_USERS,
  XYZ_VENDOR_ID,
  YFZ_PROCUREMENT_DRAFT_ID,
  amountInWords,
  type PermissionKey,
} from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { DocumentsService } from '../../../apps/api/src/documents/documents.service';
import { FileStorageDriver } from '../../../apps/api/src/documents/file-storage';
import { NoopMalwareScanner } from '../../../apps/api/src/documents/malware';
import { SearchService } from '../../../apps/api/src/engines/search.service';
import { TimelineService } from '../../../apps/api/src/engines/timeline.service';
import { FinancialChecksService } from '../../../apps/api/src/procurement/financial-checks.service';
import { ProcurementService } from '../../../apps/api/src/procurement/procurement.service';
import { RequisitionsService } from '../../../apps/api/src/procurement/requisitions.service';
import { submitNeedApprovedProposal, type DualApprovalDeps } from './procurement-flow';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { VendorValidationService } from '../../../apps/api/src/vendors/vendor-validation.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../../../apps/api/src/common/errors/domain-error';
import { appPool, captureError, entityIdFor, ownerPool } from './support';

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

describe('M6 procurement requests', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let dma: string;
  let procurement: ProcurementService;
  let requisitions: RequisitionsService;
  let workflows: WorkflowsService;
  let documents: DocumentsService;
  let search: SearchService;
  let timeline: TimelineService;
  let musa: ActorContext;
  let dmaGm: ActorContext;
  let admin: ActorContext;
  let officer: ActorContext;
  let abubakar: ActorContext;
  let flow: DualApprovalDeps;
  let departmentId: string;
  let equipmentId: string;
  let servicesId: string;
  let unitId: string;
  let fundingId: string;
  let budgetLineId: string;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-m6-owner');
    app = appPool('nfc-erp-test-m6-app');
    yfz = await entityIdFor(owner, 'YFZ');
    dma = await entityIdFor(owner, 'DMA');
    const uow = new UnitOfWork(app);
    workflows = new WorkflowsService(uow, new SealsService());
    documents = new DocumentsService(uow, new FileStorageDriver(), new NoopMalwareScanner());
    procurement = new ProcurementService(
      uow,
      workflows,
      documents,
      new VendorValidationService(uow),
      new FinancialChecksService(uow),
    );
    requisitions = new RequisitionsService(uow, workflows, documents);
    search = new SearchService(uow);
    timeline = new TimelineService(uow);
    musa = actorFromSeed('gm.yfz@nfc.local', [yfz]);
    dmaGm = actorFromSeed('gm.dma@nfc.local', [dma]);
    admin = actorFromSeed('administrator@nfc.local', [yfz]);
    officer = actorFromSeed('inventory@nfc.local', [yfz, dma]);
    abubakar = actorFromSeed('md@nfc.local', [yfz, dma]);

    const dept = await owner.query<{ id: string }>(
      `SELECT id FROM departments WHERE entity_id = $1 AND status = 'ACTIVE' ORDER BY name LIMIT 1`,
      [yfz],
    );
    departmentId = dept.rows[0]?.id ?? '';
    const cats = await procurement.categories(musa);
    equipmentId = cats.find((row) => row.key === 'equipment')?.id ?? '';
    servicesId = cats.find((row) => row.key === 'services')?.id ?? '';
    const units = await procurement.units(musa);
    unitId = units.find((row) => row.code === 'PCS')?.id ?? '';
    const funding = await procurement.fundingSources(musa);
    fundingId = funding.find((row) => row.key === 'subsidiary_operating')?.id ?? '';
    const lines = await procurement.budgetLines(musa, yfz);
    budgetLineId = lines.find((row) => row.code === 'YFZ-CAPEX')?.id ?? '';
    flow = {
      requisitions,
      procurement,
      workflows,
      documents,
      gm: musa,
      md: abubakar,
      officer,
      entityId: yfz,
      departmentId,
      categoryId: servicesId,
      unitId,
      fundingId,
      budgetLineId,
      vendorId: XYZ_VENDOR_ID,
    };
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  async function openPreparedDraft(title: string, categoryId = servicesId) {
    const created = await requisitions.create(musa, { title, departmentId });
    const filled = await requisitions.update(musa, created.id, {
      rowVersion: created.rowVersion,
      title,
      departmentId,
      categoryId,
      background: 'Required for the mill programme.',
      justification: 'Replacement of worn plant.',
      prayer: 'Management is invited to approve the need.',
      requiredDate: '2026-12-15',
      deliveryLocation: 'YFZ mill stores',
      urgency: 'NORMAL',
      lines: [{ description: title, quantity: 3, unitId }],
    });
    const submitted = await requisitions.submit(musa, created.id, {
      rowVersion: filled.rowVersion,
      idempotencyKey: `req-${created.id}`,
    });
    const atNeed = await workflows.get(abubakar, submitted.workflowInstanceId!);
    await procurement.act(abubakar, submitted.procurementRequestId!, {
      action: 'APPROVE',
      rowVersion: atNeed.rowVersion,
    });
    return procurement.get(officer, submitted.procurementRequestId!);
  }

  it('serves the seeded YFZ draft to Musa and hides it from DMA and the Administrator', async () => {
    const seeded = await procurement.get(musa, YFZ_PROCUREMENT_DRAFT_ID);
    expect(seeded.referenceNumber).toBe('PR-2026-000186');
    expect(seeded.status).toBe('DRAFT');
    expect(seeded.vendorName).toMatch(/XYZ/);
    await expect(procurement.get(dmaGm, YFZ_PROCUREMENT_DRAFT_ID)).rejects.toBeInstanceOf(NotFoundError);
    await expect(procurement.list(admin)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(procurement.create(musa, { title: 'Should fail' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(procurement.create(admin, { title: 'Should fail' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('recomputes totals and ignores a spoofed client total', async () => {
    const draft = await openPreparedDraft('Spoofed total');
    const filled = await procurement.update(officer, draft.id, {
      rowVersion: draft.rowVersion,
      subject: 'Test subject',
      vendorId: XYZ_VENDOR_ID,
      fundingSourceId: fundingId,
      proposedPaymentTiming: 'before_delivery',
      priceComparison: 'XYZ quoted the lowest compliant price.',
      recommendation: 'Award to XYZ Limited.',
      lines: [
        {
          description: 'Spoofed total',
          categoryId: servicesId,
          quantity: 3,
          unitId,
          unitPriceKobo: 150_000,
          budgetLineId,
        },
      ],
    });
    const spoofed = await procurement.update(officer, draft.id, {
      rowVersion: filled.rowVersion,
      totalAmountKobo: 1,
      quantity: 3,
      unitPriceKobo: 150_000,
    });
    expect(spoofed.totalAmountKobo).toBe(450_000);
  });

  it('rejects a suspended vendor and a non-preparer edit', async () => {
    const draft = await openPreparedDraft('Vendor gate');
    await expect(
      procurement.update(officer, draft.id, {
        rowVersion: draft.rowVersion,
        vendorId: SAHEL_VENDOR_ID,
      }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
    await expect(
      procurement.update(musa, draft.id, { rowVersion: draft.rowVersion, title: 'Hijack' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('submits an equipment proposal from quotations without an invoice', async () => {
    const submitted = await submitNeedApprovedProposal(
      { ...flow, categoryId: equipmentId },
      { title: `Equipment invoice ${randomUUID()}`, quantity: 2, unitPriceKobo: 50_000 },
    );
    expect(submitted.invoice).toBeNull();
    expect(submitted.status).toBe('AWAITING_OPERATIONS');
  });

  it('freezes the memo, PDF, seals and commitment on Procurement Manager submit', async () => {
    const submitted = await submitNeedApprovedProposal(flow, {
      title: 'Conveyor idlers',
      quantity: 4,
      unitPriceKobo: 250_000,
    });
    expect(submitted.status).toBe('AWAITING_MD');
    expect(submitted.totalAmountKobo).toBe(1_000_000);
    expect(submitted.workflowInstanceId).toBeTruthy();
    const memo = await procurement.memoHtml(musa, submitted.id);
    expect(memo.html).toContain(amountInWords(1_000_000n));
    expect(memo.html).toContain('Conveyor idlers');
    expect(memo.html).not.toContain('OPERATIONS REVIEWED');
    const pdf = await procurement.memoPdf(musa, submitted.id);
    expect(pdf.buffer.subarray(0, 4).toString()).toBe('%PDF');
    const instance = await workflows.get(musa, submitted.workflowInstanceId!);
    expect(instance.currentStageKey).toBe('md');
    expect(instance.seals.some((seal) => seal.badgeLabel === 'REQUESTED BY' && seal.verification === 'VALID')).toBe(
      true,
    );
    expect(instance.seals.some((seal) => seal.badgeLabel === 'NEED APPROVED' && seal.verification === 'VALID')).toBe(
      true,
    );
    expect(instance.seals.some((seal) => seal.badgeLabel === 'PREPARED BY' && seal.verification === 'VALID')).toBe(
      true,
    );
    const events = await timeline.list(musa, 'PROCUREMENT', submitted.id);
    expect(events.some((row) => row.text === 'Procurement Manager submitted proposal')).toBe(true);
    const hits = await search.search(musa, submitted.referenceNumber);
    expect(hits.groups.some((group) => group.hits.some((hit) => hit.href === `/procurement/${submitted.id}`))).toBe(
      true,
    );
    const dmaHits = await search.search(dmaGm, submitted.referenceNumber);
    expect(dmaHits.groups.flatMap((group) => group.hits).some((hit) => hit.recordId === submitted.id)).toBe(
      false,
    );

    const commitments = await owner.query<{ action: string }>(
      `SELECT action FROM procurement_commitment_events WHERE request_id = $1 ORDER BY created_at`,
      [submitted.id],
    );
    expect(commitments.rows.map((row) => row.action)).toEqual(['OPEN']);

    await expect(
      procurement.submit(officer, submitted.id, {
        rowVersion: submitted.rowVersion,
        idempotencyKey: `test-${submitted.id}-other`,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const refused = await captureError(async () => {
      await owner.query(`UPDATE procurement_versions SET title = 'tamper' WHERE id = $1`, [submitted.versionId]);
    });
    expect(refused.message).toMatch(/submitted procurement versions cannot be changed/);

    await owner.query('BEGIN');
    try {
      await owner.query(`SELECT set_config('session_replication_role', 'replica', true)`);
      await owner.query(
        `UPDATE procurement_memo_snapshots
            SET canonical_json = canonical_json || '{"title":"tampered"}'::jsonb
          WHERE version_id = $1`,
        [submitted.versionId],
      );
      await owner.query('COMMIT');
    } catch (error) {
      await owner.query('ROLLBACK');
      throw error;
    }
    const tampered = await workflows.get(musa, submitted.workflowInstanceId!);
    expect(tampered.seals.some((seal) => seal.verification === 'SNAPSHOT_MISMATCH')).toBe(true);
  });
});
