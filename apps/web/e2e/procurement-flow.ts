import { expect, type APIRequestContext } from '@playwright/test';
import { ALADE_VENDOR_ID, XYZ_VENDOR_ID } from '@nfc/shared';
import { csrfHeaders, unique } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export type SubmittedProcurement = {
  id: string;
  status: string;
  workflowInstanceId: string;
  rowVersion: number;
  entityId: string;
  requisitionId?: string | null;
};

/** Adds one priced vendor quotation to a proposal draft. */
export async function addPricedQuotation(
  officer: APIRequestContext,
  requestId: string,
  vendorId: string,
  amountKobo: number,
): Promise<{ rowVersion: number }> {
  const res = await officer.post(`${API}/api/procurement/${requestId}/quotations`, {
    headers: await csrfHeaders(officer),
    multipart: {
      vendorId,
      amountKobo: String(amountKobo),
      file: { name: `quote-${vendorId.slice(-4)}.png`, mimeType: 'image/png', buffer: PNG },
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { rowVersion: number };
}

/**
 * Prices a proposal from two vendor quotations, XYZ lowest, and awards XYZ.
 * Returns the row version to submit with.
 */
export async function quoteAndAwardLowest(
  officer: APIRequestContext,
  requestId: string,
  totalKobo: number,
): Promise<{ rowVersion: number }> {
  await addPricedQuotation(officer, requestId, XYZ_VENDOR_ID, totalKobo);
  const both = await addPricedQuotation(officer, requestId, ALADE_VENDOR_ID, totalKobo + 50_000);
  const selected = await officer.post(`${API}/api/procurement/${requestId}/vendor-selection`, {
    headers: await csrfHeaders(officer),
    data: { rowVersion: both.rowVersion, vendorId: XYZ_VENDOR_ID },
  });
  expect(selected.ok(), await selected.text()).toBeTruthy();
  return (await selected.json()) as { rowVersion: number };
}

export async function openNeedApprovedDraft(
  gm: APIRequestContext,
  officer: APIRequestContext,
  md: APIRequestContext,
  opts: {
    title?: string;
    categoryKey?: 'services' | 'equipment' | 'goods';
    quantity?: number;
  } = {},
): Promise<{ id: string; rowVersion: number; requisitionId: string; entityId: string }> {
  const gmHeaders = await csrfHeaders(gm);
  const mdHeaders = await csrfHeaders(md);
  const categories = (await (await gm.get(`${API}/api/procurement/categories`)).json()) as Array<{
    id: string;
    key: string;
  }>;
  const units = (await (await gm.get(`${API}/api/procurement/units`)).json()) as Array<{ id: string; code: string }>;
  const me = (await (await gm.get(`${API}/api/me`)).json()) as { entities: Array<{ id: string }> };
  const departments = (await (
    await gm.get(`${API}/api/entities/${me.entities[0]!.id}/departments`)
  ).json()) as Array<{ id: string }>;
  const category = categories.find((row) => row.key === (opts.categoryKey ?? 'services'))!;
  const pcs = units.find((row) => row.code === 'PCS') ?? units[0]!;
  const title = opts.title ?? `E2E need ${unique('REQ')}`;
  const created = await gm.post(`${API}/api/requisitions`, {
    headers: gmHeaders,
    data: { title, departmentId: departments[0]!.id },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const draft = (await created.json()) as { id: string; rowVersion: number };
  const saved = await gm.patch(`${API}/api/requisitions/${draft.id}`, {
    headers: gmHeaders,
    data: {
      rowVersion: draft.rowVersion,
      title,
      departmentId: departments[0]!.id,
      categoryId: category.id,
      background: 'Required for the mill programme.',
      justification: 'Replacement of worn plant.',
      prayer: 'Management is invited to approve the need.',
      requiredDate: '2026-12-20',
      deliveryLocation: 'YFZ mill stores',
      urgency: 'NORMAL',
      lines: [{ description: title, quantity: opts.quantity ?? 2, unitId: pcs.id }],
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  const afterSave = (await saved.json()) as { rowVersion: number };
  const submittedNeed = await gm.post(`${API}/api/requisitions/${draft.id}/submit`, {
    headers: gmHeaders,
    data: { rowVersion: afterSave.rowVersion, idempotencyKey: `e2e-req-${draft.id}` },
  });
  expect(submittedNeed.ok(), await submittedNeed.text()).toBeTruthy();
  const need = (await submittedNeed.json()) as {
    id: string;
    procurementRequestId: string;
    workflowInstanceId: string;
  };
  const needWf = (await (await md.get(`${API}/api/workflows/${need.workflowInstanceId}`)).json()) as {
    rowVersion: number;
  };
  const needApproved = await md.post(`${API}/api/procurement/${need.procurementRequestId}/actions`, {
    headers: mdHeaders,
    data: { action: 'APPROVE', rowVersion: needWf.rowVersion, idempotencyKey: `e2e-need-${need.id}` },
  });
  expect(needApproved.ok(), await needApproved.text()).toBeTruthy();
  const proposal = (await (await officer.get(`${API}/api/procurement/${need.procurementRequestId}`)).json()) as {
    id: string;
    rowVersion: number;
    entityId: string;
  };
  return { id: proposal.id, rowVersion: proposal.rowVersion, requisitionId: need.id, entityId: proposal.entityId };
}

export async function submitNeedApprovedProposal(
  gm: APIRequestContext,
  officer: APIRequestContext,
  md: APIRequestContext,
  opts: {
    title?: string;
    categoryKey?: 'services' | 'equipment' | 'goods';
    quantity?: number;
    unitPriceKobo?: number;
    proposedPaymentTiming?: 'before_delivery' | 'after_delivery';
  } = {},
): Promise<SubmittedProcurement> {
  const gmHeaders = await csrfHeaders(gm);
  const officerHeaders = await csrfHeaders(officer);
  const mdHeaders = await csrfHeaders(md);
  const categories = (await (await gm.get(`${API}/api/procurement/categories`)).json()) as Array<{
    id: string;
    key: string;
  }>;
  const units = (await (await gm.get(`${API}/api/procurement/units`)).json()) as Array<{ id: string; code: string }>;
  const funding = (await (await gm.get(`${API}/api/procurement/funding-sources`)).json()) as Array<{
    id: string;
    key: string;
  }>;
  const lines = (await (await gm.get(`${API}/api/budget-lines`)).json()) as Array<{ id: string; code: string }>;
  const me = (await (await gm.get(`${API}/api/me`)).json()) as { entities: Array<{ id: string }> };
  const departments = (await (
    await gm.get(`${API}/api/entities/${me.entities[0]!.id}/departments`)
  ).json()) as Array<{ id: string }>;
  const categoryKey = opts.categoryKey ?? 'services';
  const category = categories.find((row) => row.key === categoryKey)!;
  const pcs = units.find((row) => row.code === 'PCS') ?? units[0]!;
  const source = funding.find((row) => row.key === 'subsidiary_operating')!;
  const budget = lines.find((row) => row.code === 'YFZ-CAPEX') ?? lines[0]!;
  const title = opts.title ?? `E2E dual ${unique('PR')}`;
  const quantity = opts.quantity ?? 2;
  const unitPriceKobo = opts.unitPriceKobo ?? 100_000;

  const created = await gm.post(`${API}/api/requisitions`, {
    headers: gmHeaders,
    data: { title, departmentId: departments[0]!.id },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const draft = (await created.json()) as { id: string; rowVersion: number };
  const saved = await gm.patch(`${API}/api/requisitions/${draft.id}`, {
    headers: gmHeaders,
    data: {
      rowVersion: draft.rowVersion,
      title,
      departmentId: departments[0]!.id,
      categoryId: category.id,
      background: 'Required for the mill programme.',
      justification: 'Replacement of worn plant.',
      prayer: 'Management is invited to approve the need.',
      requiredDate: '2026-12-20',
      deliveryLocation: 'YFZ mill stores',
      urgency: 'NORMAL',
      lines: [{ description: title, quantity, unitId: pcs.id }],
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  const afterSave = (await saved.json()) as { rowVersion: number };
  const submittedNeed = await gm.post(`${API}/api/requisitions/${draft.id}/submit`, {
    headers: gmHeaders,
    data: { rowVersion: afterSave.rowVersion, idempotencyKey: `e2e-req-${draft.id}` },
  });
  expect(submittedNeed.ok(), await submittedNeed.text()).toBeTruthy();
  const need = (await submittedNeed.json()) as {
    id: string;
    procurementRequestId: string;
    workflowInstanceId: string;
  };

  const needWf = (await (await md.get(`${API}/api/workflows/${need.workflowInstanceId}`)).json()) as {
    rowVersion: number;
  };
  const needApproved = await md.post(`${API}/api/procurement/${need.procurementRequestId}/actions`, {
    headers: mdHeaders,
    data: { action: 'APPROVE', rowVersion: needWf.rowVersion, idempotencyKey: `e2e-need-${need.id}` },
  });
  expect(needApproved.ok(), await needApproved.text()).toBeTruthy();

  const proposal = (await (await officer.get(`${API}/api/procurement/${need.procurementRequestId}`)).json()) as {
    id: string;
    rowVersion: number;
    entityId: string;
    invoiceRequired: boolean;
  };
  const priced = await officer.patch(`${API}/api/procurement/${proposal.id}`, {
    headers: officerHeaders,
    data: {
      rowVersion: proposal.rowVersion,
      title,
      subject: title,
      departmentId: departments[0]!.id,
      categoryId: category.id,
      reason: 'Replacement of worn plant.',
      description: 'Structured line.',
      requiredDate: '2026-12-20',
      vendorId: XYZ_VENDOR_ID,
      deliveryLocation: 'YFZ mill stores',
      fundingSourceId: source.id,
      lines: [
        {
          description: title,
          categoryId: category.id,
          quantity,
          unitId: pcs.id,
          unitPriceKobo,
          budgetLineId: budget.id,
        },
      ],
      urgency: 'NORMAL',
      proposedPaymentTiming: opts.proposedPaymentTiming ?? 'before_delivery',
    },
  });
  expect(priced.ok(), await priced.text()).toBeTruthy();
  let current = (await priced.json()) as { rowVersion: number; invoiceRequired: boolean; entityId: string };

  const awarded = await quoteAndAwardLowest(officer, proposal.id, quantity * unitPriceKobo);
  current = { ...current, rowVersion: awarded.rowVersion };
  // The invoice is requested at ED Finance; `approveIfStatus` uploads it after the MD approves.
  officerByRequest.set(proposal.id, officer);

  const submitted = await officer.post(`${API}/api/procurement/${proposal.id}/submit`, {
    headers: officerHeaders,
    data: { rowVersion: current.rowVersion, idempotencyKey: `e2e-pr-${proposal.id}` },
  });
  expect(submitted.ok(), await submitted.text()).toBeTruthy();
  const body = (await submitted.json()) as SubmittedProcurement;
  return {
    ...body,
    entityId: body.entityId ?? current.entityId ?? me.entities[0]!.id,
    requisitionId: need.id,
  };
}

/** Officer sessions for requests priced here, so the MD-approval helper can upload the invoice. */
const officerByRequest = new Map<string, APIRequestContext>();

/** The Procurement Manager uploads the approved vendor's invoice while the request waits at ED Finance. */
export async function uploadFinanceInvoice(
  officer: APIRequestContext,
  requestId: string,
  amountKobo?: number,
): Promise<{ status: string; rowVersion: number; invoiceStage: string }> {
  const view = (await (await officer.get(`${API}/api/procurement/${requestId}`)).json()) as {
    vendorId: string;
    totalAmountKobo: number;
  };
  const res = await officer.post(`${API}/api/procurement/${requestId}/invoices`, {
    headers: await csrfHeaders(officer),
    multipart: {
      invoiceNumber: unique('INV'),
      invoiceDate: '2026-09-01',
      amountKobo: String(amountKobo ?? view.totalAmountKobo),
      vendorId: view.vendorId,
      file: { name: 'invoice.png', mimeType: 'image/png', buffer: PNG },
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { status: string; rowVersion: number; invoiceStage: string };
}

export async function approveIfStatus(
  actor: APIRequestContext,
  requestId: string,
  workflowId: string,
  status: string,
  extra: Record<string, unknown> = {},
) {
  const view = (await (await actor.get(`${API}/api/procurement/${requestId}`)).json()) as { status: string };
  if (view.status !== status) return view;
  const wf = (await (await actor.get(`${API}/api/workflows/${workflowId}`)).json()) as { rowVersion: number };
  const res = await actor.post(`${API}/api/procurement/${requestId}/actions`, {
    headers: await csrfHeaders(actor),
    data: { action: 'APPROVE', rowVersion: wf.rowVersion, ...extra },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const after = (await res.json()) as { status: string; rowVersion: number; invoice?: unknown };
  const officer = officerByRequest.get(requestId);
  if (after.status === 'AWAITING_ED_FINANCE' && !after.invoice && officer) {
    return uploadFinanceInvoice(officer, requestId);
  }
  return after;
}
