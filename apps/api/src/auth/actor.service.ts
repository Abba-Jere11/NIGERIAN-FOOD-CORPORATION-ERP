import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { DEV_ACTORS, type DevActor, findDevActor } from '@nfc/shared';
import type { Request } from 'express';
import { loadApiEnv } from '../config/env';
import { UnauthenticatedError } from '../common/errors/domain-error';
import { getRequestContext } from '../common/request-context/request-context';
import { EntityDirectory } from './entity-directory.service';

export const DEV_ACTOR_HEADER = 'x-dev-actor';

/**
 * Resolves the acting identity for a request.
 *
 * M1 has no users, authentication or sessions - they are listed under "Not in
 * this milestone" and arrive in M2. This service is the declared bridge: it
 * resolves one of the fixed demo actors from the `x-dev-actor` header, then
 * builds the same `ActorContext` that M2 will build from a real session. Every
 * role and scope check downstream, and every audit entry, works against that
 * context, so the enforcement being tested in M1 is genuine even though the
 * identity is not yet authenticated.
 *
 * It refuses to operate when `DEV_ACTOR_ENABLED` is false, and environment
 * validation refuses to boot at all with it enabled in production.
 */
@Injectable()
export class ActorService {
  constructor(private readonly directory: EntityDirectory) {}

  listDevActors(): readonly DevActor[] {
    return DEV_ACTORS;
  }

  async resolveFromRequest(req: Request): Promise<ActorContext> {
    const env = loadApiEnv();
    if (!env.DEV_ACTOR_ENABLED) {
      throw new UnauthenticatedError(
        'Authentication is not available in this build. Real sign-in arrives in M2.',
      );
    }

    const headerValue = req.headers[DEV_ACTOR_HEADER];
    const requestedKey =
      typeof headerValue === 'string' && headerValue.trim() !== ''
        ? headerValue.trim()
        : env.DEV_ACTOR_DEFAULT;

    const devActor = findDevActor(requestedKey);
    if (!devActor) {
      throw new UnauthenticatedError(
        `Unknown actor "${requestedKey}". Known actors: ${DEV_ACTORS.map((a) => a.key).join(', ')}.`,
      );
    }

    return this.toActorContext(devActor);
  }

  async toActorContext(devActor: DevActor): Promise<ActorContext> {
    const isCorporate = devActor.scopeType === 'CORPORATE';
    const entityIds = isCorporate
      ? await this.directory.allIds()
      : await this.entityIdsForCode(devActor.entityCode);

    const context = getRequestContext();

    return {
      ref: devActor.userId,
      name: devActor.name,
      role: devActor.role,
      scopeType: devActor.scopeType,
      entityIds,
      isCorporate,
      requestId: context?.requestId,
      sessionId: context?.sessionId ?? undefined,
      ipAddress: context?.ipAddress ?? undefined,
      userAgent: context?.userAgent ?? undefined,
    };
  }

  private async entityIdsForCode(code: string | null): Promise<string[]> {
    if (code === null) return [];
    const entity = await this.directory.byCode(code);
    if (!entity) {
      throw new UnauthenticatedError(
        `Entity ${code} is not present in the database. Run "pnpm db:seed" before using the API.`,
      );
    }
    return [entity.id];
  }
}
