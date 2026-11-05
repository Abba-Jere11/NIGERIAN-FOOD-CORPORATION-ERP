import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { ActorContext } from '@nfc/db';
import { REQUIRED_VENDOR_COMPLIANCE, type DocumentUploadContext } from '@nfc/shared';
import { memoryStorage } from 'multer';
import { ActorOnly, RequirePermission } from '../auth/require-permission.decorator';
import { CurrentActor } from '../auth/current-actor.decorator';
import { ValidationFailedError } from '../common/errors/domain-error';
import { zodPipe } from '../common/validation/zod-validation.pipe';
import { DocumentsService } from '../documents/documents.service';
import { VendorQueriesService } from './vendor-queries.service';
import { VendorValidationService } from './vendor-validation.service';
import {
  attachComplianceSchema,
  bankApproveSchema,
  bankDetailsSchema,
  createVendorSchema,
  listVendorsSchema,
  updateVendorSchema,
  vendorReasonSchema,
  type AttachComplianceInput,
  type BankDetailsInput,
  type CreateVendorInput,
  type ListVendorsQuery,
  type UpdateVendorInput,
  type VendorReasonInput,
} from './vendors.dto';
import { VendorsService } from './vendors.service';

@Controller()
export class VendorsController {
  constructor(
    private readonly vendors: VendorsService,
    private readonly validation: VendorValidationService,
    private readonly queries: VendorQueriesService,
    private readonly documents: DocumentsService,
  ) {}

  @Get('api/vendors/categories')
  @ActorOnly()
  categories(@CurrentActor() actor: ActorContext) {
    return this.vendors.categories(actor);
  }

  @Get('api/vendors/validate/:id')
  @ActorOnly()
  validate(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.validation.assertSelectable(actor, id);
  }

  @Get('api/vendors')
  @ActorOnly()
  list(
    @CurrentActor() actor: ActorContext,
    @Query(zodPipe(listVendorsSchema)) query: ListVendorsQuery,
  ) {
    return this.vendors.list(actor, query);
  }

  @Get('api/vendors/:id/history')
  @ActorOnly()
  history(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.queries.history(actor, id);
  }

  @Get('api/vendors/:id')
  @ActorOnly()
  get(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendors.get(actor, id);
  }

  @Post('api/vendors')
  @RequirePermission('vendor.create')
  create(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createVendorSchema)) body: CreateVendorInput,
  ) {
    return this.vendors.create(actor, body);
  }

  @Patch('api/vendors/:id')
  @RequirePermission('vendor.create')
  update(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateVendorSchema)) body: UpdateVendorInput,
  ) {
    return this.vendors.update(actor, id, body);
  }

  @Post('api/vendors/:id/submit')
  @RequirePermission('vendor.create')
  submit(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendors.submit(actor, id);
  }

  @Post('api/vendors/:id/suspend')
  @RequirePermission('vendor.suspend')
  suspend(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(vendorReasonSchema)) body: VendorReasonInput,
  ) {
    return this.vendors.suspend(actor, id, body);
  }

  @Post('api/vendors/:id/blacklist')
  @RequirePermission('vendor.blacklist')
  blacklist(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(vendorReasonSchema)) body: VendorReasonInput,
  ) {
    return this.vendors.blacklist(actor, id, body);
  }

  @Post('api/vendors/:id/reactivate')
  @RequirePermission('vendor.activate')
  reactivate(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(vendorReasonSchema)) body: VendorReasonInput,
  ) {
    return this.vendors.reactivate(actor, id, body);
  }

  @Post('api/vendors/:id/compliance-documents')
  @RequirePermission('vendor.create')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 26 * 1024 * 1024 } }),
  )
  async attachCompliance(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, string>,
  ) {
    const parsed = attachComplianceSchema.parse({
      documentId: body.documentId || undefined,
      complianceType: body.complianceType,
      required:
        body.required === undefined
          ? undefined
          : body.required === 'true' || body.required === '1',
      expiresAt: body.expiresAt || undefined,
    });
    const documentId = await this.resolveDocumentId(actor, id, file, parsed);
    return this.vendors.attachCompliance(actor, id, { ...parsed, documentId });
  }

  @Post('api/vendors/:id/bank-details')
  @RequirePermission('vendor.create')
  changeBank(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(bankDetailsSchema)) body: BankDetailsInput,
  ) {
    return this.vendors.changeBank(actor, id, body);
  }

  @Post('api/vendors/:id/bank-details/approve')
  @RequirePermission('vendor.activate')
  approveBank(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(bankApproveSchema)) body: { rowVersion: number },
  ) {
    return this.vendors.approveBank(actor, id, body.rowVersion);
  }

  private async resolveDocumentId(
    actor: ActorContext,
    vendorId: string,
    file: Express.Multer.File | undefined,
    parsed: AttachComplianceInput,
  ): Promise<string> {
    if (parsed.documentId) return parsed.documentId;
    if (!file) throw new ValidationFailedError('A file or an existing document id is required.');
    const vendor = await this.vendors.get(actor, vendorId);
    const required =
      parsed.required ?? (REQUIRED_VENDOR_COMPLIANCE as readonly string[]).includes(parsed.complianceType);
    const uploaded = await this.documents.upload(actor, {
      title: `${vendor.legalName} ${parsed.complianceType}`,
      category: parsed.complianceType.toLowerCase(),
      context: 'vendor_compliance' as DocumentUploadContext,
      entityId: vendor.entityId,
      ownerType: 'vendor',
      ownerId: vendorId,
      file: { buffer: file.buffer, originalname: file.originalname },
    });
    void required;
    return uploaded.id;
  }
}
