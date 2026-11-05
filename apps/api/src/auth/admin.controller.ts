import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { USER_STATUSES, type UserStatus } from '@nfc/shared';
import { z } from 'zod';
import { ROLE_KEYS, SCOPE_TYPES } from '@nfc/shared';
import type { Request } from 'express';
import { StepUpRequiredError } from '../common/errors/domain-error';
import { zodPipe } from '../common/validation/zod-validation.pipe';
import { AdminOpsService } from './admin-ops.service';
import { AdminUsersService } from './admin-users.service';
import { AuthService } from './auth.service';
import { CurrentActor } from './current-actor.decorator';
import { RequirePermission } from './require-permission.decorator';

const createUserSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().email(),
  phone: z.string().trim().min(7).optional().nullable(),
  position: z.string().trim().min(1),
  primaryEntityId: z.string().uuid(),
  departmentId: z.string().uuid().optional().nullable(),
  password: z.string().min(12),
  role: z.enum(ROLE_KEYS),
  scopeType: z.enum(SCOPE_TYPES),
  entityId: z.string().uuid().optional().nullable(),
});

const statusSchema = z.object({
  status: z.enum(USER_STATUSES),
  reason: z.string().trim().min(3),
});

const reasonSchema = z.object({
  reason: z.string().trim().min(3),
});

const mfaPolicySchema = z.object({
  required: z.boolean(),
  reason: z.string().trim().min(3),
});

const assignSchema = z.object({
  role: z.enum(ROLE_KEYS),
  scopeType: z.enum(SCOPE_TYPES),
  entityId: z.string().uuid().optional().nullable(),
});

const grantSchema = z.object({
  entityId: z.string().uuid(),
  reason: z.string().trim().min(3),
  expiresAt: z.string().datetime().optional().nullable(),
});

@Controller('api/admin')
export class AdminController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly auth: AuthService,
    private readonly ops: AdminOpsService,
  ) {}

  @Get('users')
  @RequirePermission('admin.user.manage')
  listUsers(@CurrentActor() actor: ActorContext) {
    return this.users.list(actor);
  }

  @Post('users')
  @RequirePermission('admin.user.manage')
  createUser(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createUserSchema)) body: z.infer<typeof createUserSchema>,
  ) {
    return this.users.create(actor, body);
  }

  @Post('users/:id/status')
  @RequirePermission('admin.user.manage')
  setStatus(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(statusSchema)) body: z.infer<typeof statusSchema>,
  ) {
    return this.users.setStatus(actor, id, body.status as UserStatus, body.reason);
  }

  @Post('users/:id/mfa-policy')
  @RequirePermission('admin.user.manage')
  setMfaPolicy(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(mfaPolicySchema)) body: z.infer<typeof mfaPolicySchema>,
  ) {
    return this.users.setMfaPolicy(actor, id, body.required, body.reason);
  }

  @Post('users/:id/unlock')
  @RequirePermission('admin.user.manage')
  unlock(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
  ) {
    return this.users.unlock(actor, id, body.reason);
  }

  @Post('users/:id/roles')
  @RequirePermission('admin.role.assign')
  assignRole(
    @Req() req: Request,
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(assignSchema)) body: z.infer<typeof assignSchema>,
  ) {
    if (actor.mfaPolicyRequired && actor.mfaEnrolled && !this.auth.hasValidStepUp(req, actor.ref)) {
      throw new StepUpRequiredError();
    }
    return this.users.assignRole(actor, id, body);
  }

  @Post('users/:id/roles/:assignmentId/revoke')
  @RequirePermission('admin.role.assign')
  revokeRole(
    @Req() req: Request,
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body(zodPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
  ) {
    if (actor.mfaPolicyRequired && actor.mfaEnrolled && !this.auth.hasValidStepUp(req, actor.ref)) {
      throw new StepUpRequiredError();
    }
    return this.users.revokeRole(actor, id, assignmentId, body.reason);
  }

  @Post('users/:id/grants')
  @RequirePermission('admin.scope.grant')
  grant(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(grantSchema)) body: z.infer<typeof grantSchema>,
  ) {
    return this.users.grantScope(actor, id, body);
  }

  @Post('users/:id/sessions/revoke')
  @RequirePermission('admin.session.revoke')
  revokeSessions(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
  ) {
    return this.users.revokeSessions(actor, id, body.reason);
  }

  @Get('roles')
  @RequirePermission('admin.user.manage')
  roles(@CurrentActor() actor: ActorContext) {
    return this.users.listRoles(actor);
  }

  @Get('workflows/definitions')
  @RequirePermission('admin.health.view')
  workflowDefinitions(@CurrentActor() actor: ActorContext) {
    return this.ops.listWorkflowDefinitions(actor);
  }

  @Get('sla-thresholds')
  @RequirePermission('admin.health.view')
  slaThresholds(@CurrentActor() actor: ActorContext) {
    return this.ops.listSlaThresholds(actor);
  }

  @Get('notification-types')
  @RequirePermission('admin.user.manage')
  notificationTypes(@CurrentActor() actor: ActorContext) {
    return this.ops.listNotificationTypes(actor);
  }

  @Get('document-access')
  @RequirePermission('admin.health.view')
  documentAccess(
    @CurrentActor() actor: ActorContext,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.ops.documentAccess(
      actor,
      q ?? '',
      limit ? Number.parseInt(limit, 10) : 50,
      offset ? Number.parseInt(offset, 10) : 0,
    );
  }

  @Get('seals/verify')
  @RequirePermission('admin.health.view')
  verifySeals(@CurrentActor() actor: ActorContext, @Query('reference') reference?: string) {
    return this.ops.verifySealsByReference(actor, reference ?? '');
  }

  @Get('permission-changes')
  @RequirePermission('admin.permission_log.view')
  permissionChanges(
    @CurrentActor() actor: ActorContext,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.users.permissionChanges(
      actor,
      limit ? Number.parseInt(limit, 10) : 50,
      offset ? Number.parseInt(offset, 10) : 0,
    );
  }
}
