import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ActorContext } from '@nfc/db';
import type { Request } from 'express';
import { setContextActor } from '../common/request-context/request-context';
import { ActorService } from './actor.service';
import { PUBLIC_ROUTE_KEY } from './public.decorator';

export interface RequestWithActor extends Request {
  actor?: ActorContext;
}

/**
 * Resolves the acting identity on every request and attaches it to the request
 * and the request context, so that services and the audit engine can read it
 * without it being threaded through each call.
 *
 * Routes marked `@Public()` skip resolution. Everything else requires an actor.
 */
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
    return true;
  }
}
