import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { ActorContext } from '@nfc/db';
import type { DocumentUploadContext } from '@nfc/shared';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { ActorService } from '../auth/actor.service';
import { CurrentActor } from '../auth/current-actor.decorator';
import { Public } from '../auth/public.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ForbiddenError, UnauthenticatedError, ValidationFailedError } from '../common/errors/domain-error';
import { zodPipe } from '../common/validation/zod-validation.pipe';
import { DocumentsService } from './documents.service';
import { verifyDownloadToken } from './download-tokens';

const uploadFields = z.object({
  title: z.string().trim().min(1),
  category: z.string().trim().min(1).default('general'),
  context: z.enum(['procurement', 'edms', 'general', 'vendor_compliance']).default('general'),
  entityId: z.string().uuid().optional(),
  ownerType: z.string().trim().min(1).optional(),
  ownerId: z.string().uuid().optional(),
});

const replaceFields = z.object({
  reason: z.string().trim().min(1),
  context: z.enum(['procurement', 'edms', 'general', 'vendor_compliance']).default('general'),
});

const mintSchema = z.object({
  versionId: z.string().uuid().optional(),
});

@Controller()
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly actors: ActorService,
  ) {}

  @Get('api/documents')
  @RequirePermission('document.view')
  list(@CurrentActor() actor: ActorContext) {
    return this.documents.list(actor);
  }

  @Get('api/documents/:id')
  @RequirePermission('document.view')
  get(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.get(actor, id);
  }

  @Post('api/documents')
  @RequirePermission('document.upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 26 * 1024 * 1024 } }))
  upload(
    @CurrentActor() actor: ActorContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, string>,
  ) {
    if (!file) throw new ValidationFailedError('A file is required.');
    const parsed = uploadFields.parse(body);
    return this.documents.upload(actor, {
      ...parsed,
      context: parsed.context as DocumentUploadContext,
      file: { buffer: file.buffer, originalname: file.originalname },
    });
  }

  @Post('api/documents/:id/versions')
  @RequirePermission('document.replace')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 26 * 1024 * 1024 } }))
  replace(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, string>,
  ) {
    if (!file) throw new ValidationFailedError('A file is required.');
    const parsed = replaceFields.parse(body);
    return this.documents.replace(actor, id, {
      reason: parsed.reason,
      context: parsed.context as DocumentUploadContext,
      file: { buffer: file.buffer, originalname: file.originalname },
    });
  }

  @Post('api/documents/:id/download-url')
  @RequirePermission('document.view')
  mint(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(mintSchema)) body: z.infer<typeof mintSchema>,
  ) {
    return this.documents.mintDownloadUrl(actor, id, body.versionId);
  }

  @Get('api/documents/:id/download')
  @Public()
  async download(
    @Req() request: Request,
    @Res() response: Response,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('token') token?: string,
    @Query('versionId') versionId?: string,
  ): Promise<void> {
    let actor: ActorContext;
    let targetVersion = versionId;
    if (token) {
      const payload = verifyDownloadToken(token);
      if (!payload || payload.documentId !== id) {
        throw new ForbiddenError('This download link has expired or is not valid.');
      }
      try {
        const sessionActor = await this.actors.resolveFromRequest(request);
        if (sessionActor.ref !== payload.sub) {
          throw new ForbiddenError('This download link is not for your session.');
        }
        actor = sessionActor;
      } catch (error) {
        if (error instanceof ForbiddenError) throw error;
        if (!(error instanceof UnauthenticatedError)) throw error;
        actor = await this.actors.loadByUserId(payload.sub);
      }
      targetVersion = payload.versionId;
    } else {
      actor = await this.actors.resolveFromRequest(request);
    }
    const file = await this.documents.streamForActor(actor, id, targetVersion);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename.replace(/"/g, '')}"`,
    );
    response.send(file.buffer);
  }
}
