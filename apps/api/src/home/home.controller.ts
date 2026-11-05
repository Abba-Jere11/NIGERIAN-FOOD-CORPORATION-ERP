import { Controller, Get } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { CurrentActor } from '../auth/current-actor.decorator';
import { ActorOnly } from '../auth/require-permission.decorator';
import { HomeService } from './home.service';

@Controller()
export class HomeController {
  constructor(private readonly home: HomeService) {}

  @Get('api/home/summary')
  @ActorOnly()
  summary(@CurrentActor() actor: ActorContext) {
    return this.home.summary(actor);
  }
}
