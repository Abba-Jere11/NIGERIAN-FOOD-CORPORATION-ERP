import type {
  BankAccountView,
  BudgetLineView,
  DepartmentView,
  EdmsPackageView,
  FinancialCheckView,
  FundingSourceView,
  MeView,
  ProcurementCategoryView,
  ProcurementInvoiceStage,
  ProcurementView,
  ProjectView,
  TimelineEventView,
  UnitOfMeasureView,
  VendorListItemView,
  WarehouseView,
  WorkflowInstanceView,
} from '@nfc/shared';
import {
  PAYMENT_TIMINGS,
  PAYMENT_TIMING_LABELS,
  amountInWords,
  canTakeProcurementAction,
  formatKobo,
  formatLagosDate,
  formatLagosDateTime,
  hasProcurementNavPermission,
} from '@nfc/shared';
import { notFound } from 'next/navigation';
import { redirect } from 'next/navigation';
import { DraftVersionProvider } from '@/components/forms/DraftVersion';
import { ActionDialog } from '@/components/ui/Dialog';
import { DefinitionList, PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Timeline } from '@/components/ui/Timeline';
import { SealBadge } from '@/components/seals/SealBadge';
import { apiFetch, ApiError } from '@/lib/api';
import { acknowledgePaymentTimingAction, changePaymentTimingAction } from '../actions';
import { ApprovalActions } from '../ApprovalActions';
import { CloseShortActions } from '../CloseShortActions';
import { CommentForm } from '../CommentForm';
import { DeliveryPanel, ShortageOverrideForm } from '../DeliveryPanel';
import { FinanceDecisionForm } from '../FinanceDecisionForm';
import { InvoiceUploadForm } from '../InvoiceUploadForm';
import { InvoiceVarianceDecision } from '../InvoiceVarianceDecision';
import { QuotationComparison } from '../QuotationComparison';
import { PaymentForm } from '../PaymentForm';
import { ProcurementActions } from '../ProcurementActions';
import { ProcurementForm } from '../ProcurementForm';
import { NextActionBanner, ProcurementTracker } from '../ProcurementTracker';
import { TransferForm } from '../TransferForm';

export const dynamic = 'force-dynamic';

const INVOICE_STAGE_TEXT: Record<ProcurementInvoiceStage, string> = {
  not_requested: 'The invoice is not requested at this stage.',
  awaiting_invoice:
    "Waiting for the selected vendor's invoice. The Procurement Manager has been asked to upload it to this record.",
  variance_pending:
    'The invoice amount differs from the approved amount. Waiting for the MD to approve the invoiced amount.',
  variance_rejected:
    'The MD rejected the invoiced amount. The Procurement Manager must upload a corrected invoice.',
  ready: 'The invoice is from the approved vendor and its amount is approved. ED Finance may continue.',
};

export default async function ProcurementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await apiFetch<MeView>('/api/me');
  if (!hasProcurementNavPermission(me.permissions)) redirect('/forbidden');

  let request: ProcurementView;
  try {
    request = await apiFetch<ProcurementView>(`/api/procurement/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  const needApproval = request.status === 'AWAITING_NEED_APPROVAL';
  const hideCosts = needApproval;
  const canPrepare =
    Boolean(request.requisitionId) &&
    request.requisitionStatus === 'NEED_APPROVED' &&
    (request.status === 'AWAITING_PREPARATION' || request.status === 'DRAFT') &&
    me.permissions.includes('procurement.prepare') &&
    (!request.preparedByUserId || request.preparedByUserId === me.ref);
  const isLegacyDraft =
    !request.requisitionId &&
    request.status === 'DRAFT' &&
    me.ref === request.originatorUserId &&
    me.permissions.includes('procurement.edit_draft');
  const isDraft = canPrepare || isLegacyDraft;
  const canVerify =
    (request.status === 'AWAITING_DELIVERY' || request.status === 'PARTIALLY_RECEIVED') &&
    me.permissions.includes('procurement.verify.delivery');
  const canPackage = me.permissions.includes('procurement.package.download');
  const canOverrideShortage = me.permissions.includes('procurement.shortage.override');
  const canPortal = me.permissions.includes('edms.portal.access');
  const [departments, categories, units, fundingSources, budgetLines, projects, vendors, timeline, workflow, closeShortWorkflow, memo, requisitionMemo, checks, accounts, edmsPackage, warehouses] =
    await Promise.all([
      apiFetch<DepartmentView[]>(`/api/entities/${request.entityId}/departments`).catch(() => []),
      apiFetch<ProcurementCategoryView[]>('/api/procurement/categories'),
      apiFetch<UnitOfMeasureView[]>('/api/procurement/units'),
      apiFetch<FundingSourceView[]>('/api/procurement/funding-sources'),
      apiFetch<BudgetLineView[]>('/api/budget-lines', { query: { entityId: request.entityId } }),
      apiFetch<ProjectView[]>('/api/projects', { query: { entityId: request.entityId } }),
      apiFetch<VendorListItemView[]>('/api/vendors'),
      apiFetch<TimelineEventView[]>('/api/timeline', {
        query: { subjectType: 'PROCUREMENT', subjectId: id },
      }).catch(() => []),
      request.workflowInstanceId
        ? apiFetch<WorkflowInstanceView>(`/api/workflows/${request.workflowInstanceId}`).catch(() => null)
        : Promise.resolve(null),
      request.closeShort?.workflowInstanceId
        ? apiFetch<WorkflowInstanceView>(`/api/workflows/${request.closeShort.workflowInstanceId}`).catch(
            () => null,
          )
        : Promise.resolve(null),
      apiFetch<{ html: string }>(`/api/procurement/${id}/memo`).catch(() => null),
      request.requisitionId
        ? apiFetch<{ html: string }>(`/api/requisitions/${request.requisitionId}/memo`).catch(() => null)
        : Promise.resolve(null),
      apiFetch<FinancialCheckView[]>(`/api/procurement/${id}/financial-checks`).catch(() => [] as FinancialCheckView[]),
      apiFetch<BankAccountView[]>('/api/bank-accounts').catch(() => [] as BankAccountView[]),
      canPortal
        ? apiFetch<EdmsPackageView | null>('/api/edms/packages', { query: { procurementId: id } }).catch(
            () => null,
          )
        : Promise.resolve(null),
      canVerify
        ? apiFetch<WarehouseView[]>('/api/inventory/warehouses', {
            query: { entityId: request.entityId },
          }).catch(() => [] as WarehouseView[])
        : Promise.resolve([] as WarehouseView[]),
    ]);
  const canFinance = me.permissions.includes('procurement.review.finance');
  const canTransfer = me.permissions.includes('finance.funding.transfer.record');
  const canPay =
    me.permissions.includes('finance.payment.execute') ||
    me.permissions.includes('finance.payment.execute.corporate');
  const atFinance = request.status === 'AWAITING_ED_FINANCE';
  const canUploadFinanceInvoice =
    atFinance &&
    !request.financialReview &&
    request.invoiceStage !== 'ready' &&
    (request.requisitionId
      ? me.permissions.includes('procurement.prepare') &&
        (!request.preparedByUserId || request.preparedByUserId === me.ref)
      : me.ref === request.originatorUserId && me.permissions.includes('procurement.edit_draft'));
  const canDecideVariance =
    atFinance &&
    request.invoiceVariance?.status === 'PENDING' &&
    me.permissions.includes('procurement.approve.final');
  const canChangeTiming =
    me.permissions.includes('procurement.approve.final') &&
    Boolean(request.finalPaymentTiming) &&
    request.payments.length === 0 &&
    !['COMPLETED', 'REJECTED', 'ARCHIVED', 'DISCARDED', 'AWAITING_MD'].includes(request.status);
  const canAckTimingStandalone =
    canFinance &&
    request.timingChangePendingAck &&
    (request.status === 'AWAITING_PAYMENT' ||
      request.status === 'FUNDING_PENDING' ||
      request.status === 'AWAITING_DELIVERY' ||
      request.status === 'PARTIALLY_RECEIVED');
  const canTakeNextAction = request.nextAction
    ? canTakeProcurementAction(
        request.nextAction,
        { ref: me.ref, permissions: me.permissions, isCorporate: me.isCorporate, entityIds: me.entities.map((e) => e.id) },
        request,
      )
    : false;

  return (
    <DraftVersionProvider rowVersion={request.rowVersion}>
      <PageHeader
        eyebrow={request.referenceNumber}
        title={request.title || 'Untitled request'}
        description={`${request.entityName ?? request.entityCode ?? ''} · originated by ${request.originatorName ?? 'the GM'}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={request.status} />
            {canPortal && edmsPackage ? (
              <a
                href={edmsPackage.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center border border-ink-300 bg-surface px-3.5 text-sm font-medium text-ink-900"
              >
                View in EDMS
              </a>
            ) : null}
          </div>
        }
      />
      {request.nextAction ? <NextActionBanner action={request.nextAction} canAct={canTakeNextAction} /> : null}
      {request.authorizedAmountKobo !== null ? (
        <p className="mb-4 text-[13px] text-ink-700">
          Delivery {request.deliveryComplete ? 'complete' : 'outstanding'} · Payment{' '}
          {request.paymentComplete ? 'complete' : 'outstanding'}
          {request.payableAmountKobo > 0
            ? ` · payable ${formatKobo(BigInt(request.payableAmountKobo))}`
            : ''}
          .
        </p>
      ) : null}
      {request.timingChangePendingAck ? (
        <p role="status" className="mb-4 border-l-2 border-warning-600 bg-warning-100 px-3 py-2 text-[13px]">
          Payment timing changed after MD approval. ED Finance must acknowledge the decision before
          payment or a funding transfer.
        </p>
      ) : null}
      {request.lastReturnReason ? (
        <p role="status" className="mb-4 border-l-2 border-warning-600 bg-warning-100 px-3 py-2 text-[13px]">
          Version {request.currentVersion} was returned
          {request.lastReturnedByName ? ` by ${request.lastReturnedByName}` : ''}
          {request.lastReturnAt ? ` on ${formatLagosDateTime(request.lastReturnAt)}` : ''}. Reason:{' '}
          {request.lastReturnReason}
        </p>
      ) : null}
      {request.clonedFromReference ? (
        <p className="mb-4 text-[13px] text-ink-600">
          Cloned from rejected request {request.clonedFromReference}.
        </p>
      ) : null}
      {request.warnings.length > 0 ? (
        <p role="status" className="mb-4 border-l-2 border-warning-600 bg-warning-100 px-3 py-2 text-[13px]">
          {request.warnings.join(' ')}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Surface id="edit">
            <SurfaceHeader title={isDraft ? 'Structured request' : 'Request details'} />
            <div className="px-4 py-3">
              {isDraft ? (
                <ProcurementForm
                  request={request}
                  departments={departments}
                  categories={categories}
                  units={units}
                  fundingSources={fundingSources}
                  budgetLines={budgetLines}
                  projects={projects}
                  vendors={vendors}
                  prepareMode={canPrepare}
                />
              ) : (
                <>
                <div className="mb-4 overflow-x-auto">
                  <table className="w-full text-left text-[13px]">
                    <thead>
                      <tr className="border-b border-ink-200 text-[12px] text-ink-600">
                        <th className="py-1 pr-2">Line</th>
                        <th className="py-1 pr-2">Description</th>
                        <th className="py-1 pr-2">Category</th>
                        <th className="py-1 pr-2">Qty</th>
                        {hideCosts ? null : <th className="py-1 pr-2">Unit price</th>}
                        {hideCosts ? null : <th className="py-1 pr-2">Amount</th>}
                        {hideCosts ? null : <th className="py-1">Budget</th>}
                        <th className="py-1">Second batch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {request.lines.map((line) => (
                        <tr key={line.id} className="border-b border-ink-100">
                          <td className="py-1 pr-2">{line.lineNumber}</td>
                          <td className="py-1 pr-2">{line.description || '—'}</td>
                          <td className="py-1 pr-2">{line.categoryName ?? '—'}</td>
                          <td className="py-1 pr-2">
                            {line.quantity} {line.unitCode ?? ''}
                          </td>
                          {hideCosts ? null : (
                            <td className="py-1 pr-2">
                              {line.unitPriceKobo > 0 ? formatKobo(BigInt(line.unitPriceKobo)) : '—'}
                            </td>
                          )}
                          {hideCosts ? null : (
                            <td className="py-1 pr-2">
                              {line.lineAmountKobo > 0 ? formatKobo(BigInt(line.lineAmountKobo)) : '—'}
                            </td>
                          )}
                          {hideCosts ? null : (
                            <td className="py-1">
                              {line.budgetLineCode ? `${line.budgetLineCode} — ${line.budgetLineName}` : '—'}
                            </td>
                          )}
                          <td className="py-1">
                            {line.secondBatchDueOn ? formatLagosDate(line.secondBatchDueOn) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <DefinitionList
                  items={[
                    { label: 'Subject', value: request.subject ?? '—' },
                    { label: 'Department', value: request.departmentName ?? '—' },
                    hideCosts
                      ? { label: 'Need', value: 'Awaiting MD need-approval. Costs are hidden.' }
                      : {
                          label: 'Total',
                          value:
                            request.totalAmountKobo === null || request.totalAmountKobo <= 0
                              ? '—'
                              : `${formatKobo(BigInt(request.totalAmountKobo))} (${amountInWords(BigInt(request.totalAmountKobo))})`,
                        },
                    {
                      label: 'Required date',
                      value: request.requiredDate ? formatLagosDate(request.requiredDate) : '—',
                    },
                    { label: 'Vendor', value: hideCosts ? '—' : request.vendorName ?? '—' },
                    { label: 'CAC', value: hideCosts ? '—' : request.vendorCac ?? '—' },
                    {
                      label: 'Vendor contact',
                      value: [request.vendorContactName, request.vendorContactPhone, request.vendorContactEmail]
                        .filter(Boolean)
                        .join(' · ') || '—',
                    },
                    { label: 'Delivery', value: request.deliveryLocation ?? '—' },
                    { label: 'Funding', value: request.fundingSourceLabel ?? '—' },
                    {
                      label: 'Proposed payment timing',
                      value: request.proposedPaymentTiming
                        ? PAYMENT_TIMING_LABELS[request.proposedPaymentTiming]
                        : '—',
                    },
                    {
                      label: 'Final payment timing',
                      value: request.finalPaymentTiming
                        ? PAYMENT_TIMING_LABELS[request.finalPaymentTiming]
                        : '—',
                    },
                    { label: 'Urgency', value: request.urgency },
                    { label: 'Reason', value: request.reason ?? '—' },
                    { label: 'Description', value: request.description ?? '—' },
                  ]}
                />
                </>
              )}
            </div>
          </Surface>

          {request.requisitionId ? (
            <Surface>
              <SurfaceHeader title="Need memorandum" description="The GM requisition. No amounts." />
              <div className="px-4 py-3">
                {requisitionMemo ? (
                  <iframe
                    title="Requisition memo"
                    className="h-[360px] w-full border border-ink-200"
                    srcDoc={requisitionMemo.html}
                  />
                ) : (
                  <EmptyState title="Need memo not ready" description="The requisition memo appears after submit." />
                )}
                <p className="mt-2 text-[12px]">
                  <a className="underline" href={`/requisitions/${request.requisitionId}`}>
                    Open requisition {request.requisitionReference}
                  </a>
                </p>
              </div>
            </Surface>
          ) : null}

          {hideCosts ? null : (
            <>
          <Surface>
            <SurfaceHeader title="Generated memo" description="Produced from the structured fields. There is no free-text memo." />
            <div className="px-4 py-3">
              {memo ? (
                <iframe title="Memo preview" className="h-[480px] w-full border border-ink-200" srcDoc={memo.html} />
              ) : (
                <EmptyState title="Memo not ready" description="Save the draft to preview the generated memorandum." />
              )}
              <p className="mt-2 text-[12px]">
                <a className="underline" href={`/procurement/${id}/memo.pdf`}>
                  Download PDF
                </a>
                {canPackage ? (
                  <>
                    {' '}
                    ·{' '}
                    <a className="underline" href={`/procurement/${id}/record.pdf`}>
                      Procurement record
                    </a>{' '}
                    ·{' '}
                    <a className="underline" href={`/procurement/${id}/package`}>
                      Package ZIP
                    </a>
                  </>
                ) : null}
              </p>
            </div>
          </Surface>

          {request.requisitionId ? (
            <div id="price-comparison">
              <Surface>
                <SurfaceHeader
                  title="Vendor quotations and price comparison"
                  description="Quotations from active registered vendors, compared side by side. The lowest total is recommended."
                />
                <div className="px-4 py-3">
                  <QuotationComparison request={request} vendors={vendors} editable={isDraft} />
                </div>
              </Surface>
            </div>
          ) : null}

          <div id="invoice">
          <Surface>
            <SurfaceHeader
              title="Invoice"
              description={
                request.requisitionId
                  ? "The selected vendor's invoice is requested once the MD approves, at the ED Finance stage."
                  : 'Supporting evidence. Separate from the memo.'
              }
            />
            <div className="px-4 py-3 space-y-3">
              {request.invoice ? (
                <p className="text-[13px]">
                  {request.invoice.invoiceNumber} dated {formatLagosDate(request.invoice.invoiceDate)} for{' '}
                  {formatKobo(BigInt(request.invoice.amountKobo))}
                  {request.invoice.vendorName ? ` · from ${request.invoice.vendorName}` : ''}
                  {request.invoice.documentReference ? (
                    <>
                      {' · '}
                      <a className="underline" href={`/documents/${request.invoice.documentId}`}>
                        {request.invoice.documentReference}
                      </a>
                    </>
                  ) : null}
                </p>
              ) : (
                <p className="text-[13px] text-ink-600">
                  {request.requisitionId && isDraft
                    ? 'No invoice is needed to submit this proposal. It will be requested at the ED Finance stage.'
                    : 'No invoice attached.'}
                </p>
              )}
              {atFinance ? (
                <p
                  role="status"
                  data-testid="invoice-stage"
                  className={
                    request.invoiceStage === 'ready'
                      ? 'border-l-2 border-accent-700 bg-accent-50 px-3 py-2 text-[13px]'
                      : 'border-l-2 border-warning-600 bg-warning-100 px-3 py-2 text-[13px]'
                  }
                >
                  {INVOICE_STAGE_TEXT[request.invoiceStage]}
                  {request.invoiceVariance?.status === 'REJECTED' && request.invoiceVariance.reason
                    ? ` Reason: ${request.invoiceVariance.reason}`
                    : ''}
                </p>
              ) : null}
              {canDecideVariance && request.invoiceVariance ? (
                <InvoiceVarianceDecision requestId={request.id} variance={request.invoiceVariance} />
              ) : null}
              {isDraft && !request.requisitionId ? (
                <InvoiceUploadForm requestId={request.id} replacing={Boolean(request.invoice)} />
              ) : null}
              {canUploadFinanceInvoice && request.vendorId ? (
                <InvoiceUploadForm
                  requestId={request.id}
                  replacing={Boolean(request.invoice)}
                  vendor={{ id: request.vendorId, name: request.vendorName }}
                />
              ) : null}
            </div>
          </Surface>
          </div>
            </>
          )}

          {request.receipts.length > 0 || request.deliveryNotes.length > 0 ? (
            <Surface id="deliveries" padded={false}>
              <SurfaceHeader
                title="Deliveries"
                description="Each delivery is recorded once; every item on it is verified separately. Corrections supersede; the original stays visible."
              />
              <div className="space-y-4 px-4 py-3 text-[13px]">
                {request.deliveries.map((delivery) => (
                  <div key={delivery.id} data-testid="delivery-record">
                    <p className="font-medium text-ink-900">
                      {delivery.referenceNumber} · {formatLagosDate(delivery.receivedDate)} · {delivery.location} ·{' '}
                      {delivery.documentKind.replaceAll('_', ' ')}
                      {delivery.createdByName ? ` · verified by ${delivery.createdByName}` : ''}
                    </p>
                    {delivery.documents.length > 0 ? (
                      <p className="text-ink-600">
                        {delivery.documents.map((doc, index) => (
                          <span key={doc.documentId}>
                            {index > 0 ? ', ' : ''}
                            <a className="underline" href={`/documents/${doc.documentId}`}>
                              {doc.title ?? doc.kind.replaceAll('_', ' ')}
                            </a>
                          </span>
                        ))}
                      </p>
                    ) : null}
                    {delivery.notes ? <p className="text-ink-700">{delivery.notes}</p> : null}
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-ink-200 text-[12px] text-ink-600">
                            <th className="py-1 pr-2">Item</th>
                            <th className="py-1 pr-2">Ordered</th>
                            <th className="py-1 pr-2">Received</th>
                            <th className="py-1 pr-2">Accepted</th>
                            <th className="py-1 pr-2">Rejected</th>
                            <th className="py-1">Remarks</th>
                          </tr>
                        </thead>
                        <tbody>
                          {delivery.items.map((item) => (
                            <tr key={item.id} className="border-b border-ink-100 align-top">
                              <td className="py-1 pr-2">
                                {item.lineNumber ?? '—'}. {item.description ?? ''}
                                <span className="block text-[11px] text-ink-500">
                                  {item.referenceNumber}
                                  {item.superseded ? ' · superseded' : ''}
                                  {item.supersedesId ? ' · correction' : ''}
                                </span>
                              </td>
                              <td className="py-1 pr-2 tabular">{item.quantityOrdered}</td>
                              <td className="py-1 pr-2 tabular">{item.quantityReceived}</td>
                              <td className="py-1 pr-2 tabular">{item.quantityAccepted}</td>
                              <td className="py-1 pr-2 tabular">{item.quantityRejected}</td>
                              <td className="py-1">
                                {[item.rejectReason ? `Rejected: ${item.rejectReason}` : null, item.conditionNotes]
                                  .filter(Boolean)
                                  .join(' · ') || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
                {request.receipts.some((receipt) => !receipt.deliveryId) ? (
                  <ul className="divide-y divide-ink-100">
                    {request.receipts
                      .filter((receipt) => !receipt.deliveryId)
                      .map((receipt) => (
                        <li key={receipt.id} className="py-2">
                          {receipt.referenceNumber} · item {receipt.lineNumber ?? '—'} · received {receipt.quantityReceived},
                          accepted {receipt.quantityAccepted} of {receipt.quantityOrdered}, rejected {receipt.quantityRejected}
                          {receipt.superseded ? ' · superseded' : ''}
                          {receipt.supersedesId ? ' · correction' : ''}
                        </li>
                      ))}
                  </ul>
                ) : null}
                {request.deliveryNotes.map((note) => (
                  <p key={note.id} className="text-ink-700">
                    Not received · {note.note}
                  </p>
                ))}
              </div>
            </Surface>
          ) : null}

          {request.documents.length > 0 ? (
            <Surface>
              <SurfaceHeader title="Documents and access" />
              <ul className="divide-y divide-ink-100 px-4 py-2 text-[13px]">
                {request.documents.map((doc) => (
                  <li key={doc.documentId} className="py-2">
                    <a className="underline" href={`/documents/${doc.documentId}`}>
                      {doc.referenceNumber}
                    </a>{' '}
                    · {doc.title}
                    {doc.kind ? ` · ${doc.kind}` : ''}
                    {doc.access[0] ? (
                      <span className="block text-ink-600">
                        Last access {doc.access[0].action} {doc.access[0].actorName ?? ''}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Surface>
          ) : null}
        </div>

        <div className="space-y-4">
          {request.progress.length > 0 ? (
            <Surface padded={false}>
              <SurfaceHeader
                title="Procurement tracker"
                description={
                  request.finalPaymentTiming
                    ? `${PAYMENT_TIMING_LABELS[request.finalPaymentTiming]}. Steps follow this arrangement.`
                    : 'Steps update as the request moves.'
                }
              />
              <div className="px-4 py-3">
                <ProcurementTracker steps={request.progress} />
              </div>
            </Surface>
          ) : null}
          <Surface id="actions">
            <SurfaceHeader title="Actions" />
            <div className="space-y-3 px-4 py-3">
              {workflow ? (
                <ApprovalActions
                  requestId={request.id}
                  workflow={workflow}
                  proposedPaymentTiming={request.proposedPaymentTiming}
                />
              ) : null}
              {canChangeTiming ? (
                <ActionDialog
                  triggerLabel="Change payment timing"
                  title="Change payment timing"
                  submitLabel="Change timing"
                  successMessage="Payment timing updated."
                  action={changePaymentTimingAction}
                  requireReason
                  hiddenFields={{
                    requestId: request.id,
                    rowVersion: String(request.rowVersion),
                  }}
                >
                  <fieldset className="space-y-2">
                    <legend className="text-[12px] font-semibold text-ink-700">New payment timing</legend>
                    {PAYMENT_TIMINGS.filter((timing) => timing !== request.finalPaymentTiming).map(
                      (timing) => (
                        <label key={timing} className="flex items-start gap-2 text-[13px] text-ink-800">
                          <input
                            type="radio"
                            name="timing"
                            value={timing}
                            required
                            defaultChecked
                            className="mt-1"
                          />
                          <span>{PAYMENT_TIMING_LABELS[timing]}</span>
                        </label>
                      ),
                    )}
                  </fieldset>
                </ActionDialog>
              ) : null}
              {canAckTimingStandalone ? (
                <ActionDialog
                  triggerLabel="Acknowledge payment timing"
                  title="Acknowledge payment timing"
                  submitLabel="Acknowledge"
                  successMessage="Payment timing acknowledged."
                  action={acknowledgePaymentTimingAction}
                  hiddenFields={{
                    requestId: request.id,
                    rowVersion: String(request.rowVersion),
                  }}
                >
                  <p className="text-[13px] text-ink-800">
                    Confirm the MD payment-timing decision:{' '}
                    {request.finalPaymentTiming
                      ? PAYMENT_TIMING_LABELS[request.finalPaymentTiming]
                      : '—'}
                    .
                  </p>
                </ActionDialog>
              ) : null}
              {closeShortWorkflow ? (
                <CloseShortActions requestId={request.id} workflow={closeShortWorkflow} />
              ) : null}
              <ProcurementActions request={request} />
            </div>
          </Surface>
          {canFinance && request.status === 'AWAITING_ED_FINANCE' && workflow ? (
            <Surface id="finance">
              <SurfaceHeader title="Financial checks" description="Computed from live records. Approving stores this snapshot." />
              <ul className="divide-y divide-ink-100 px-4 py-2 text-[13px]">
                {(request.financialReview?.checks ?? checks).map((check) => (
                  <li key={check.key} className="py-2">
                    <p className="font-medium text-ink-900">
                      {check.label} · {check.result}
                    </p>
                    <p className="text-ink-600">{check.summary}</p>
                    {check.href ? (
                      <a className="underline" href={check.href}>
                        Open
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="px-4 py-3">
                {request.invoiceStage === 'ready' ? (
                  <FinanceDecisionForm
                    requestId={request.id}
                    workflow={workflow}
                    checks={checks}
                    accounts={accounts}
                    suggestedRoute={request.fundingSourceKey}
                    finalPaymentTiming={request.finalPaymentTiming}
                    timingChangePendingAck={request.timingChangePendingAck}
                  />
                ) : (
                  <div
                    role="status"
                    data-testid="finance-blocked"
                    className="space-y-2 border-l-2 border-warning-600 bg-warning-100 px-3 py-2 text-[13px]"
                  >
                    <p className="font-medium text-ink-900">Approve funding is not available yet.</p>
                    <p>{INVOICE_STAGE_TEXT[request.invoiceStage]}</p>
                    <p>
                      Approved amount{' '}
                      {request.totalAmountKobo === null ? '—' : formatKobo(BigInt(request.totalAmountKobo))}
                      {request.invoice ? ` · invoice ${formatKobo(BigInt(request.invoice.amountKobo))}` : ''}.{' '}
                      <a className="underline" href="#invoice">
                        {request.invoice ? 'View invoice' : 'Go to the invoice section'}
                      </a>
                    </p>
                  </div>
                )}
              </div>
            </Surface>
          ) : null}
          {canTransfer && request.status === 'FUNDING_PENDING' ? (
            <Surface id="payment">
              <SurfaceHeader title="Record funding transfer" description="Route C. Creates a TRF reference and notifies the Finance Head." />
              <div className="px-4 py-3">
                <TransferForm request={request} accounts={accounts} />
              </div>
            </Surface>
          ) : null}
          {canVerify ? (
            <Surface id="delivery">
              <SurfaceHeader
                title="Delivery verification"
                description="Enter the delivery details once, then verify each item. Completing the request needs delivery and payment."
              />
              <div className="px-4 py-3">
                <p className="mb-3 text-[13px] text-ink-700">
                  Delivery {request.deliveryComplete ? 'complete' : 'outstanding'} · Payment{' '}
                  {request.paymentComplete ? 'complete' : 'outstanding'}
                  {request.payableAmountKobo > 0
                    ? ` · payable ${formatKobo(BigInt(request.payableAmountKobo))}`
                    : ''}
                  .
                </p>
                <DeliveryPanel request={request} warehouses={warehouses} />
              </div>
            </Surface>
          ) : null}
          {canOverrideShortage && request.lines.some((line) => line.secondBatchDueOn) ? (
            <Surface>
              <SurfaceHeader
                title="Second-batch date"
                description="The locked date can be corrected with a recorded reason. This does not reopen delivery."
              />
              <div className="px-4 py-3">
                <ShortageOverrideForm request={request} />
              </div>
            </Surface>
          ) : null}
          {canPay && request.payableAmountKobo > 0 ? (
            <Surface id="payment">
              <SurfaceHeader
                title="Record vendor payment"
                description="Amount defaults to the payable figure. A smaller positive slice is allowed."
              />
              <div className="px-4 py-3">
                <PaymentForm request={request} accounts={accounts} />
              </div>
            </Surface>
          ) : null}
          {request.financialReview ? (
            <Surface padded={false}>
              <SurfaceHeader title="Stored finance snapshot" />
              <div className="px-4 py-3 text-[13px]">
                <p>
                  Route {request.financialReview.fundingRoute.replaceAll('_', ' ')} · authorized{' '}
                  {formatKobo(BigInt(request.financialReview.authorizedAmountKobo))}
                </p>
                {request.financialReview.overrideReason ? (
                  <p>Override: {request.financialReview.overrideReason}</p>
                ) : null}
              </div>
            </Surface>
          ) : null}
          {request.transfers.length > 0 || request.payments.length > 0 ? (
            <Surface padded={false}>
              <SurfaceHeader title="Funding and payments" />
              <ul className="divide-y divide-ink-100 px-4 py-2 text-[13px]">
                {request.transfers.map((transfer) => (
                  <li key={transfer.id} className="py-2">
                    {transfer.referenceNumber} · {formatKobo(BigInt(transfer.amountKobo))} · {transfer.bankReference}
                  </li>
                ))}
                {request.payments.map((payment) => (
                  <li key={payment.id} className="py-2">
                    {payment.referenceNumber} · {formatKobo(BigInt(payment.amountKobo))}
                    {payment.reversedAt ? ' · reversed' : ''}
                  </li>
                ))}
              </ul>
            </Surface>
          ) : null}
          {request.versions.length > 0 ? (
            <Surface padded={false}>
              <SurfaceHeader title="Version history" />
              <ol className="divide-y divide-ink-100 px-4 py-2 text-[13px]">
                {request.versions.map((version) => (
                  <li key={version.versionNumber} className="py-2">
                    <p className="font-medium text-ink-900">Version {version.versionNumber}</p>
                    {version.submittedAt ? (
                      <p className="text-ink-600">
                        Submitted {formatLagosDateTime(version.submittedAt)}
                        {version.submittedByName ? ` by ${version.submittedByName}` : ''}.
                      </p>
                    ) : (
                      <p className="text-ink-600">Editable draft.</p>
                    )}
                    {version.returnReason ? (
                      <p className="text-ink-700">
                        Returned{version.returnedByName ? ` by ${version.returnedByName}` : ''}
                        {version.returnedAt ? ` on ${formatLagosDateTime(version.returnedAt)}` : ''}. Reason:{' '}
                        {version.returnReason}
                      </p>
                    ) : null}
                    {version.rejectReason ? (
                      <p className="text-ink-700">
                        Rejected{version.rejectedByName ? ` by ${version.rejectedByName}` : ''}. Reason:{' '}
                        {version.rejectReason}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </Surface>
          ) : null}
          {request.relatedHistory.length > 0 || request.vendorSpendToDateKobo > 0 ? (
            <Surface padded={false}>
              <SurfaceHeader
                title="Vendor history"
                description={
                  request.vendorSpendToDateKobo > 0
                    ? `Spend to date with this vendor at ${request.entityCode ?? 'this subsidiary'}: ${formatKobo(BigInt(request.vendorSpendToDateKobo))}`
                    : 'Earlier submitted requests for this vendor at this subsidiary.'
                }
              />
              <ul className="divide-y divide-ink-100 px-4 py-2 text-[13px]">
                {request.relatedHistory.map((item) => (
                  <li key={item.id} className="py-2">
                    <a className="underline" href={`/procurement/${item.id}`}>
                      {item.referenceNumber}
                    </a>{' '}
                    · {item.title} · {item.status}
                  </li>
                ))}
              </ul>
            </Surface>
          ) : null}
          <Surface>
            <SurfaceHeader title="Seal" />
            <div className="space-y-2 px-4 py-3">
              {workflow?.seals?.length ? (
                workflow.seals.map((seal) => <SealBadge key={seal.id} seal={seal} />)
              ) : (
                <p className="text-[13px] text-ink-600">The GM seal is applied on submission.</p>
              )}
            </div>
          </Surface>
          <Surface padded={false}>
            <SurfaceHeader title="Timeline" />
            <div className="px-4 py-3">
              <Timeline
                entries={timeline.map((event) => ({
                  id: event.id,
                  occurredAt: event.occurredAt,
                  actor: event.actor,
                  text: event.text,
                  href: event.href,
                }))}
              />
            </div>
          </Surface>
          <Surface>
            <SurfaceHeader title="Comments" />
            <div className="space-y-2 px-4 py-3">
              {request.comments.length === 0 ? (
                <p className="text-[13px] text-ink-600">No comments yet.</p>
              ) : (
                request.comments.map((comment) => (
                  <p key={comment.id} className="text-[13px]">
                    <span className="font-medium">{comment.createdByName ?? comment.createdBy}</span>{' '}
                    <span className="text-ink-500">{formatLagosDateTime(comment.createdAt)}</span>
                    <br />
                    {comment.body}
                  </p>
                ))
              )}
              <CommentForm requestId={request.id} />
            </div>
          </Surface>
        </div>
      </div>
    </DraftVersionProvider>
  );
}
