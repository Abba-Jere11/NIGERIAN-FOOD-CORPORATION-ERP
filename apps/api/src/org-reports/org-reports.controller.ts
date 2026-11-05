import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { Response } from 'express';
import { CurrentActor } from '../auth/current-actor.decorator';
import { ActorOnly, RequirePermission } from '../auth/require-permission.decorator';
import { zodPipe } from '../common/validation/zod-validation.pipe';
import {
  amendOrgReportSchema,
  closeOrgReportSchema,
  createDecisionSchema,
  createMinuteSchema,
  createOrgReportSchema,
  createResponseSchema,
  forwardOrgReportSchema,
  issueMinuteSchema,
  reviewResponseSchema,
  revokeAccessSchema,
  sendExternalSchema,
  submitOrgReportSchema,
  updateOrgReportSchema,
  updateTemplateSchema,
  type AmendOrgReportInput,
  type CloseOrgReportInput,
  type CreateDecisionInput,
  type CreateMinuteInput,
  type CreateOrgReportInput,
  type CreateResponseInput,
  type ForwardOrgReportInput,
  type IssueMinuteInput,
  type ReviewResponseInput,
  type RevokeAccessInput,
  type SendExternalInput,
  type SubmitOrgReportInput,
  type UpdateOrgReportInput,
  type UpdateTemplateInput,
} from './org-reports.dto';
import { OrgReportsService } from './org-reports.service';

@Controller('api/org-reports')
export class OrgReportsController {
  constructor(private readonly reports: OrgReportsService) {}

  @Get('dashboard')
  @ActorOnly()
  dashboard(@CurrentActor() actor: ActorContext) {
    return this.reports.dashboard(actor);
  }

  @Get('templates')
  @ActorOnly()
  templates(@CurrentActor() actor: ActorContext, @Query('all') all?: string) {
    return this.reports.templates(actor, all !== '1');
  }

  @Patch('templates/:id')
  @RequirePermission('org_report.template.manage')
  updateTemplate(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateTemplateSchema)) body: UpdateTemplateInput,
  ) {
    return this.reports.updateTemplate(actor, id, body);
  }

  @Get('directory')
  @ActorOnly()
  directory(@CurrentActor() actor: ActorContext) {
    return this.reports.directory(actor);
  }

  @Get('search')
  @ActorOnly()
  search(@CurrentActor() actor: ActorContext, @Query('q') q?: string) {
    return this.reports.search(actor, q ?? '');
  }

  @Get('inbox')
  @ActorOnly()
  inbox(
    @CurrentActor() actor: ActorContext,
    @Query('box') box?: 'mine' | 'incoming' | 'information' | 'forwarded',
    @Query('status') status?: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'CLOSED' | 'ARCHIVED',
  ) {
    return this.reports.list(actor, box ?? 'mine', status);
  }

  @Get('minutes/assigned')
  @ActorOnly()
  assigned(@CurrentActor() actor: ActorContext) {
    return this.reports.listMinutes(actor, 'assigned');
  }

  @Get('minutes/my-responses')
  @ActorOnly()
  myResponses(@CurrentActor() actor: ActorContext) {
    return this.reports.listMinutes(actor, 'my-responses');
  }

  @Get('minutes/issued')
  @RequirePermission('org_report.minute.issue')
  issued(@CurrentActor() actor: ActorContext) {
    return this.reports.listMinutes(actor, 'issued');
  }

  @Get('responses/awaiting')
  @RequirePermission('org_report.minute.review')
  awaiting(@CurrentActor() actor: ActorContext) {
    return this.reports.listResponsesAwaiting(actor);
  }

  @Get('decisions')
  @RequirePermission('org_report.decide')
  decisions(@CurrentActor() actor: ActorContext) {
    return this.reports.listDecisions(actor);
  }

  @Get('correspondence')
  @RequirePermission('org_report.email')
  correspondence(@CurrentActor() actor: ActorContext) {
    return this.reports.listExternal(actor);
  }

  @Get('minutes/:id/pdf')
  @ActorOnly()
  async minutePdf(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.reports.minutePdf(actor, id);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    response.send(buffer);
  }

  @Get('minutes/:id')
  @ActorOnly()
  minute(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.getMinute(actor, id);
  }

  @Get('responses/:id/pdf')
  @ActorOnly()
  async responsePdf(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.reports.responsePdf(actor, id);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    response.send(buffer);
  }

  @Post()
  @RequirePermission('org_report.create')
  create(@CurrentActor() actor: ActorContext, @Body(zodPipe(createOrgReportSchema)) body: CreateOrgReportInput) {
    return this.reports.create(actor, body);
  }

  @Get(':id/pdf')
  @ActorOnly()
  async pdf(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.reports.pdf(actor, id);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    response.send(buffer);
  }

  @Get(':id')
  @ActorOnly()
  get(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.get(actor, id);
  }

  @Patch(':id')
  @RequirePermission('org_report.create')
  update(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateOrgReportSchema)) body: UpdateOrgReportInput,
  ) {
    return this.reports.updateDraft(actor, id, body);
  }

  @Post(':id/submit')
  @RequirePermission('org_report.submit')
  submit(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(submitOrgReportSchema)) body: SubmitOrgReportInput,
  ) {
    return this.reports.submit(actor, id, body);
  }

  @Post(':id/amend')
  @RequirePermission('org_report.create')
  amend(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(amendOrgReportSchema)) body: AmendOrgReportInput,
  ) {
    return this.reports.amend(actor, id, body);
  }

  @Post(':id/forward')
  @RequirePermission('org_report.forward')
  forward(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(forwardOrgReportSchema)) body: ForwardOrgReportInput,
  ) {
    return this.reports.forward(actor, id, body);
  }

  @Post(':id/close')
  @RequirePermission('org_report.close')
  close(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(closeOrgReportSchema)) body: CloseOrgReportInput,
  ) {
    return this.reports.close(actor, id, body);
  }

  @Post(':id/revoke-access')
  @RequirePermission('org_report.forward')
  revoke(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(revokeAccessSchema)) body: RevokeAccessInput,
  ) {
    return this.reports.revokeAccess(actor, id, body.userId);
  }

  @Post(':id/minutes')
  @RequirePermission('org_report.minute.issue')
  createMinute(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(createMinuteSchema)) body: CreateMinuteInput,
  ) {
    return this.reports.createMinute(actor, id, body);
  }

  @Post('minutes/:id/issue')
  @RequirePermission('org_report.minute.issue')
  issue(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(issueMinuteSchema)) body: IssueMinuteInput,
  ) {
    return this.reports.issueMinute(actor, id, body.rowVersion);
  }

  @Post('minutes/:id/acknowledge')
  @RequirePermission('org_report.minute.respond')
  acknowledge(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(issueMinuteSchema)) body: IssueMinuteInput,
  ) {
    return this.reports.acknowledgeMinute(actor, id, body.rowVersion);
  }

  @Post('minutes/:id/progress')
  @RequirePermission('org_report.minute.respond')
  progress(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(issueMinuteSchema)) body: IssueMinuteInput,
  ) {
    return this.reports.markMinuteInProgress(actor, id, body.rowVersion);
  }

  @Post('minutes/:id/responses')
  @RequirePermission('org_report.minute.respond')
  respond(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(createResponseSchema)) body: CreateResponseInput,
  ) {
    return this.reports.createResponse(actor, id, body);
  }

  @Post('minutes/:id/review')
  @RequirePermission('org_report.minute.review')
  review(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(reviewResponseSchema)) body: ReviewResponseInput,
  ) {
    return this.reports.reviewResponse(actor, id, body);
  }

  @Post(':id/decisions')
  @RequirePermission('org_report.decide')
  decide(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(createDecisionSchema)) body: CreateDecisionInput,
  ) {
    return this.reports.createDecision(actor, id, body);
  }

  @Post(':id/email')
  @RequirePermission('org_report.email')
  email(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(sendExternalSchema)) body: SendExternalInput,
  ) {
    return this.reports.sendExternal(actor, id, body);
  }
}
