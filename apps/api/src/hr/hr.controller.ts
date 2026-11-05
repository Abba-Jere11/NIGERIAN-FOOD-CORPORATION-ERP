import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { Response } from 'express';
import { CurrentActor } from '../auth/current-actor.decorator';
import { ActorOnly, RequirePermission } from '../auth/require-permission.decorator';
import { zodPipe } from '../common/validation/zod-validation.pipe';
import {
  cancelLeaveSchema,
  createApplicantSchema,
  createAppraisalSchema,
  createChangeSchema,
  createCycleSchema,
  createDisciplinarySchema,
  createEmployeeSchema,
  createHolidaySchema,
  createLeaveSchema,
  createObjectiveSchema,
  createOfferSchema,
  createOvertimeSchema,
  createPositionSchema,
  createTrainingSchema,
  createUnitSchema,
  createVacancySchema,
  discEventSchema,
  discRecommendSchema,
  discReopenSchema,
  importAttendanceSchema,
  interviewSchema,
  onboardSchema,
  recordAttendanceSchema,
  rowVersionSchema,
  statusChangeSchema,
  trainingAttendanceSchema,
  trainingParticipantsSchema,
  updateEmployeeSchema,
  type CancelLeaveInput,
  type CreateApplicantInput,
  type CreateAppraisalInput,
  type CreateChangeInput,
  type CreateCycleInput,
  type CreateDisciplinaryInput,
  type CreateEmployeeInput,
  type CreateHolidayInput,
  type CreateLeaveInput,
  type CreateObjectiveInput,
  type CreateOfferInput,
  type CreateOvertimeInput,
  type CreatePositionInput,
  type CreateTrainingInput,
  type CreateUnitInput,
  type CreateVacancyInput,
  type DiscEventInput,
  type DiscRecommendInput,
  type DiscReopenInput,
  type ImportAttendanceInput,
  type InterviewInput,
  type OnboardInput,
  type RecordAttendanceInput,
  type RowVersionInput,
  type StatusChangeInput,
  type TrainingAttendanceInput,
  type TrainingParticipantsInput,
  type UpdateEmployeeInput,
} from './hr.dto';
import { HrService } from './hr.service';
import { InvitesService } from './invites.service';
import { decideInviteSchema, departmentHeadSchema, linkUserSchema } from '../me/me.dto';

@Controller('api/hr')
export class HrController {
  constructor(
    private readonly hr: HrService,
    private readonly invites: InvitesService,
  ) {}

  @Get('dashboard')
  @RequirePermission('hr.employee.view')
  dashboard(@CurrentActor() actor: ActorContext) {
    return this.hr.dashboard(actor);
  }

  @Get('units')
  @ActorOnly()
  units(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.hr.listUnits(actor, entityId);
  }

  @Post('units')
  @RequirePermission('hr.org.manage')
  createUnit(@CurrentActor() actor: ActorContext, @Body(zodPipe(createUnitSchema)) body: CreateUnitInput) {
    return this.hr.createUnit(actor, body);
  }

  @Post('units/:id/deactivate')
  @RequirePermission('hr.org.manage')
  deactivateUnit(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(statusChangeSchema)) body: StatusChangeInput,
  ) {
    return this.hr.setUnitStatus(actor, id, 'INACTIVE', body);
  }

  @Get('positions')
  @ActorOnly()
  positions(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.hr.listPositions(actor, entityId);
  }

  @Post('positions')
  @RequirePermission('hr.org.manage')
  createPosition(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createPositionSchema)) body: CreatePositionInput,
  ) {
    return this.hr.createPosition(actor, body);
  }

  @Get('employees')
  @RequirePermission('hr.employee.view')
  employees(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.hr.listEmployees(actor, entityId);
  }

  @Post('employees')
  @RequirePermission('hr.employee.manage')
  createEmployee(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createEmployeeSchema)) body: CreateEmployeeInput,
  ) {
    return this.hr.createEmployee(actor, body);
  }

  @Get('employees/:id/appointment.pdf')
  @RequirePermission('hr.employee.view')
  async appointmentPdf(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.hr.appointmentPdf(actor, id);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    response.send(buffer);
  }

  @Get('employees/:id')
  @ActorOnly()
  employee(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.hr.getEmployee(actor, id);
  }

  @Patch('employees/:id')
  @RequirePermission('hr.employee.manage')
  updateEmployee(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateEmployeeSchema)) body: UpdateEmployeeInput,
  ) {
    return this.hr.updateEmployee(actor, id, body);
  }

  @Get('changes')
  @RequirePermission('hr.employee.view')
  changes(@CurrentActor() actor: ActorContext, @Query('employeeId') employeeId?: string) {
    return this.hr.listChanges(actor, employeeId);
  }

  @Post('changes')
  @RequirePermission('hr.employee.manage')
  createChange(@CurrentActor() actor: ActorContext, @Body(zodPipe(createChangeSchema)) body: CreateChangeInput) {
    return this.hr.createChange(actor, body);
  }

  @Get('vacancies')
  @RequirePermission('hr.recruitment.manage')
  vacancies(@CurrentActor() actor: ActorContext) {
    return this.hr.listVacancies(actor);
  }

  @Post('vacancies')
  @RequirePermission('hr.recruitment.manage')
  createVacancy(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createVacancySchema)) body: CreateVacancyInput,
  ) {
    return this.hr.createVacancy(actor, body);
  }

  @Get('vacancies/:id')
  @RequirePermission('hr.recruitment.manage')
  vacancy(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.hr.getVacancy(actor, id);
  }

  @Post('vacancies/:id/applicants')
  @RequirePermission('hr.recruitment.manage')
  addApplicant(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(createApplicantSchema)) body: CreateApplicantInput,
  ) {
    return this.hr.addApplicant(actor, id, body);
  }

  @Post('applicants/:id/shortlist')
  @RequirePermission('hr.recruitment.manage')
  shortlist(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.hr.shortlistApplicant(actor, id);
  }

  @Post('applicants/:id/interviews')
  @RequirePermission('hr.recruitment.manage')
  interview(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(interviewSchema)) body: InterviewInput,
  ) {
    return this.hr.scheduleInterview(actor, id, body);
  }

  @Post('vacancies/:id/offers')
  @RequirePermission('hr.recruitment.manage')
  createOffer(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(createOfferSchema)) body: CreateOfferInput,
  ) {
    return this.hr.createOffer(actor, id, body);
  }

  @Get('offers/:id/pdf')
  @RequirePermission('hr.recruitment.manage')
  async offerPdf(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.hr.offerPdf(actor, id);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    response.send(buffer);
  }

  @Post('offers/:id/issue')
  @RequirePermission('hr.recruitment.manage')
  issueOffer(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.hr.issueOffer(actor, id);
  }

  @Post('offers/:id/onboard')
  @RequirePermission('hr.recruitment.manage')
  onboard(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(onboardSchema)) body: OnboardInput,
  ) {
    return this.hr.onboard(actor, id, body);
  }

  @Get('leave-types')
  @RequirePermission('hr.employee.view')
  leaveTypes(@CurrentActor() actor: ActorContext) {
    return this.hr.leaveTypes(actor);
  }

  @Get('holidays')
  @RequirePermission('hr.employee.view')
  holidays(@CurrentActor() actor: ActorContext) {
    return this.hr.holidays(actor);
  }

  @Post('holidays')
  @RequirePermission('hr.org.manage')
  createHoliday(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createHolidaySchema)) body: CreateHolidayInput,
  ) {
    return this.hr.createHoliday(actor, body);
  }

  @Get('leave')
  @RequirePermission('hr.leave.approve')
  leave(@CurrentActor() actor: ActorContext) {
    return this.hr.listLeave(actor);
  }

  @Get('leave/calendar')
  @RequirePermission('hr.employee.view')
  calendar(@CurrentActor() actor: ActorContext) {
    return this.hr.leaveCalendar(actor);
  }

  @Get('employees/:id/leave-balances')
  @RequirePermission('hr.employee.view')
  balances(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.hr.leaveBalances(actor, id);
  }

  @Post('leave')
  @RequirePermission('hr.employee.manage')
  createLeave(@CurrentActor() actor: ActorContext, @Body(zodPipe(createLeaveSchema)) body: CreateLeaveInput) {
    return this.hr.createLeave(actor, body);
  }

  @Post('leave/:id/cancel')
  @RequirePermission('hr.leave.approve')
  cancelLeave(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(cancelLeaveSchema)) body: CancelLeaveInput,
  ) {
    return this.hr.cancelLeave(actor, id, body);
  }

  @Get('attendance')
  @RequirePermission('hr.attendance.manage')
  attendance(
    @CurrentActor() actor: ActorContext,
    @Query('entityId') entityId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.hr.listAttendance(actor, { entityId, from, to });
  }

  @Post('attendance')
  @RequirePermission('hr.attendance.manage')
  recordAttendance(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(recordAttendanceSchema)) body: RecordAttendanceInput,
  ) {
    return this.hr.recordAttendance(actor, body);
  }

  @Post('attendance/import')
  @RequirePermission('hr.attendance.manage')
  importAttendance(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(importAttendanceSchema)) body: ImportAttendanceInput,
  ) {
    return this.hr.importAttendance(actor, body);
  }

  @Get('attendance/summary')
  @RequirePermission('hr.attendance.manage')
  summary(
    @CurrentActor() actor: ActorContext,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    const now = new Date();
    return this.hr.monthlySummary(actor, Number(year) || now.getFullYear(), Number(month) || now.getMonth() + 1);
  }

  @Get('overtime')
  @RequirePermission('hr.attendance.manage')
  overtime(@CurrentActor() actor: ActorContext) {
    return this.hr.listOvertime(actor);
  }

  @Post('overtime')
  @RequirePermission('hr.attendance.manage')
  createOvertime(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createOvertimeSchema)) body: CreateOvertimeInput,
  ) {
    return this.hr.createOvertime(actor, body);
  }

  @Get('cycles')
  @RequirePermission('hr.performance.manage')
  cycles(@CurrentActor() actor: ActorContext) {
    return this.hr.listCycles(actor);
  }

  @Post('cycles')
  @RequirePermission('hr.performance.manage')
  createCycle(@CurrentActor() actor: ActorContext, @Body(zodPipe(createCycleSchema)) body: CreateCycleInput) {
    return this.hr.createCycle(actor, body);
  }

  @Post('cycles/:id/objectives')
  @RequirePermission('hr.performance.manage')
  addObjective(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(createObjectiveSchema)) body: CreateObjectiveInput,
  ) {
    return this.hr.addObjective(actor, id, body);
  }

  @Get('appraisals')
  @RequirePermission('hr.performance.manage')
  appraisals(@CurrentActor() actor: ActorContext) {
    return this.hr.listAppraisals(actor);
  }

  @Post('cycles/:id/appraisals')
  @RequirePermission('hr.performance.manage')
  createAppraisal(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(createAppraisalSchema)) body: CreateAppraisalInput,
  ) {
    return this.hr.createAppraisal(actor, id, body);
  }

  @Get('disciplinary')
  @ActorOnly()
  disciplinary(@CurrentActor() actor: ActorContext) {
    return this.hr.listDisciplinary(actor);
  }

  @Post('disciplinary')
  @RequirePermission('hr.disciplinary.manage')
  createDisciplinary(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createDisciplinarySchema)) body: CreateDisciplinaryInput,
  ) {
    return this.hr.createDisciplinary(actor, body);
  }

  @Get('disciplinary/:id')
  @ActorOnly()
  getDisciplinary(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.hr.getDisciplinary(actor, id);
  }

  @Post('disciplinary/:id/submit')
  @RequirePermission('hr.disciplinary.manage')
  submitDisciplinary(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(rowVersionSchema)) body: RowVersionInput,
  ) {
    return this.hr.submitDisciplinary(actor, id, body.rowVersion);
  }

  @Post('disciplinary/:id/events')
  @ActorOnly()
  discEvent(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(discEventSchema)) body: DiscEventInput,
  ) {
    return this.hr.addDiscEvent(actor, id, body);
  }

  @Post('disciplinary/:id/recommend')
  @RequirePermission('hr.disciplinary.manage')
  recommend(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(discRecommendSchema)) body: DiscRecommendInput,
  ) {
    return this.hr.recommendDisciplinary(actor, id, body);
  }

  @Post('disciplinary/:id/close')
  @RequirePermission('hr.disciplinary.close')
  closeDisc(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(statusChangeSchema)) body: StatusChangeInput,
  ) {
    return this.hr.closeDisciplinary(actor, id, body);
  }

  @Post('disciplinary/:id/reopen')
  @RequirePermission('hr.disciplinary.manage')
  reopen(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(discReopenSchema)) body: DiscReopenInput,
  ) {
    return this.hr.reopenDisciplinary(actor, id, body);
  }

  @Get('training')
  @RequirePermission('hr.training.view')
  training(@CurrentActor() actor: ActorContext) {
    return this.hr.listTraining(actor);
  }

  @Post('training')
  @RequirePermission('hr.training.manage')
  createTraining(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createTrainingSchema)) body: CreateTrainingInput,
  ) {
    return this.hr.createTraining(actor, body);
  }

  @Get('training/:id')
  @RequirePermission('hr.training.view')
  getTraining(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.hr.getTraining(actor, id);
  }

  @Post('training/:id/participants')
  @RequirePermission('hr.training.manage')
  addParticipants(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(trainingParticipantsSchema)) body: TrainingParticipantsInput,
  ) {
    return this.hr.addTrainingParticipants(actor, id, body);
  }

  @Post('training/:id/attendance')
  @RequirePermission('hr.training.manage')
  trainingAttendance(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(trainingAttendanceSchema)) body: TrainingAttendanceInput,
  ) {
    return this.hr.recordTrainingAttendance(actor, id, body);
  }

  @Post('training/:id/finance')
  @RequirePermission('hr.training.approve')
  sendFinance(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(rowVersionSchema)) body: RowVersionInput,
  ) {
    return this.hr.sendTrainingToFinance(actor, id, body.rowVersion);
  }

  @Post('employees/:id/invite')
  @RequirePermission('hr.invite.manage')
  issueInvite(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.invites.issue(actor, id);
  }

  @Get('invites')
  @RequirePermission('hr.invite.manage')
  pendingInvites(@CurrentActor() actor: ActorContext) {
    return this.invites.listPending(actor);
  }

  @Post('invites/:id/approve')
  @RequirePermission('hr.invite.manage')
  approveInvite(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(decideInviteSchema)) body: { reason: string },
  ) {
    return this.invites.decide(actor, id, true, body.reason);
  }

  @Post('invites/:id/reject')
  @RequirePermission('hr.invite.manage')
  rejectInvite(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(decideInviteSchema)) body: { reason: string },
  ) {
    return this.invites.decide(actor, id, false, body.reason);
  }

  @Post('employees/:id/link-user')
  @RequirePermission('hr.invite.manage')
  linkUser(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(linkUserSchema)) body: { userId: string },
  ) {
    return this.invites.linkUser(actor, id, body.userId);
  }

  @Post('departments/:id/head')
  @RequirePermission('hr.org.manage')
  setDepartmentHead(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(departmentHeadSchema)) body: { employeeId: string },
  ) {
    return this.hr.setDepartmentHead(actor, id, body.employeeId);
  }
}
