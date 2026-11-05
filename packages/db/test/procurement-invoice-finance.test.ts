/**
 * The vendor invoice is requested at the ED Finance stage: the proposal goes
 * to the MD with quotations only, ED Finance cannot approve until the approved
 * vendor's invoice is attached to the same record, and an amount that differs
 * from the approved total needs the MD to approve it. The workflow never moves
 * back, so earlier approvals are not repeated.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  ALADE_VENDOR_ID,
  DEFAULT_ROLE_GRANTS,
  SEED_USERS,
  XYZ_VENDOR_ID,
  YFZ_BANK_ACCOUNT_ID,
  type ProcurementView,
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
import { attachFinanceInvoice, submitNeedApprovedProposal, type DualApprovalDeps } from './procurement-flow';
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

describe('procurement invoice at ED Finance', () => {
  let owner: Pool;
  let app: Pool;
  let procurement: ProcurementService;
  let workflows: WorkflowsService;
  let flow: DualApprovalDeps;
  let officer: ActorContext;
  let md: ActorContext;
  let edFinance: ActorContext;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-invoice-finance-owner');
    app = appPool('nfc-erp-test-invoice-finance-app');
    const yfz = await entityIdFor(owner, 'YFZ');
    const dma = await entityIdFor(owner, 'DMA');
    const uow = new UnitOfWork(app);
    workflows = new WorkflowsService(uow, new SealsService());
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
    md = actorFromSeed('md@nfc.local', [yfz, dma]);
    edFinance = actorFromSeed('ed.finance@nfc.local', [yfz, dma]);
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

  async function submitAndApproveByMd(title: string): Promise<ProcurementView> {
    const submitted = await submitNeedApprovedProposal(flow, { title, quantity: 2, unitPriceKobo: 200_000 });
    expect(submitted.invoice).toBeNull();
    expect(submitted.status).toBe('AWAITING_MD');
    const workflow = await workflows.get(md, submitted.workflowInstanceId!);
    return procurement.act(md, submitted.id, { action: 'APPROVE', rowVersion: workflow.rowVersion });
  }

  async function approveFunding(request: ProcurementView) {
    const workflow = await workflows.get(edFinance, request.workflowInstanceId!);
    return procurement.act(edFinance, request.id, {
      action: 'APPROVE',
      rowVersion: workflow.rowVersion,
      fundingRoute: 'subsidiary_operating',
      sourceAccountId: YFZ_BANK_ACCOUNT_ID,
      checklistAcknowledged: true,
    });
  }

  async function eventsFor(requestId: string, eventType: string) {
    const result = await owner.query<{ recipient: string | null }>(
      `SELECT payload->>'recipientUserId' AS recipient
         FROM domain_events
        WHERE subject_id = $1 AND event_type = $2
        ORDER BY occurred_at`,
      [requestId, eventType],
    );
    return result.rows.map((row) => row.recipient);
  }

  it('asks the Procurement Manager for the invoice and blocks ED Finance until the approved vendor invoice arrives', async () => {
    const atFinance = await submitAndApproveByMd(`Invoice at finance ${randomUUID()}`);
    expect(atFinance.status).toBe('AWAITING_ED_FINANCE');
    expect(atFinance.invoiceStage).toBe('awaiting_invoice');
    expect(await eventsFor(atFinance.id, 'procurement.invoice_requested')).toContain(officer.ref);

    await expect(approveFunding(atFinance)).rejects.toThrow(/invoice has not been uploaded/);

    await expect(attachFinanceInvoice(flow, atFinance, { vendorId: ALADE_VENDOR_ID })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );

    const sealsBefore = (await workflows.get(md, atFinance.workflowInstanceId!)).seals.length;
    const withInvoice = await attachFinanceInvoice(flow, atFinance);
    expect(withInvoice.status).toBe('AWAITING_ED_FINANCE');
    expect(withInvoice.invoiceStage).toBe('ready');
    expect(withInvoice.invoice?.vendorId).toBe(XYZ_VENDOR_ID);
    expect(await eventsFor(atFinance.id, 'procurement.invoice_uploaded')).toContain(edFinance.ref);

    const approved = await approveFunding(withInvoice);
    expect(approved.status).toBe('AWAITING_PAYMENT');
    expect(approved.authorizedAmountKobo).toBe(400_000);
    const seals = (await workflows.get(md, atFinance.workflowInstanceId!)).seals;
    // ED Finance adds its own seal; no earlier stage was repeated.
    expect(seals.length).toBe(sealsBefore + 1);
  });

  it('sends a different invoice amount to the MD, who can reject it and then approve a corrected one', async () => {
    const atFinance = await submitAndApproveByMd(`Invoice variance ${randomUUID()}`);
    const higher = await attachFinanceInvoice(flow, atFinance, { amountKobo: 430_000 });
    expect(higher.invoiceStage).toBe('variance_pending');
    expect(higher.invoiceVariance).toMatchObject({ approvedAmountKobo: 400_000, invoiceAmountKobo: 430_000, differenceKobo: 30_000 });
    expect(await eventsFor(atFinance.id, 'procurement.invoice_variance')).toContain(md.ref);
    await expect(approveFunding(higher)).rejects.toThrow(/waiting for the MD/);

    await expect(procurement.decideInvoiceVariance(md, atFinance.id, { decision: 'REJECT' })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
    const rejected = await procurement.decideInvoiceVariance(md, atFinance.id, {
      decision: 'REJECT',
      reason: 'The vendor must honour the quoted price.',
    });
    expect(rejected.invoiceStage).toBe('variance_rejected');
    expect(await eventsFor(atFinance.id, 'procurement.invoice_variance_rejected')).toContain(officer.ref);
    await expect(approveFunding(rejected)).rejects.toThrow(/rejected the invoiced amount/);

    const corrected = await attachFinanceInvoice(flow, rejected, {
      amountKobo: 410_000,
      reason: 'Vendor reissued the invoice with delivery included.',
    });
    expect(corrected.invoiceStage).toBe('variance_pending');
    const accepted = await procurement.decideInvoiceVariance(md, atFinance.id, { decision: 'APPROVE' });
    expect(accepted.invoiceStage).toBe('ready');
    expect(accepted.status).toBe('AWAITING_ED_FINANCE');

    const commitments = await owner.query<{ net: string }>(
      `SELECT coalesce(sum(CASE WHEN action = 'OPEN' THEN amount_kobo ELSE -amount_kobo END), 0)::text AS net
         FROM procurement_commitment_events WHERE request_id = $1`,
      [atFinance.id],
    );
    expect(Number(commitments.rows[0]?.net)).toBe(410_000);

    const approved = await approveFunding(accepted);
    expect(approved.authorizedAmountKobo).toBe(410_000);
  });

  it('refuses an ED Finance approval through the generic workflow endpoint', async () => {
    const atFinance = await submitAndApproveByMd(`Invoice generic path ${randomUUID()}`);
    const workflow = await workflows.get(edFinance, atFinance.workflowInstanceId!);
    await expect(
      workflows.act(edFinance, {
        instanceId: atFinance.workflowInstanceId!,
        action: 'APPROVE',
        rowVersion: workflow.rowVersion,
        fundingRoute: 'subsidiary_operating',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
