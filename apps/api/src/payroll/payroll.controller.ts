import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { Response } from 'express';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { zodPipe } from '../common/validation/zod-validation.pipe';
import {
  adjustRunSchema,
  createLoanSchema,
  createPayeBandSchema,
  createPensionSchema,
  createRunSchema,
  createStatutorySchema,
  createStructureSchema,
  payRunSchema,
  remitSchema,
  rowVersionSchema,
  updateSettingsSchema,
  type AdjustRunInput,
  type CreateLoanInput,
  type CreatePayeBandInput,
  type CreatePensionInput,
  type CreateRunInput,
  type CreateStatutoryInput,
  type CreateStructureInput,
  type PayRunInput,
  type RemitInput,
  type RowVersionInput,
  type UpdateSettingsInput,
} from './payroll.dto';
import { PayrollService } from './payroll.service';

@Controller('api/payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('dashboard')
  @RequirePermission('payroll.view')
  dashboard(@CurrentActor() actor: ActorContext) {
    return this.payroll.dashboard(actor);
  }

  @Get('settings')
  @RequirePermission('payroll.view')
  settings(@CurrentActor() actor: ActorContext) {
    return this.payroll.getSettings(actor);
  }

  @Patch('settings')
  @RequirePermission('payroll.config')
  updateSettings(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(updateSettingsSchema)) body: UpdateSettingsInput,
  ) {
    return this.payroll.updateSettings(actor, body);
  }

  @Get('paye')
  @RequirePermission('payroll.view')
  paye(@CurrentActor() actor: ActorContext) {
    return this.payroll.listPaye(actor);
  }

  @Post('paye')
  @RequirePermission('payroll.config')
  createPaye(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createPayeBandSchema)) body: CreatePayeBandInput,
  ) {
    return this.payroll.createPaye(actor, body);
  }

  @Get('pension')
  @RequirePermission('payroll.view')
  pension(@CurrentActor() actor: ActorContext) {
    return this.payroll.listPension(actor);
  }

  @Post('pension')
  @RequirePermission('payroll.config')
  createPension(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createPensionSchema)) body: CreatePensionInput,
  ) {
    return this.payroll.createPension(actor, body);
  }

  @Get('statutory')
  @RequirePermission('payroll.view')
  statutory(@CurrentActor() actor: ActorContext) {
    return this.payroll.listStatutory(actor);
  }

  @Post('statutory')
  @RequirePermission('payroll.config')
  createStatutory(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createStatutorySchema)) body: CreateStatutoryInput,
  ) {
    return this.payroll.createStatutory(actor, body);
  }

  @Get('structures')
  @RequirePermission('payroll.view')
  structures(@CurrentActor() actor: ActorContext, @Query('employeeId') employeeId?: string) {
    return this.payroll.listStructures(actor, employeeId);
  }

  @Post('structures')
  @RequirePermission('payroll.structure.manage')
  createStructure(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createStructureSchema)) body: CreateStructureInput,
  ) {
    return this.payroll.createStructure(actor, body);
  }

  @Post('structures/:id/confirm')
  @RequirePermission('payroll.structure.manage')
  confirmStructure(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(rowVersionSchema)) body: RowVersionInput,
  ) {
    return this.payroll.confirmStructure(actor, id, body.rowVersion);
  }

  @Get('loans')
  @RequirePermission('payroll.view')
  loans(@CurrentActor() actor: ActorContext, @Query('employeeId') employeeId?: string) {
    return this.payroll.listLoans(actor, employeeId);
  }

  @Post('loans')
  @RequirePermission('payroll.structure.manage')
  createLoan(@CurrentActor() actor: ActorContext, @Body(zodPipe(createLoanSchema)) body: CreateLoanInput) {
    return this.payroll.createLoan(actor, body);
  }

  @Get('periods')
  @RequirePermission('payroll.view')
  periods(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.payroll.listPeriods(actor, entityId);
  }

  @Get('runs')
  @RequirePermission('payroll.view')
  runs(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.payroll.listRuns(actor, entityId);
  }

  @Post('runs')
  @RequirePermission('payroll.run.prepare')
  createRun(@CurrentActor() actor: ActorContext, @Body(zodPipe(createRunSchema)) body: CreateRunInput) {
    return this.payroll.createRun(actor, body);
  }

  @Get('runs/:id')
  @RequirePermission('payroll.view')
  getRun(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.getRun(actor, id);
  }

  @Post('runs/:id/calculate')
  @RequirePermission('payroll.run.prepare')
  calculate(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(rowVersionSchema)) body: RowVersionInput,
  ) {
    return this.payroll.calculate(actor, id, body.rowVersion);
  }

  @Post('runs/:id/submit')
  @RequirePermission('payroll.run.prepare')
  submit(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(rowVersionSchema)) body: RowVersionInput,
  ) {
    return this.payroll.submit(actor, id, body.rowVersion);
  }

  @Post('runs/:id/pay')
  @RequirePermission('payroll.pay')
  pay(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(payRunSchema)) body: PayRunInput,
  ) {
    return this.payroll.pay(actor, id, body);
  }

  @Post('runs/:id/remit')
  @RequirePermission('payroll.pay')
  remit(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(remitSchema)) body: RemitInput,
  ) {
    return this.payroll.remit(actor, id, body);
  }

  @Post('runs/:id/adjust')
  @RequirePermission('payroll.run.prepare')
  adjust(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(adjustRunSchema)) body: AdjustRunInput,
  ) {
    return this.payroll.adjust(actor, id, body);
  }

  @Get('runs/:id/payslips/:employeeId')
  @RequirePermission('payroll.view')
  async payslip(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Res() res: Response,
  ) {
    const file = await this.payroll.downloadPayslip(actor, id, employeeId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  }

  @Get('reports/hr')
  @RequirePermission('hr.employee.view')
  hrReport(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.payroll.hrOperationalReport(actor, entityId);
  }

  @Get('reports/variance')
  @RequirePermission('payroll.view')
  variance(@CurrentActor() actor: ActorContext, @Query('runId') runId?: string) {
    return this.payroll.varianceReport(actor, runId);
  }

  @Get('reports/remittance')
  @RequirePermission('payroll.view')
  remittance(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.payroll.remittanceReport(actor, entityId);
  }

  @Get('snapshot/:templateKey')
  @RequirePermission('org_report.create')
  snapshot(
    @CurrentActor() actor: ActorContext,
    @Param('templateKey') templateKey: string,
    @Query('entityId') entityId?: string,
  ) {
    return this.payroll.orgSnapshot(actor, templateKey, entityId);
  }
}
