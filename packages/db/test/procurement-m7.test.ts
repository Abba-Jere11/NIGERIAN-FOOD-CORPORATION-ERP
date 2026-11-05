/**
 * M7 procurement approvals: Ops → MD, return versioning, clone, archive, SLA.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  ALADE_VENDOR_ID,
  DEFAULT_ROLE_GRANTS,
  SEED_USERS,
  XYZ_VENDOR_ID,
  type PermissionKey,
} from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { insertDueSlaReminders } from '../src/sla';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { DocumentsService } from '../../../apps/api/src/documents/documents.service';
import { FileStorageDriver } from '../../../apps/api/src/documents/file-storage';
import { NoopMalwareScanner } from '../../../apps/api/src/documents/malware';
import { FinancialChecksService } from '../../../apps/api/src/procurement/financial-checks.service';
import { ProcurementService } from '../../../apps/api/src/procurement/procurement.service';
import { RequisitionsService } from '../../../apps/api/src/procurement/requisitions.service';
import { attachPricedQuotation, submitNeedApprovedProposal, type DualApprovalDeps } from './procurement-flow';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { VendorValidationService } from '../../../apps/api/src/vendors/vendor-validation.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ReasonRequiredError,
  ValidationFailedError,
} from '../../../apps/api/src/common/errors/domain-error';
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

describe('M7 procurement approvals', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let dma: string;
  let procurement: ProcurementService;
  let requisitions: RequisitionsService;
  let workflows: WorkflowsService;
  let documents: DocumentsService;
  let musa: ActorContext;
  let officer: ActorContext;
  let flow: DualApprovalDeps;
  let dmaGm: ActorContext;
  let admin: ActorContext;
  let halima: ActorContext;
  let abubakar: ActorContext;
  let emeka: ActorContext;
  let departmentId: string;
  let equipmentId: string;
  let unitId: string;
  let fundingId: string;
  let budgetLineId: string;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-m7-owner');
    app = appPool('nfc-erp-test-m7-app');
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
    musa = actorFromSeed('gm.yfz@nfc.local', [yfz]);
    officer = actorFromSeed('inventory@nfc.local', [yfz, dma]);
    dmaGm = actorFromSeed('gm.dma@nfc.local', [dma]);
    admin = actorFromSeed('administrator@nfc.local', [yfz]);
    halima = actorFromSeed('ed.operations@nfc.local', [yfz, dma]);
    abubakar = actorFromSeed('md@nfc.local', [yfz, dma]);
    emeka = actorFromSeed('ed.finance@nfc.local', [yfz, dma]);

    const dept = await owner.query<{ id: string }>(
      `SELECT id FROM departments WHERE entity_id = $1 AND status = 'ACTIVE' ORDER BY name LIMIT 1`,
      [yfz],
    );
    departmentId = dept.rows[0]?.id ?? '';
    const cats = await procurement.categories(musa);
    equipmentId = cats.find((row) => row.key === 'equipment')?.id ?? '';
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
      categoryId: equipmentId,
      unitId,
      fundingId,
      budgetLineId,
      vendorId: XYZ_VENDOR_ID,
    };
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  async function fillAndSubmit(title: string) {
    return submitNeedApprovedProposal(flow, {
      title,
      quantity: 2,
      unitPriceKobo: 200_000,
      invoiceRequired: true,
    });
  }

  it('walks GM → ED Operations → MD with VALID seals and AWAITING_ED_FINANCE', async () => {
    const submitted = await fillAndSubmit(`M7 path ${randomUUID()}`);
    expect(submitted.status).toBe('AWAITING_OPERATIONS');
    const workflow = await workflows.get(halima, submitted.workflowInstanceId!);
    expect(workflow.allowedActions).toContain('APPROVE');

    await expect(
      procurement.act(abubakar, submitted.id, { action: 'APPROVE', rowVersion: workflow.rowVersion }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(procurement.get(dmaGm, submitted.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      procurement.act(admin, submitted.id, { action: 'APPROVE', rowVersion: workflow.rowVersion }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const afterOps = await procurement.act(halima, submitted.id, {
      action: 'APPROVE',
      rowVersion: workflow.rowVersion,
    });
    expect(afterOps.status).toBe('AWAITING_MD');
    const atMd = await workflows.get(abubakar, afterOps.workflowInstanceId!);
    expect(atMd.currentStageKey).toBe('md');
    expect(atMd.seals.filter((seal) => seal.verification === 'VALID').length).toBeGreaterThanOrEqual(2);

    await expect(
      procurement.act(halima, afterOps.id, { action: 'APPROVE', rowVersion: atMd.rowVersion }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const afterMd = await procurement.act(abubakar, afterOps.id, {
      action: 'APPROVE',
      rowVersion: atMd.rowVersion,
    });
    expect(afterMd.status).toBe('AWAITING_ED_FINANCE');
    const finance = await workflows.get(emeka, afterMd.workflowInstanceId!);
    expect(finance.currentStageKey).toBe('ed-finance');
    expect(finance.allowedActions).toContain('APPROVE');
    await expect(
      procurement.act(emeka, afterMd.id, { action: 'APPROVE', rowVersion: finance.rowVersion }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
    expect(finance.seals.every((seal) => seal.verification === 'VALID')).toBe(true);
    const memo = await procurement.memoHtml(musa, afterMd.id);
    expect(memo.html).toContain(halima.name);
    expect(memo.html).toContain(abubakar.name);
    const reviewed = memo.html.slice(memo.html.indexOf('OPERATIONS REVIEWED'));
    expect(reviewed.slice(0, reviewed.indexOf('PROCUREMENT APPROVED'))).not.toContain('Pending');
    const approvedCell = memo.html.slice(memo.html.indexOf('PROCUREMENT APPROVED'));
    expect(approvedCell.slice(0, approvedCell.indexOf('FINANCE APPROVED'))).not.toContain('Pending');
  });

  it('refuses reject/return/archive without a reason and stores the reason', async () => {
    const submitted = await fillAndSubmit(`M7 reasons ${randomUUID()}`);
    const workflow = await workflows.get(halima, submitted.workflowInstanceId!);
    await expect(
      procurement.act(halima, submitted.id, { action: 'REJECT', rowVersion: workflow.rowVersion }),
    ).rejects.toBeInstanceOf(ReasonRequiredError);
    const rejected = await procurement.act(halima, submitted.id, {
      action: 'REJECT',
      reason: 'Quantity is not supported by the production requirement.',
      rowVersion: workflow.rowVersion,
    });
    expect(rejected.status).toBe('REJECTED');
    expect(
      rejected.versions.some(
        (version) => typeof version.rejectReason === 'string' && /production requirement/.test(version.rejectReason),
      ),
    ).toBe(true);
  });

  it('returns to the Procurement Manager, creates version 2, and resubmits at Operations', async () => {
    const submitted = await fillAndSubmit(`M7 return ${randomUUID()}`);
    const workflow = await workflows.get(halima, submitted.workflowInstanceId!);
    const returned = await procurement.act(halima, submitted.id, {
      action: 'RETURN_FOR_CORRECTION',
      reason: 'Add the comparative quotation.',
      rowVersion: workflow.rowVersion,
    });
    expect(returned.status).toBe('DRAFT');
    expect(returned.currentVersion).toBe(2);
    expect(returned.lastReturnReason).toMatch(/comparative quotation/);
    expect(returned.versions).toHaveLength(2);
    expect(returned.versions.some((version) => version.returnReason)).toBe(true);

    const frozen = await owner.query<{ submitted_at: Date | null }>(
      `SELECT submitted_at FROM procurement_versions WHERE request_id = $1 AND version_number = 1`,
      [returned.id],
    );
    expect(frozen.rows[0]?.submitted_at).toBeTruthy();

    const commitments = await owner.query<{ action: string }>(
      `SELECT action FROM procurement_commitment_events WHERE request_id = $1 ORDER BY created_at`,
      [returned.id],
    );
    expect(commitments.rows.map((row) => row.action)).toEqual(['OPEN', 'RELEASE']);

    // Quotations carry over to the returned version; replace the competitor's with a fresh one.
    expect(returned.quotationComparison.pricedCount).toBe(2);
    const competitor = returned.quotations.find((quote) => quote.vendorId === ALADE_VENDOR_ID);
    expect(competitor).toBeDefined();
    await procurement.removeQuotation(officer, returned.id, competitor!.id);
    await attachPricedQuotation(flow, returned.id, ALADE_VENDOR_ID, 900_000);
    const current = await procurement.get(officer, returned.id);
    expect(current.quotationComparison.selectedVendorId).toBe(XYZ_VENDOR_ID);
    expect(current.quotationComparison.selectionIsRecommended).toBe(true);
    const resubmitted = await procurement.submit(officer, returned.id, {
      rowVersion: current.rowVersion,
      idempotencyKey: `m7-${returned.id}-v2`,
    });
    expect(resubmitted.status).toBe('AWAITING_OPERATIONS');
    expect(resubmitted.currentVersion).toBe(2);
    const restarted = await workflows.get(halima, resubmitted.workflowInstanceId!);
    expect(restarted.currentStageKey).toBe('ed-operations');
    expect(restarted.subjectType).toBe('PROCUREMENT');
    expect(restarted.seals.filter((seal) => seal.action === 'prepared').length).toBeGreaterThanOrEqual(2);
    expect(restarted.tracker.find((stage) => stage.key === 'ed-operations')?.state).toBe('current');

    const afterSecond = await procurement.act(halima, resubmitted.id, {
      action: 'RETURN_FOR_CORRECTION',
      reason: 'Still missing the second quote.',
      rowVersion: restarted.rowVersion,
    });
    expect(afterSecond.currentVersion).toBe(3);
    expect(afterSecond.versions).toHaveLength(3);
  });

  it('clones a rejected request into a new draft', async () => {
    const submitted = await fillAndSubmit(`M7 clone ${randomUUID()}`);
    const workflow = await workflows.get(halima, submitted.workflowInstanceId!);
    const rejected = await procurement.act(halima, submitted.id, {
      action: 'REJECT',
      reason: 'Specification does not match the mill package.',
      rowVersion: workflow.rowVersion,
    });
    const cloned = await procurement.clone(officer, rejected.id, {});
    expect(cloned.id).not.toBe(rejected.id);
    expect(cloned.status).toBe('DRAFT');
    expect(cloned.clonedFromId).toBe(rejected.id);
    expect(cloned.clonedFromReference).toBe(rejected.referenceNumber);
    expect(cloned.currentVersion).toBe(1);
    expect(cloned.title).toBe(rejected.title);
    const stillOpen = await fillAndSubmit(`M7 clone-open ${randomUUID()}`);
    await expect(procurement.clone(musa, stillOpen.id, {})).rejects.toBeInstanceOf(ConflictError);
  });

  it('archives from the queue and restores only with the MD and a reason', async () => {
    const submitted = await fillAndSubmit(`M7 archive ${randomUUID()}`);
    const workflow = await workflows.get(halima, submitted.workflowInstanceId!);
    const archived = await procurement.act(halima, submitted.id, {
      action: 'ARCHIVE',
      reason: 'Parked pending a revised specification.',
      rowVersion: workflow.rowVersion,
    });
    expect(archived.status).toBe('ARCHIVED');
    expect(archived.archivedFrom?.status).toBe('AWAITING_OPERATIONS');
    const pending = await workflows.pending(halima);
    expect(pending.some((row) => row.subjectId === archived.id)).toBe(false);
    const restoredWorkflow = await workflows.get(abubakar, archived.workflowInstanceId!);
    await expect(
      procurement.act(halima, archived.id, {
        action: 'RESTORE',
        reason: 'Halima cannot restore.',
        rowVersion: restoredWorkflow.rowVersion,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      procurement.act(abubakar, archived.id, { action: 'RESTORE', rowVersion: restoredWorkflow.rowVersion }),
    ).rejects.toBeInstanceOf(ReasonRequiredError);
    const restored = await procurement.act(abubakar, archived.id, {
      action: 'RESTORE',
      reason: 'Specification now agreed.',
      rowVersion: restoredWorkflow.rowVersion,
    });
    expect(restored.status).toBe('AWAITING_OPERATIONS');
  });

  it('lets only one of two concurrent Ops approvals succeed', async () => {
    const submitted = await fillAndSubmit(`M7 concurrent ${randomUUID()}`);
    const workflow = await workflows.get(halima, submitted.workflowInstanceId!);
    const results = await Promise.allSettled([
      procurement.act(halima, submitted.id, { action: 'APPROVE', rowVersion: workflow.rowVersion }),
      procurement.act(halima, submitted.id, { action: 'APPROVE', rowVersion: workflow.rowVersion }),
    ]);
    const fulfilled = results.filter((row) => row.status === 'fulfilled');
    expect(fulfilled.length).toBe(1);
    const after = await procurement.get(musa, submitted.id);
    expect(after.status).toBe('AWAITING_MD');
  });

  it('fires 2/5/7-day reminders on a real procurement hold', async () => {
    const submitted = await fillAndSubmit(`M7 sla ${randomUUID()}`);
    const hold = await owner.query<{ id: string }>(
      `SELECT id FROM workflow_holds
        WHERE subject_type = 'PROCUREMENT' AND subject_id = $1 AND status = 'open'`,
      [submitted.id],
    );
    expect(hold.rows[0]).toBeTruthy();
    await owner.query(`UPDATE workflow_holds SET pending_since = now() - interval '8 days' WHERE id = $1`, [
      hold.rows[0]!.id,
    ]);
    const client = await owner.connect();
    try {
      const due = await insertDueSlaReminders(client, {
        ref: 'system:escalation',
        name: 'Escalation',
        role: null,
        scopeType: null,
        entityIds: [],
        isCorporate: true,
        isAdmin: false,
        permissions: [],
        homePath: null,
      }, new Date());
      const forHold = due.filter((row) => row.holdId === hold.rows[0]!.id);
      expect(forHold.map((row) => row.days).sort((a, b) => a - b)).toEqual([2, 5, 7]);
    } finally {
      client.release();
    }
  });
});
