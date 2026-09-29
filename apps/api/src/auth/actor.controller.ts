import { Controller, Get } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { type DevActorSummaryView, type MeView, permissionsForRole, ROLES } from '@nfc/shared';
import { ActorService } from './actor.service';
import { CurrentActor } from './current-actor.decorator';
import { EntityDirectory } from './entity-directory.service';
import { ActorOnly } from './require-permission.decorator';

@Controller('api')
export class ActorController {
  constructor(
    private readonly actorService: ActorService,
    private readonly directory: EntityDirectory,
  ) {}

  /** Who the caller is, what they may do, and which entities they can reach. */
  @Get('me')
  @ActorOnly()
  async me(@CurrentActor() actor: ActorContext): Promise<MeView> {
    const role = actor.role;
    const entities = await this.directory.all();
    const inScope = entities.filter((entity) => actor.entityIds.includes(entity.id));

    return {
      ref: actor.ref,
      name: actor.name,
      role,
      roleName: role ? ROLES[role].name : null,
      roleShortName: role ? ROLES[role].shortName : null,
      scopeType: actor.scopeType,
      isCorporate: actor.isCorporate,
      permissions: role ? permissionsForRole(role) : [],
      entities: inScope.map((entity) => ({
        id: entity.id,
        code: entity.code,
        name: entity.name,
        type: entity.type,
      })),
    };
  }

  /**
   * The demo actors available in this build. This endpoint exists only because
   * M1 has no authentication; M2 removes it along with the rest of the bridge.
   */
  @Get('dev-actors')
  @ActorOnly()
  devActors(): DevActorSummaryView[] {
    return this.actorService.listDevActors().map((actor) => ({
      key: actor.key,
      name: actor.name,
      position: actor.position,
      role: actor.role,
      roleShortName: ROLES[actor.role].shortName,
      scopeType: actor.scopeType,
      entityCode: actor.entityCode,
    }));
  }
}
