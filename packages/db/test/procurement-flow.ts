import { randomUUID } from 'node:crypto';
import type { ActorContext } from '../src/session';
import type { DocumentsService } from '../../../apps/api/src/documents/documents.service';
import type { ProcurementService } from '../../../apps/api/src/procurement/procurement.service';
import type { RequisitionsService } from '../../../apps/api/src/procurement/requisitions.service';
import type { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { ALADE_VENDOR_ID, XYZ_VENDOR_ID, type ProcurementView } from '@nfc/shared';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export type DualApprovalDeps = {
  requisitions: RequisitionsService;
  procurement: ProcurementService;
  workflows: WorkflowsService;
  documents: DocumentsService;
  gm: ActorContext;
  md: ActorContext;
  officer: ActorContext;
  entityId: string;
  departmentId: string;
  categoryId: string;
  unitId: string;
  fundingId: string;
  budgetLineId: string | null;
  vendorId: string;
};

export type DualApprovalInput = {
  title: string;
  quantity?: number;
  unitPriceKobo?: number;
  requiredDate?: string;
  proposedPaymentTiming?: 'before_delivery' | 'after_delivery';
  invoiceRequired?: boolean;
  categoryId?: string;
  fundingId?: string;
  budgetLineId?: string | null;
  extraLines?: Array<{
    description: string;
    categoryId: string;
    quantity: number;
    unitId: string;
    unitPriceKobo: number;
    budgetLineId: string | null;
  }>;
};

export async function openNeedApprovedDraft(
  deps: DualApprovalDeps,
  input: { title: string; quantity?: number },
): Promise<ProcurementView> {
  const created = await deps.requisitions.create(deps.gm, {
    title: input.title,
    departmentId: deps.departmentId,
  });
  const filled = await deps.requisitions.update(deps.gm, created.id, {
    rowVersion: created.rowVersion,
    title: input.title,
    departmentId: deps.departmentId,
    categoryId: deps.categoryId,
    background: 'Required for the mill programme.',
    justification: 'Replacement of worn plant.',
    prayer: 'Management is invited to approve the need.',
    requiredDate: '2026-12-20',
    deliveryLocation: 'YFZ mill stores',
    urgency: 'NORMAL',
    lines: [{ description: input.title, quantity: input.quantity ?? 2, unitId: deps.unitId }],
  });
  const submittedNeed = await deps.requisitions.submit(deps.gm, created.id, {
    rowVersion: filled.rowVersion,
    idempotencyKey: `req-${created.id}-v${filled.currentVersion}`,
  });
  const atNeed = await deps.workflows.get(deps.md, submittedNeed.workflowInstanceId!);
  await deps.procurement.act(deps.md, submittedNeed.procurementRequestId!, {
    action: 'APPROVE',
    rowVersion: atNeed.rowVersion,
  });
  return deps.procurement.get(deps.officer, submittedNeed.procurementRequestId!);
}

export async function pricePreparedDraft(
  deps: DualApprovalDeps,
  proposal: ProcurementView,
  input: DualApprovalInput,
): Promise<ProcurementView> {
  const quantity = input.quantity ?? 2;
  const unitPriceKobo = input.unitPriceKobo ?? 200_000;
  const categoryId = input.categoryId ?? deps.categoryId;
  const fundingId = input.fundingId ?? deps.fundingId;
  const budgetLineId = input.budgetLineId === undefined ? deps.budgetLineId : input.budgetLineId;
  const lines = input.extraLines ?? [
    {
      description: input.title,
      categoryId,
      quantity,
      unitId: deps.unitId,
      unitPriceKobo,
      budgetLineId,
    },
  ];
  await deps.procurement.update(deps.officer, proposal.id, {
    rowVersion: proposal.rowVersion,
    title: input.title,
    subject: input.title,
    departmentId: deps.departmentId,
    categoryId,
    reason: 'Replacement of worn plant.',
    description: 'Supply as specified.',
    requiredDate: input.requiredDate ?? '2026-12-20',
    vendorId: deps.vendorId,
    deliveryLocation: 'YFZ mill stores',
    fundingSourceId: fundingId,
    urgency: 'NORMAL',
    proposedPaymentTiming: input.proposedPaymentTiming ?? 'before_delivery',
    lines,
  });
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceKobo, 0);
  const competitor = deps.vendorId === ALADE_VENDOR_ID ? XYZ_VENDOR_ID : ALADE_VENDOR_ID;
  await attachPricedQuotation(deps, proposal.id, deps.vendorId, total);
  let current = await attachPricedQuotation(deps, proposal.id, competitor, total + 50_000);
  current = await deps.procurement.selectQuotedVendor(deps.officer, proposal.id, {
    rowVersion: current.rowVersion,
    vendorId: deps.vendorId,
  });
  // The invoice is requested at ED Finance; `approveIfAt` attaches it once the MD has approved.
  flowByRequest.set(proposal.id, deps);
  return current;
}

/**
 * Requests priced through these helpers, so the MD-approval helper can attach
 * the matching vendor invoice at ED Finance without every suite passing the
 * officer and documents service along.
 */
const flowByRequest = new Map<string, DualApprovalDeps>();

/** The Procurement Manager uploads the approved vendor's invoice while the request waits at ED Finance. */
export async function attachFinanceInvoice(
  deps: DualApprovalDeps,
  request: ProcurementView,
  options: { amountKobo?: number; vendorId?: string; reason?: string } = {},
): Promise<ProcurementView> {
  const uploaded = await deps.documents.upload(deps.officer, {
    title: `Invoice ${request.referenceNumber}`,
    category: 'invoice',
    context: 'procurement',
    entityId: deps.entityId,
    ownerType: 'procurement_request',
    ownerId: request.id,
    file: { buffer: PNG, originalname: 'invoice.png' },
  });
  return deps.procurement.attachInvoice(
    deps.officer,
    request.id,
    {
      invoiceNumber: `INV-${randomUUID().slice(0, 8)}`,
      invoiceDate: '2026-09-01',
      amountKobo: options.amountKobo ?? request.totalAmountKobo ?? 0,
      vendorId: options.vendorId ?? request.vendorId ?? undefined,
      reason: options.reason,
    },
    uploaded.id,
  );
}

/**
 * `amountKobo` is the vendor total. When it matches the memo line prices, those
 * unit prices are reused. Otherwise the total is split across the current lines.
 */
function quotationLinesForTotal(
  memoLines: Array<{ lineNumber: number; quantity: number; unitPriceKobo: number }>,
  totalKobo: number,
): Array<{ lineNumber: number; unitPriceKobo: number }> {
  const priced = memoLines.filter((line) => line.quantity > 0);
  if (priced.length === 0) throw new Error('Add item quantities before recording a quotation.');
  const current = priced.reduce((sum, line) => sum + line.quantity * line.unitPriceKobo, 0);
  if (current === totalKobo && priced.every((line) => line.unitPriceKobo > 0)) {
    return priced.map((line) => ({ lineNumber: line.lineNumber, unitPriceKobo: line.unitPriceKobo }));
  }
  if (priced.length === 1) {
    const qty = priced[0]!.quantity;
    if (totalKobo % qty !== 0) {
      throw new Error(`Quotation total ${totalKobo} is not divisible by quantity ${qty}.`);
    }
    return [{ lineNumber: priced[0]!.lineNumber, unitPriceKobo: totalKobo / qty }];
  }
  const head = priced.slice(0, -1);
  const last = priced[priced.length - 1]!;
  const used = head.reduce((sum, line) => sum + line.quantity, 0);
  const remain = totalKobo - used;
  if (remain <= 0 || remain % last.quantity !== 0) {
    throw new Error(`Cannot split quotation total ${totalKobo} across the memo lines.`);
  }
  return [
    ...head.map((line) => ({ lineNumber: line.lineNumber, unitPriceKobo: 1 })),
    { lineNumber: last.lineNumber, unitPriceKobo: remain / last.quantity },
  ];
}

export async function attachPricedQuotation(
  deps: DualApprovalDeps,
  requestId: string,
  vendorId: string,
  amountKobo: number,
): Promise<ProcurementView> {
  const current = await deps.procurement.get(deps.officer, requestId);
  const document = await deps.documents.upload(deps.officer, {
    title: `Quote ${vendorId.slice(-4)} ${requestId}`,
    category: 'vendor_quotation',
    context: 'procurement',
    entityId: deps.entityId,
    ownerType: 'procurement_request',
    ownerId: requestId,
    file: { buffer: PNG, originalname: 'quote.png' },
  });
  return deps.procurement.attachQuotation(deps.officer, requestId, document.id, {
    vendorId,
    lines: quotationLinesForTotal(current.lines ?? [], amountKobo),
  });
}

export async function submitNeedApprovedProposal(
  deps: DualApprovalDeps,
  input: DualApprovalInput,
): Promise<ProcurementView> {
  const categoryId = input.categoryId ?? deps.categoryId;
  const draft = await openNeedApprovedDraft(
    { ...deps, categoryId },
    {
      title: input.title,
      quantity: input.extraLines?.[0]?.quantity ?? input.quantity,
    },
  );
  const priced = await pricePreparedDraft(deps, draft, input);
  return deps.procurement.submit(deps.officer, priced.id, {
    rowVersion: priced.rowVersion,
    idempotencyKey: `pr-${priced.id}-v${priced.currentVersion}`,
  });
}

export async function approveIfAt(
  procurement: ProcurementService,
  workflows: WorkflowsService,
  actor: ActorContext,
  request: ProcurementView,
  status: string,
  extra: Record<string, unknown> = {},
): Promise<ProcurementView> {
  if (request.status !== status) return request;
  const workflow = await workflows.get(actor, request.workflowInstanceId!);
  const { skipFinanceInvoice, ...actionExtra } = extra;
  const after = await procurement.act(actor, request.id, {
    action: 'APPROVE',
    rowVersion: workflow.rowVersion,
    ...actionExtra,
  });
  const deps = flowByRequest.get(request.id);
  if (after.status === 'AWAITING_ED_FINANCE' && !after.invoice && deps && skipFinanceInvoice !== true) {
    return attachFinanceInvoice(deps, after);
  }
  return after;
}

export async function walkPastOpsAndMd(
  procurement: ProcurementService,
  workflows: WorkflowsService,
  ops: ActorContext,
  md: ActorContext,
  request: ProcurementView,
  extra: Record<string, unknown> = {},
): Promise<ProcurementView> {
  const afterOps = await approveIfAt(procurement, workflows, ops, request, 'AWAITING_OPERATIONS');
  return approveIfAt(procurement, workflows, md, afterOps, 'AWAITING_MD', extra);
}
