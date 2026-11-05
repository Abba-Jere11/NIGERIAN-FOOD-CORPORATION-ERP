import { Controller, Get } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { CurrentActor } from './current-actor.decorator';
import { ActorOnly } from './require-permission.decorator';
import { AuthService } from './auth.service';

@Controller('api')
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get('me')
  @ActorOnly()
  me(@CurrentActor() actor: ActorContext) {
    return this.auth.meView(actor);
  }
}
