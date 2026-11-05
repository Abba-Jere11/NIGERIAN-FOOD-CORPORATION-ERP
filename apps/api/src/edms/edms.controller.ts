import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { ActorContext } from '@nfc/db';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { CurrentActor } from '../auth/current-actor.decorator';
import { ActorOnly, RequirePermission } from '../auth/require-permission.decorator';
import { ValidationFailedError } from '../common/errors/domain-error';
import { zodPipe } from '../common/validation/zod-validation.pipe';
import { EdmsService } from './edms.service';
import { categorySchema, holdSchema, reasonSchema, refileSchema, shareSchema, tagSchema } from './edms.dto';

@Controller('api/edms')
@RequirePermission('edms.portal.access')
export class EdmsController {
  constructor(private readonly edms: EdmsService) {}

  @Get('access')
  @ActorOnly()
  access(@CurrentActor() actor: ActorContext) {
    return this.edms.access(actor);
  }

  @Get('gateway')
  gateway(@CurrentActor() actor: ActorContext) {
    return this.edms.gateway(actor);
  }

  @Get('tree')
  tree(@CurrentActor() actor: ActorContext, @Query('entityId', ParseUUIDPipe) entityId: string) {
    return this.edms.tree(actor, entityId);
  }

  @Get('folders/:id')
  folder(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.edms.folder(actor, id);
  }

  @Get('documents/:id')
  document(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.edms.getDocument(actor, id);
  }

  @Get('packages')
  packageFor(
    @CurrentActor() actor: ActorContext,
    @Query('procurementId', ParseUUIDPipe) procurementId: string,
  ) {
    return this.edms.packageForProcurement(actor, procurementId);
  }

  @Get('search')
  search(
    @CurrentActor() actor: ActorContext,
    @Query('q') q?: string,
    @Query('entityId') entityId?: string,
    @Query('all') all?: string,
  ) {
    return this.edms.search(actor, q ?? '', {
      entityId: entityId || undefined,
      all: all === '1' || all === 'true',
    });
  }

  @Get('categories')
  categories(@CurrentActor() actor: ActorContext) {
    return this.edms.listCategories(actor);
  }

  @Post('categories')
  saveCategory(@CurrentActor() actor: ActorContext, @Body(zodPipe(categorySchema)) body: z.infer<typeof categorySchema>) {
    return this.edms.saveCategory(actor, body);
  }

  @Get('tags')
  tags(@CurrentActor() actor: ActorContext) {
    return this.edms.listTags(actor);
  }

  @Post('tags')
  saveTag(@CurrentActor() actor: ActorContext, @Body(zodPipe(tagSchema)) body: z.infer<typeof tagSchema>) {
    return this.edms.saveTag(actor, body);
  }

  @Get('legal-holds')
  holds(@CurrentActor() actor: ActorContext) {
    return this.edms.legalHolds(actor);
  }

  @Get('share-targets')
  shareTargets(@CurrentActor() actor: ActorContext) {
    return this.edms.shareTargets(actor);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 26 * 1024 * 1024 } }))
  upload(
    @CurrentActor() actor: ActorContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, string>,
  ) {
    if (!file) throw new ValidationFailedError('A file is required.');
    const tags = (body.tags ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    return this.edms.upload(actor, {
      title: String(body.title ?? '').trim(),
      entityId: String(body.entityId ?? ''),
      folderId: String(body.folderId ?? ''),
      categoryId: String(body.categoryId ?? ''),
      tags,
      file: { buffer: file.buffer, originalname: file.originalname },
    });
  }

  @Post('documents/:id/versions')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 26 * 1024 * 1024 } }))
  replace(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, string>,
  ) {
    if (!file) throw new ValidationFailedError('A file is required.');
    return this.edms.replace(actor, id, {
      reason: String(body.reason ?? ''),
      file: { buffer: file.buffer, originalname: file.originalname },
    });
  }

  @Post('documents/:id/archive')
  archive(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
  ) {
    return this.edms.archive(actor, id, body.reason);
  }

  @Post('documents/:id/share')
  share(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(shareSchema)) body: z.infer<typeof shareSchema>,
  ) {
    return this.edms.share(actor, id, body);
  }

  @Post('documents/:id/share/:shareId/revoke')
  revokeShare(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('shareId', ParseUUIDPipe) shareId: string,
  ) {
    return this.edms.revokeShare(actor, id, shareId);
  }

  @Post('documents/:id/legal-hold')
  hold(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(holdSchema)) body: z.infer<typeof holdSchema>,
  ) {
    return this.edms.placeHold(actor, id, body.reason);
  }

  @Post('documents/:id/legal-hold/:holdId/release')
  releaseHold(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('holdId', ParseUUIDPipe) holdId: string,
    @Body(zodPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
  ) {
    return this.edms.releaseHold(actor, id, holdId, body.reason);
  }

  @Post('documents/:id/refile')
  refile(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(refileSchema)) body: z.infer<typeof refileSchema>,
  ) {
    return this.edms.refile(actor, id, body);
  }
}
