/**
 * Structured vendor quotations: side-by-side comparison, best-price
 * recommendation, award rules and the frozen memo comparison.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  ALADE_VENDOR_ID,
  DEFAULT_ROLE_GRANTS,
  SAHEL_VENDOR_ID,
  SEED_USERS,
  XYZ_VENDOR_ID,
  type ProcurementMemoSnapshot,
} from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { DocumentsService } from '../../../apps/api/src/documents/documents.service';
import { FileStorageDriver } from '../../../apps/api/src/documents/file-storage';
import { NoopMalwareScanner } from '../../../apps/api/src/documents/malware';
import { FinancialChecksService } from '../../../apps/api/src/procurement/financial-checks.service';
import { ProcurementService } from '../../../apps/api/src/procurement/procurement.service';
import { RequisitionsService } from '../../../apps/api/src/procurement/requisitions.service';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { VendorValidationService } from '../../../apps/api/src/vendors/vendor-validation.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import { ConflictError, ValidationFailedError } from '../../../apps/api/src/common/errors/domain-error';
import { attachPricedQuotation, openNeedApprovedDraft, type DualApprovalDeps } from './procurement-flow';
import { appPool, entityIdFor, ownerPool } from './support';

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

function actorFromSeed(email: string, entityIds: string[]): ActorContext {
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
    permissions: [...DEFAULT_ROLE_GRANTS[user.role]],
    homePath: '/',
  };
}

describe('procurement price comparison', () => {
  let owner: Pool;
  let app: Pool;
  let procurement: ProcurementService;
  let flow: DualApprovalDeps;
  let officer: ActorContext;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-quotes-owner');
    app = appPool('nfc-erp-test-quotes-app');
    const yfz = await entityIdFor(owner, 'YFZ');
    const dma = await entityIdFor(owner, 'DMA');
    const uow = new UnitOfWork(app);
    const workflows = new WorkflowsService(uow, new SealsService());
    const documents = new DocumentsService(uow, new FileStorageDriver(), new NoopMalwareScanner());
    procurement = new ProcurementService(
      uow,
      workflows,
      documents,
      new VendorValidationService(uow),
      new FinancialChecksService(uow),
    );
    const requisitions = new RequisitionsService(uow, workflows, documents);
    const musa = actorFromSeed('gm.yfz@nfc.local', [yfz]);
    officer = actorFromSeed('inventory@nfc.local', [yfz, dma]);
    const md = actorFromSeed('md@nfc.local', [yfz, dma]);
    const dept = await owner.query<{ id: string }>(
      `SELECT id FROM departments WHERE entity_id = $1 AND status = 'ACTIVE' ORDER BY name LIMIT 1`,
      [yfz],
    );
    const cats = await procurement.categories(musa);
    const units = await procurement.units(musa);
    const funding = await procurement.fundingSources(musa);
    const budgets = await procurement.budgetLines(musa, yfz);
    flow = {
      requisitions,
      procurement,
      workflows,
      documents,
      gm: musa,
      md,
      officer,
      entityId: yfz,
      departmentId: dept.rows[0]?.id ?? '',
      categoryId: cats.find((row) => row.key === 'services')?.id ?? '',
      unitId: units.find((row) => row.code === 'PCS')?.id ?? '',
      fundingId: funding.find((row) => row.key === 'subsidiary_operating')?.id ?? '',
      budgetLineId: budgets.find((row) => row.code === 'YFZ-CAPEX')?.id ?? null,
      vendorId: XYZ_VENDOR_ID,
    };
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  async function pricedDraft(title: string) {
    const draft = await openNeedApprovedDraft(flow, { title, quantity: 2 });
    return procurement.update(officer, draft.id, {
      rowVersion: draft.rowVersion,
      title,
      subject: title,
      departmentId: flow.departmentId,
      reason: 'Replacement of worn plant.',
      description: 'Supply as specified.',
      requiredDate: '2026-12-20',
      deliveryLocation: 'YFZ mill stores',
      fundingSourceId: flow.fundingId,
      urgency: 'NORMAL',
      proposedPaymentTiming: 'before_delivery',
      lines: [
        {
          description: title,
          categoryId: flow.categoryId,
          quantity: 2,
          unitId: flow.unitId,
          unitPriceKobo: 200_000,
          budgetLineId: flow.budgetLineId,
        },
      ],
    });
  }

  it('keeps the required date unchanged across repeated saves', async () => {
    const draft = await pricedDraft(`Quotes date ${randomUUID()}`);
    expect(draft.requiredDate).toBe('2026-12-20');
    const again = await procurement.update(officer, draft.id, { rowVersion: draft.rowVersion, urgency: 'HIGH' });
    const third = await procurement.update(officer, draft.id, { rowVersion: again.rowVersion, urgency: 'NORMAL' });
    expect(again.requiredDate).toBe('2026-12-20');
    expect(third.requiredDate).toBe('2026-12-20');
  });

  it('compares quotations side by side and recommends the lowest price', async () => {
    const draft = await pricedDraft(`Quotes compare ${randomUUID()}`);
    await attachPricedQuotation(flow, draft.id, ALADE_VENDOR_ID, 520_000);
    const view = await attachPricedQuotation(flow, draft.id, XYZ_VENDOR_ID, 400_000);

    expect(view.quotations.map((quote) => quote.vendorId)).toEqual([XYZ_VENDOR_ID, ALADE_VENDOR_ID]);
    expect(view.quotations.map((quote) => quote.isLowest)).toEqual([true, false]);
    expect(view.quotations.find((quote) => quote.vendorId === XYZ_VENDOR_ID)?.lines).toEqual([
      expect.objectContaining({ lineNumber: 1, quantity: 2, unitPriceKobo: 200_000, lineAmountKobo: 400_000 }),
    ]);
    expect(view.quotations.find((quote) => quote.vendorId === ALADE_VENDOR_ID)?.lines[0]?.unitPriceKobo).toBe(260_000);
    expect(view.quotationComparison).toMatchObject({
      minimumQuotations: 2,
      pricedCount: 2,
      lowestAmountKobo: 400_000,
      recommendedVendorIds: [XYZ_VENDOR_ID],
      selectedVendorId: null,
    });
  });

  it('refuses a second quotation from the same vendor and a suspended vendor', async () => {
    const draft = await pricedDraft(`Quotes duplicate ${randomUUID()}`);
    await attachPricedQuotation(flow, draft.id, XYZ_VENDOR_ID, 400_000);
    await expect(attachPricedQuotation(flow, draft.id, XYZ_VENDOR_ID, 390_000)).rejects.toBeInstanceOf(ConflictError);
    await expect(attachPricedQuotation(flow, draft.id, SAHEL_VENDOR_ID, 300_000)).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
  });

  it('needs at least two vendor quotations before submit', async () => {
    const draft = await pricedDraft(`Quotes minimum ${randomUUID()}`);
    const one = await attachPricedQuotation(flow, draft.id, XYZ_VENDOR_ID, 400_000);
    const selected = await procurement.selectQuotedVendor(officer, draft.id, {
      rowVersion: one.rowVersion,
      vendorId: XYZ_VENDOR_ID,
    });
    await expect(
      procurement.submit(officer, draft.id, { rowVersion: selected.rowVersion }),
    ).rejects.toThrow(/at least 2 registered vendors/);
  });

  it('requires a justification to award a vendor that is not the lowest', async () => {
    const draft = await pricedDraft(`Quotes justify ${randomUUID()}`);
    await attachPricedQuotation(flow, draft.id, XYZ_VENDOR_ID, 400_000);
    const both = await attachPricedQuotation(flow, draft.id, ALADE_VENDOR_ID, 450_000);

    await expect(
      procurement.selectQuotedVendor(officer, draft.id, { rowVersion: both.rowVersion, vendorId: ALADE_VENDOR_ID }),
    ).rejects.toThrow(/not the lowest price/);

    const justified = await procurement.selectQuotedVendor(officer, draft.id, {
      rowVersion: both.rowVersion,
      vendorId: ALADE_VENDOR_ID,
      justification: 'Alade can deliver within the week; XYZ quoted eight weeks.',
    });
    expect(justified.vendorId).toBe(ALADE_VENDOR_ID);
    expect(justified.quotationComparison.selectionIsRecommended).toBe(false);
    expect(justified.quotationComparison.selectionJustification).toMatch(/deliver within the week/);

    const submitted = await procurement.submit(officer, draft.id, {
      rowVersion: justified.rowVersion,
      idempotencyKey: `quotes-${draft.id}`,
    });
    // Services skip ED Operations, so the proposal goes straight to the MD.
    expect(submitted.status).toBe('AWAITING_MD');

    const snapshot = await owner.query<{ canonical_json: ProcurementMemoSnapshot }>(
      `SELECT canonical_json FROM procurement_memo_snapshots WHERE request_id = $1`,
      [draft.id],
    );
    const comparison = snapshot.rows[0]?.canonical_json.quotationComparison;
    expect(comparison?.quotations.map((quote) => [quote.vendorId, quote.amountKobo, quote.recommended, quote.selected])).toEqual([
      [XYZ_VENDOR_ID, 400_000, true, false],
      [ALADE_VENDOR_ID, 450_000, false, true],
    ]);
    expect(comparison?.selectionJustification).toMatch(/deliver within the week/);
  });

  it('awards the recommended vendor without a justification and clears the award when its quote is removed', async () => {
    const draft = await pricedDraft(`Quotes remove ${randomUUID()}`);
    const xyz = await attachPricedQuotation(flow, draft.id, XYZ_VENDOR_ID, 400_000);
    const both = await attachPricedQuotation(flow, draft.id, ALADE_VENDOR_ID, 450_000);
    const awarded = await procurement.selectQuotedVendor(officer, draft.id, {
      rowVersion: both.rowVersion,
      vendorId: XYZ_VENDOR_ID,
    });
    expect(awarded.quotationComparison.selectionIsRecommended).toBe(true);

    const xyzQuote = xyz.quotations.find((quote) => quote.vendorId === XYZ_VENDOR_ID)!;
    const removed = await procurement.removeQuotation(officer, draft.id, xyzQuote.id);
    expect(removed.vendorId).toBeNull();
    expect(removed.quotationComparison.pricedCount).toBe(1);
    expect(removed.quotationComparison.recommendedVendorIds).toEqual([ALADE_VENDOR_ID]);
  });

  it('refuses quantity changes while quotations exist', async () => {
    const draft = await pricedDraft(`Quotes lock ${randomUUID()}`);
    const quoted = await attachPricedQuotation(flow, draft.id, XYZ_VENDOR_ID, 400_000);
    await expect(
      procurement.update(officer, draft.id, {
        rowVersion: quoted.rowVersion,
        lines: [
          {
            description: draft.title,
            categoryId: flow.categoryId,
            quantity: 3,
            unitId: flow.unitId,
            budgetLineId: flow.budgetLineId,
          },
        ],
      }),
    ).rejects.toThrow(/Remove the vendor quotations/);
  });

  it('copies each selected item price onto the memo when the MD approves', async () => {
    const title = `Quotes items ${randomUUID()}`;
    const draft = await openNeedApprovedDraft(flow, { title, quantity: 2 });
    const prepared = await procurement.update(officer, draft.id, {
      rowVersion: draft.rowVersion,
      title,
      subject: title,
      departmentId: flow.departmentId,
      reason: 'Replacement of worn plant.',
      description: 'Supply as specified.',
      requiredDate: '2026-12-20',
      deliveryLocation: 'YFZ mill stores',
      fundingSourceId: flow.fundingId,
      urgency: 'NORMAL',
      proposedPaymentTiming: 'before_delivery',
      lines: [
        {
          description: 'Urea',
          categoryId: flow.categoryId,
          quantity: 2_150,
          unitId: flow.unitId,
          budgetLineId: flow.budgetLineId,
        },
        {
          description: 'Bags',
          categoryId: flow.categoryId,
          quantity: 10,
          unitId: flow.unitId,
          budgetLineId: flow.budgetLineId,
        },
      ],
    });
    const xyzLines = [
      { lineNumber: 1, unitPriceKobo: 57_000 },
      { lineNumber: 2, unitPriceKobo: 5_000 },
    ];
    const aladeLines = [
      { lineNumber: 1, unitPriceKobo: 60_000 },
      { lineNumber: 2, unitPriceKobo: 6_000 },
    ];
    const xyzDoc = await flow.documents.upload(officer, {
      title: `Quote xyz ${prepared.id}`,
      category: 'vendor_quotation',
      context: 'procurement',
      entityId: flow.entityId,
      ownerType: 'procurement_request',
      ownerId: prepared.id,
      file: {
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
      originalname: 'quote.png',
    },
    });
    const aladeDoc = await flow.documents.upload(officer, {
      title: `Quote alade ${prepared.id}`,
      category: 'vendor_quotation',
      context: 'procurement',
      entityId: flow.entityId,
      ownerType: 'procurement_request',
      ownerId: prepared.id,
      file: {
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
      originalname: 'quote.png',
    },
    });
    await procurement.attachQuotation(officer, prepared.id, xyzDoc.id, { vendorId: XYZ_VENDOR_ID, lines: xyzLines });
    const both = await procurement.attachQuotation(officer, prepared.id, aladeDoc.id, {
      vendorId: ALADE_VENDOR_ID,
      lines: aladeLines,
    });
    expect(both.quotations.find((quote) => quote.vendorId === XYZ_VENDOR_ID)?.amountKobo).toBe(57_000 * 2_150 + 5_000 * 10);
    expect(both.lines.every((line) => line.unitPriceKobo === 0)).toBe(true);
    const awarded = await procurement.selectQuotedVendor(officer, prepared.id, {
      rowVersion: both.rowVersion,
      vendorId: XYZ_VENDOR_ID,
    });
    const submitted = await procurement.submit(officer, prepared.id, {
      rowVersion: awarded.rowVersion,
      idempotencyKey: `quotes-items-${prepared.id}`,
    });
    expect(submitted.status).toBe('AWAITING_MD');
    const workflow = await flow.workflows.get(flow.md, submitted.workflowInstanceId!);
    const approved = await procurement.act(flow.md, prepared.id, {
      action: 'APPROVE',
      rowVersion: workflow.rowVersion,
    });
    expect(approved.lines.map((line) => [line.description, line.unitPriceKobo, line.lineAmountKobo])).toEqual([
      ['Urea', 57_000, 57_000 * 2_150],
      ['Bags', 5_000, 50_000],
    ]);
    expect(approved.totalAmountKobo).toBe(57_000 * 2_150 + 50_000);
  });
});
