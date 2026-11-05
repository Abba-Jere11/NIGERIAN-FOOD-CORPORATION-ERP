import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type PermissionKey } from '@nfc/shared';
import { ForbiddenError, StepUpRequiredError } from '../common/errors/domain-error';
import type { RequestWithActor } from './actor.guard';
import { AuthService } from './auth.service';
import { assertCan } from './can';
import { PUBLIC_ROUTE_KEY } from './public.decorator';
import { ACTOR_ONLY_KEY, REQUIRED_PERMISSION_KEY } from './require-permission.decorator';

const STEP_UP_PERMISSIONS = new Set<PermissionKey>(['admin.role.assign']);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithActor>();

    const actorOnly = this.reflector.getAllAndOverride<boolean>(ACTOR_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (actorOnly) {
      if (!request.actor) {
        throw new ForbiddenError('You are not signed in.');
      }
      return true;
    }

    const permission = this.reflector.getAllAndOverride<PermissionKey | undefined>(
      REQUIRED_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!permission) {
      throw new ForbiddenError(
        'This endpoint declares no permission and is therefore refused. ' +
          'Add @RequirePermission(...) or @Public() to it.',
      );
    }

    assertCan(request.actor, permission);

    if (STEP_UP_PERMISSIONS.has(permission) && request.actor) {
      if (request.actor.mfaPolicyRequired && request.actor.mfaEnrolled) {
        if (!this.auth.hasValidStepUp(request, request.actor.ref)) {
          throw new StepUpRequiredError();
        }
      }
    }

    return true;
  }
}
