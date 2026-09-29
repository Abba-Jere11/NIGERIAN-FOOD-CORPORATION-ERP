import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ForbiddenError } from '../common/errors/domain-error';
import type { RequestWithActor } from './actor.guard';
import { assertCan } from './can';
import { PUBLIC_ROUTE_KEY } from './public.decorator';
import { ACTOR_ONLY_KEY, REQUIRED_PERMISSION_KEY } from './require-permission.decorator';
import type { PermissionKey } from '@nfc/shared';

/**
 * Enforces the declared permission for the route (rule R4).
 *
 * A route that declares no permission and is not public is refused outright,
 * so forgetting the decorator fails closed rather than exposing an endpoint.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

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

    // Entity-level scope is checked inside each service, where the entity the
    // request concerns is known. This is the role-level gate.
    assertCan(request.actor, permission);
    return true;
  }
}
