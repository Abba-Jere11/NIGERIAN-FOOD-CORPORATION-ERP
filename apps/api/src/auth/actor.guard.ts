import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ActorContext } from '@nfc/db';
import type { Request } from 'express';
import { ForbiddenError } from '../common/errors/domain-error';
import { setContextActor } from '../common/request-context/request-context';
import { ActorService } from './actor.service';
import { PUBLIC_ROUTE_KEY } from './public.decorator';

export interface RequestWithActor extends Request {
  actor?: ActorContext;
}

/** First-login onboarding: password change and MFA enrol may happen in either order. */
const ONBOARDING_ALLOW = [
  '/api/auth/change-password',
  '/api/auth/mfa/enrol',
  '/api/auth/mfa/enrol/confirm',
  '/api/auth/logout',
  '/api/auth/csrf',
  '/api/me',
];

@Injectable()
export class ActorGuard implements CanActivate {
  constructor(
    private readonly actorService: ActorService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithActor>();
    const actor = await this.actorService.resolveFromRequest(request);
    request.actor = actor;
    setContextActor(actor);

    const path = request.path;

    if (actor.mustChangePassword && !ONBOARDING_ALLOW.includes(path)) {
      throw new ForbiddenError('You must change your password before continuing.');
    }

    if (actor.mfaPolicyRequired && !actor.mfaEnrolled && !ONBOARDING_ALLOW.includes(path)) {
      throw new ForbiddenError('You must enrol an authenticator before continuing.');
    }

    return true;
  }
}
