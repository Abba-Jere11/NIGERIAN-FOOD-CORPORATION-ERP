import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { ActorContext } from '@nfc/db';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { ActorOnly, RequirePermission } from '../auth/require-permission.decorator';
import { CurrentActor } from '../auth/current-actor.decorator';
import { ValidationFailedError } from '../common/errors/domain-error';
import { zodPipe } from '../common/validation/zod-validation.pipe';
import { DocumentsService } from '../documents/documents.service';
import { BankAccountsService } from './bank-accounts.service';
import { DeliveryService } from './delivery.service';
import { FinancialChecksService } from './financial-checks.service';
import { PaymentsService } from './payments.service';
import {
  acknowledgePaymentTimingSchema,
  changePaymentTimingSchema,
  closeShortSchema,
  commentSchema,
  completePaymentSchema,
  deliveryNoteSchema,
  createBankAccountSchema,
  createBudgetLineSchema,
  createProcurementSchema,
  createRequisitionSchema,
  createProjectSchema,
  cloneProcurementSchema,
  discardProcurementSchema,
  invoiceMetaSchema,
  invoiceVarianceDecisionSchema,
  listProcurementSchema,
  overrideShortageDeadlineSchema,
  procurementActionSchema,
  quotationMetaSchema,
  selectQuotedVendorSchema,
  recordDeliverySchema,
  recordReceiptSchema,
  recordTransferSchema,
  reversePaymentSchema,
  supersedeReceiptSchema,
  submitProcurementSchema,
  updateBankAccountSchema,
  updateBudgetLineSchema,
  updateProcurementSchema,
  updateRequisitionSchema,
  type AcknowledgePaymentTimingInput,
  type ChangePaymentTimingInput,
  type CloneProcurementInput,
  type CloseShortInput,
  type CommentInput,
  type CompletePaymentInput,
  type CreateBankAccountInput,
  type CreateBudgetLineInput,
  type CreateProcurementInput,
  type CreateRequisitionInput,
  type CreateProjectInput,
  type DeliveryNoteInput,
  type DiscardProcurementInput,
  type ListProcurementQuery,
  type OverrideShortageDeadlineInput,
  type InvoiceVarianceDecisionInput,
  type ProcurementActionInput,
  type SelectQuotedVendorInput,
  type RecordDeliveryInput,
  type RecordReceiptInput,
  type RecordTransferInput,
  type ReversePaymentInput,
  type SupersedeReceiptInput,
  type SubmitProcurementInput,
  type UpdateBankAccountInput,
  type UpdateBudgetLineInput,
  type UpdateProcurementInput,
  type UpdateRequisitionInput,
} from './procurement.dto';
import { ProcurementService } from './procurement.service';
import { RequisitionsService } from './requisitions.service';

@Controller()
export class ProcurementController {
  constructor(
    private readonly procurement: ProcurementService,
    private readonly requisitions: RequisitionsService,
    private readonly documents: DocumentsService,
    private readonly checks: FinancialChecksService,
    private readonly banks: BankAccountsService,
    private readonly payments: PaymentsService,
    private readonly delivery: DeliveryService,
  ) {}

  @Get('api/requisitions')
  @ActorOnly()
  listRequisitions(@CurrentActor() actor: ActorContext) {
    return this.requisitions.list(actor);
  }

  @Post('api/requisitions')
  @RequirePermission('requisition.create')
  createRequisition(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createRequisitionSchema)) body: CreateRequisitionInput,
  ) {
    return this.requisitions.create(actor, body);
  }

  @Get('api/requisitions/:id/memo')
  @ActorOnly()
  requisitionMemo(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.requisitions.memoHtml(actor, id);
  }

  @Get('api/requisitions/:id/memo.pdf')
  @ActorOnly()
  async requisitionMemoPdf(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.requisitions.memoPdf(actor, id);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    response.send(buffer);
  }

  @Get('api/requisitions/:id')
  @ActorOnly()
  getRequisition(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.requisitions.get(actor, id);
  }

  @Patch('api/requisitions/:id')
  @RequirePermission('requisition.edit_draft')
  updateRequisition(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateRequisitionSchema)) body: UpdateRequisitionInput,
  ) {
    return this.requisitions.update(actor, id, body);
  }

  @Post('api/requisitions/:id/submit')
  @RequirePermission('requisition.submit')
  submitRequisition(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(submitProcurementSchema)) body: SubmitProcurementInput,
  ) {
    return this.requisitions.submit(actor, id, body);
  }

  @Post('api/requisitions/:id/discard')
  @RequirePermission('requisition.discard_draft')
  discardRequisition(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(discardProcurementSchema)) body: DiscardProcurementInput,
  ) {
    return this.requisitions.discard(actor, id, body);
  }

  @Get('api/procurement/categories')
  @ActorOnly()
  categories(@CurrentActor() actor: ActorContext) {
    return this.procurement.categories(actor);
  }

  @Get('api/procurement/units')
  @ActorOnly()
  units(@CurrentActor() actor: ActorContext) {
    return this.procurement.units(actor);
  }

  @Get('api/procurement/funding-sources')
  @ActorOnly()
  funding(@CurrentActor() actor: ActorContext) {
    return this.procurement.fundingSources(actor);
  }

  @Get('api/procurement/urgencies')
  @ActorOnly()
  urgencies(@CurrentActor() actor: ActorContext) {
    return this.procurement.urgencies(actor);
  }

  @Get('api/bank-accounts')
  @ActorOnly()
  bankAccounts(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.banks.list(actor, entityId);
  }

  @Post('api/bank-accounts')
  @RequirePermission('finance.bank_account.manage')
  createBankAccount(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createBankAccountSchema)) body: CreateBankAccountInput,
  ) {
    return this.banks.create(actor, body);
  }

  @Patch('api/bank-accounts/:id')
  @RequirePermission('finance.bank_account.manage')
  updateBankAccount(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateBankAccountSchema)) body: UpdateBankAccountInput,
  ) {
    return this.banks.updateBalance(actor, id, body);
  }

  @Post('api/funding-transfers')
  @RequirePermission('finance.funding.transfer.record')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 26 * 1024 * 1024 } }),
  )
  async recordTransfer(
    @CurrentActor() actor: ActorContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, string>,
  ) {
    if (!file) throw new ValidationFailedError('A transfer proof file is required.');
    const parsed: RecordTransferInput = recordTransferSchema.parse({
      requestId: body.requestId,
      sourceAccountId: body.sourceAccountId,
      destinationAccountId: body.destinationAccountId,
      amountKobo: Number(body.amountKobo),
      purpose: body.purpose,
      transferDate: body.transferDate,
      transferMethod: body.transferMethod,
      bankReference: body.bankReference,
    });
    const current = await this.procurement.get(actor, parsed.requestId);
    const uploaded = await this.documents.upload(actor, {
      title: `Transfer proof ${parsed.bankReference}`,
      category: 'funding_transfer',
      context: 'procurement',
      entityId: current.entityId,
      ownerType: 'procurement_request',
      ownerId: parsed.requestId,
      file: { buffer: file.buffer, originalname: file.originalname },
    });
    return this.payments.recordTransfer(actor, { ...parsed, proofDocumentId: uploaded.id });
  }

  @Get('api/projects')
  @ActorOnly()
  projects(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.procurement.projects(actor, entityId);
  }

  @Post('api/projects')
  @ActorOnly()
  createProject(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createProjectSchema)) body: CreateProjectInput,
  ) {
    return this.procurement.createProject(actor, body);
  }

  @Get('api/budget-lines')
  @ActorOnly()
  budgetLines(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.procurement.budgetLines(actor, entityId);
  }

  @Post('api/budget-lines')
  @ActorOnly()
  createBudgetLine(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createBudgetLineSchema)) body: CreateBudgetLineInput,
  ) {
    return this.procurement.createBudgetLine(actor, body);
  }

  @Patch('api/budget-lines/:id')
  @ActorOnly()
  updateBudgetLine(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateBudgetLineSchema)) body: UpdateBudgetLineInput,
  ) {
    return this.procurement.updateBudgetLine(actor, id, body);
  }

  @Get('api/procurement/reports')
  @RequirePermission('procurement.report.view')
  reports(@CurrentActor() actor: ActorContext) {
    return this.delivery.reports(actor);
  }

  @Get('api/procurement')
  @ActorOnly()
  list(
    @CurrentActor() actor: ActorContext,
    @Query(zodPipe(listProcurementSchema)) query: ListProcurementQuery,
  ) {
    return this.procurement.list(actor, query);
  }

  @Get('api/procurement/my-actions')
  @ActorOnly()
  myActions(@CurrentActor() actor: ActorContext) {
    return this.procurement.myActions(actor);
  }

  @Get('api/procurement/finance-overrides')
  @ActorOnly()
  financeOverrides(@CurrentActor() actor: ActorContext) {
    return this.procurement.listFinanceOverrides(actor);
  }

  @Get('api/procurement/payments/recent')
  @ActorOnly()
  recentPayments(@CurrentActor() actor: ActorContext, @Query('limit') limit?: string) {
    const parsed = limit ? Number(limit) : 15;
    return this.procurement.listRecentPayments(actor, Number.isFinite(parsed) ? parsed : 15);
  }

  @Post('api/procurement')
  @RequirePermission('procurement.prepare')
  create(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createProcurementSchema)) body: CreateProcurementInput,
  ) {
    return this.procurement.create(actor, body);
  }

  @Get('api/procurement/:id/financial-checks')
  @ActorOnly()
  financialChecks(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.checks.evaluate(actor, id);
  }

  @Get('api/procurement/:id/documents')
  @ActorOnly()
  procurementDocuments(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.delivery.listDocuments(actor, id);
  }

  @Get('api/procurement/:id/package')
  @ActorOnly()
  async packageZip(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.delivery.packageZip(actor, id);
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.send(buffer);
  }

  @Get('api/procurement/:id/record.pdf')
  @ActorOnly()
  async recordPdf(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.delivery.recordPdf(actor, id);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    response.send(buffer);
  }

  @Post('api/procurement/:id/delivery-notes')
  @RequirePermission('procurement.verify.delivery')
  deliveryNote(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(deliveryNoteSchema)) body: DeliveryNoteInput,
  ) {
    return this.delivery.recordDeliveryNote(actor, id, body.note);
  }

  @Post('api/procurement/:id/deliveries')
  @RequirePermission('procurement.grn.record')
  recordDelivery(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(recordDeliverySchema)) body: RecordDeliveryInput,
  ) {
    return this.delivery.recordDelivery(actor, id, body);
  }

  @Post('api/procurement/:id/receipts')
  @RequirePermission('procurement.grn.record')
  recordReceipt(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(recordReceiptSchema)) body: RecordReceiptInput,
  ) {
    return this.delivery.recordReceipt(actor, id, body);
  }

  @Post('api/procurement/:id/receipts/:grnId/supersede')
  @RequirePermission('procurement.grn.record')
  supersedeReceipt(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('grnId', ParseUUIDPipe) grnId: string,
    @Body(zodPipe(supersedeReceiptSchema)) body: SupersedeReceiptInput,
  ) {
    return this.delivery.supersedeReceipt(actor, id, grnId, body);
  }

  @Post('api/procurement/:id/close-short')
  @RequirePermission('procurement.close_short.request')
  closeShort(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(closeShortSchema)) body: CloseShortInput,
  ) {
    return this.delivery.requestCloseShort(actor, id, body.reason);
  }

  @Patch('api/procurement/:id/shortage-deadline')
  @RequirePermission('procurement.shortage.override')
  overrideShortageDeadline(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(overrideShortageDeadlineSchema)) body: OverrideShortageDeadlineInput,
  ) {
    return this.delivery.overrideShortageDeadline(actor, id, body);
  }

  @Post('api/procurement/:id/complete')
  @RequirePermission('procurement.verify.delivery')
  complete(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.delivery.complete(actor, id);
  }

  @Post('api/procurement/:id/payments')
  @ActorOnly()
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 26 * 1024 * 1024 } }),
  )
  async completePayment(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, string>,
  ) {
    const parsed: CompletePaymentInput = completePaymentSchema.parse({
      payingAccountId: body.payingAccountId,
      amountKobo: body.amountKobo ? Number(body.amountKobo) : undefined,
      method: body.method,
      bankReference: body.bankReference,
      paymentDate: body.paymentDate,
      idempotencyKey: body.idempotencyKey,
    });
    const current = await this.procurement.get(actor, id);
    let proofDocumentId: string | null = null;
    if (file) {
      const uploaded = await this.documents.upload(actor, {
        title: `Payment proof ${parsed.bankReference ?? current.referenceNumber}`,
        category: 'payment_proof',
        context: 'procurement',
        entityId: current.entityId,
        ownerType: 'procurement_request',
        ownerId: id,
        file: { buffer: file.buffer, originalname: file.originalname },
      });
      proofDocumentId = uploaded.id;
    }
    return this.payments.completePayment(actor, id, { ...parsed, proofDocumentId });
  }

  @Post('api/procurement/:id/payments/:paymentId/reverse-request')
  @RequirePermission('finance.payment.reverse.request')
  requestReverse(
    @CurrentActor() actor: ActorContext,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body(zodPipe(reversePaymentSchema)) body: ReversePaymentInput,
  ) {
    return this.payments.requestReversal(actor, paymentId, body.reason);
  }

  @Post('api/procurement/:id/payments/:paymentId/reverse-approve')
  @RequirePermission('finance.payment.reverse.approve')
  approveReverse(
    @CurrentActor() actor: ActorContext,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body(zodPipe(reversePaymentSchema.partial())) body: Partial<ReversePaymentInput>,
  ) {
    return this.payments.approveReversal(actor, paymentId, body.reason);
  }

  @Get('api/procurement/:id/memo')
  @ActorOnly()
  memoHtml(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.procurement.memoHtml(actor, id);
  }

  @Get('api/procurement/:id/memo.pdf')
  @ActorOnly()
  async memoPdf(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.procurement.memoPdf(actor, id);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    response.send(buffer);
  }

  @Get('api/procurement/:id')
  @ActorOnly()
  get(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.procurement.get(actor, id);
  }

  @Patch('api/procurement/:id')
  @RequirePermission('procurement.edit_draft')
  update(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateProcurementSchema)) body: UpdateProcurementInput,
  ) {
    return this.procurement.update(actor, id, body);
  }

  @Post('api/procurement/:id/invoices')
  @RequirePermission('procurement.edit_draft')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 26 * 1024 * 1024 } }),
  )
  async attachInvoice(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, string>,
  ) {
    if (!file) throw new ValidationFailedError('A file is required.');
    const parsed = invoiceMetaSchema.parse({
      invoiceNumber: body.invoiceNumber,
      invoiceDate: body.invoiceDate,
      amountKobo: body.amountKobo,
      reason: body.reason || undefined,
      vendorId: body.vendorId || undefined,
    });
    const current = await this.procurement.get(actor, id);
    // Refuse before storing the file, so a rejected invoice leaves no orphan document.
    this.procurement.assertInvoiceUploadAllowed(current, parsed);
    const uploaded = await this.documents.upload(actor, {
      title: `Invoice ${parsed.invoiceNumber}`,
      category: 'invoice',
      context: 'procurement',
      entityId: current.entityId,
      ownerType: 'procurement_request',
      ownerId: id,
      file: { buffer: file.buffer, originalname: file.originalname },
    });
    return this.procurement.attachInvoice(actor, id, parsed, uploaded.id);
  }

  @Post('api/procurement/:id/invoice-variance')
  @RequirePermission('procurement.approve.final')
  decideInvoiceVariance(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(invoiceVarianceDecisionSchema)) body: InvoiceVarianceDecisionInput,
  ) {
    return this.procurement.decideInvoiceVariance(actor, id, body);
  }

  @Post('api/procurement/:id/quotations')
  @RequirePermission('procurement.edit_draft')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 26 * 1024 * 1024 } }),
  )
  async attachQuotation(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, string>,
  ) {
    if (!file) throw new ValidationFailedError('Attach the quotation file.');
    const parsed = quotationMetaSchema.safeParse({
      vendorId: body.vendorId,
      lines: quotationLinesFromBody(body),
      notes: body.notes || undefined,
    });
    if (!parsed.success) {
      throw new ValidationFailedError(parsed.error.issues[0]?.message ?? 'The quotation details are not valid.');
    }
    const current = await this.procurement.get(actor, id);
    const uploaded = await this.documents.upload(actor, {
      title: `Quotation ${current.referenceNumber}`,
      category: 'vendor_quotation',
      context: 'procurement',
      entityId: current.entityId,
      ownerType: 'procurement_request',
      ownerId: id,
      file: { buffer: file.buffer, originalname: file.originalname },
    });
    return this.procurement.attachQuotation(actor, id, uploaded.id, parsed.data);
  }

  @Post('api/procurement/:id/quotations/:quotationId/remove')
  @RequirePermission('procurement.edit_draft')
  removeQuotation(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('quotationId', ParseUUIDPipe) quotationId: string,
  ) {
    return this.procurement.removeQuotation(actor, id, quotationId);
  }

  @Post('api/procurement/:id/vendor-selection')
  @RequirePermission('procurement.edit_draft')
  selectQuotedVendor(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(selectQuotedVendorSchema)) body: SelectQuotedVendorInput,
  ) {
    return this.procurement.selectQuotedVendor(actor, id, body);
  }

  @Post('api/procurement/:id/submit')
  @RequirePermission('procurement.submit')
  submit(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(submitProcurementSchema)) body: SubmitProcurementInput,
  ) {
    return this.procurement.submit(actor, id, body);
  }

  @Post('api/procurement/:id/actions')
  @ActorOnly()
  act(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(procurementActionSchema)) body: ProcurementActionInput,
  ) {
    return this.procurement.act(actor, id, body);
  }

  @Post('api/procurement/:id/payment-timing')
  @ActorOnly()
  changePaymentTiming(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(changePaymentTimingSchema)) body: ChangePaymentTimingInput,
  ) {
    return this.procurement.changePaymentTiming(actor, id, body);
  }

  @Post('api/procurement/:id/payment-timing/ack')
  @ActorOnly()
  acknowledgePaymentTiming(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(acknowledgePaymentTimingSchema)) body: AcknowledgePaymentTimingInput,
  ) {
    return this.procurement.acknowledgePaymentTiming(actor, id, body);
  }

  @Post('api/procurement/:id/clone')
  @ActorOnly()
  clone(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(cloneProcurementSchema)) body: CloneProcurementInput,
  ) {
    return this.procurement.clone(actor, id, body);
  }

  @Post('api/procurement/:id/discard')
  @RequirePermission('procurement.discard_draft')
  discard(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(discardProcurementSchema)) body: DiscardProcurementInput,
  ) {
    return this.procurement.discard(actor, id, body);
  }

  @Get('api/procurement/:id/comments')
  @ActorOnly()
  comments(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.procurement.comments(actor, id);
  }

  @Post('api/procurement/:id/comments')
  @ActorOnly()
  comment(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(commentSchema)) body: CommentInput,
  ) {
    return this.procurement.addComment(actor, id, body);
  }
}

/** Multipart fields `lines[0].lineNumber` / `lines[0].unitPriceKobo`. */
function quotationLinesFromBody(body: Record<string, string>): Array<{ lineNumber: string; unitPriceKobo: string }> {
  const lines: Array<{ lineNumber: string; unitPriceKobo: string }> = [];
  for (let index = 0; index < 40; index += 1) {
    const lineNumber = body[`lines[${index}].lineNumber`];
    const unitPriceKobo = body[`lines[${index}].unitPriceKobo`];
    const empty =
      (lineNumber === undefined || lineNumber === '') && (unitPriceKobo === undefined || unitPriceKobo === '');
    if (empty) {
      if (lines.length === 0 && index === 0) continue;
      break;
    }
    lines.push({ lineNumber: lineNumber ?? '', unitPriceKobo: unitPriceKobo ?? '' });
  }
  return lines;
}
