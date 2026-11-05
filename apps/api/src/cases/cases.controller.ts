import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { CurrentActor } from '../auth/current-actor.decorator';
import { ActorOnly, RequirePermission } from '../auth/require-permission.decorator';
import { zodPipe } from '../common/validation/zod-validation.pipe';
import { CasesService } from './cases.service';
import {
  caseCommentSchema,
  caseStatusSchema,
  caseUserSchema,
  createCaseSchema,
  type CaseCommentInput,
  type CaseStatusInput,
  type CaseUserInput,
  type CreateCaseInput,
} from './cases.dto';

@Controller('api/cases')
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Get('directory')
  @RequirePermission('cases.view')
  directory(@CurrentActor() actor: ActorContext) {
    return this.cases.directory(actor);
  }

  @Get()
  @ActorOnly()
  list(@CurrentActor() actor: ActorContext) {
    return this.cases.list(actor);
  }

  @Post()
  @RequirePermission('cases.create')
  create(@CurrentActor() actor: ActorContext, @Body(zodPipe(createCaseSchema)) body: CreateCaseInput) {
    return this.cases.create(actor, body);
  }

  @Get(':id')
  @ActorOnly()
  get(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.cases.get(actor, id);
  }

  @Post(':id/assign')
  @RequirePermission('cases.assign')
  assign(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(caseUserSchema)) body: CaseUserInput,
  ) {
    return this.cases.assign(actor, id, body.userId);
  }

  @Post(':id/grant')
  @RequirePermission('cases.grant')
  grant(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(caseUserSchema)) body: CaseUserInput,
  ) {
    return this.cases.grant(actor, id, body.userId);
  }

  @Post(':id/cc')
  @RequirePermission('cases.grant')
  cc(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(caseUserSchema)) body: CaseUserInput,
  ) {
    return this.cases.cc(actor, id, body.userId);
  }

  @Post(':id/comments')
  @ActorOnly()
  comment(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(caseCommentSchema)) body: CaseCommentInput,
  ) {
    return this.cases.comment(actor, id, body);
  }

  @Post(':id/status')
  @ActorOnly()
  status(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(caseStatusSchema)) body: CaseStatusInput,
  ) {
    return this.cases.setStatus(actor, id, body);
  }
}
