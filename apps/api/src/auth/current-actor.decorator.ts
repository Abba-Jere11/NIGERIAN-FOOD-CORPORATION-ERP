import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { UnauthenticatedError } from '../common/errors/domain-error';
import type { RequestWithActor } from './actor.guard';

/** Injects the resolved acting identity into a controller method. */
export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ActorContext => {
    const request = context.switchToHttp().getRequest<RequestWithActor>();
    if (!request.actor) {
      throw new UnauthenticatedError('No acting identity was resolved for this request.');
    }
    return request.actor;
  },
);
