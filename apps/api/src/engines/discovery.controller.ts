import { Controller, Get, Query } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { CurrentActor } from '../auth/current-actor.decorator';
import { ActorOnly, RequirePermission } from '../auth/require-permission.decorator';
import { SearchService } from './search.service';
import { TimelineService } from './timeline.service';
import { OverdueService } from './overdue.service';

@Controller()
export class DiscoveryController {
  constructor(
    private readonly search: SearchService,
    private readonly timeline: TimelineService,
    private readonly overdue: OverdueService,
  ) {}

  @Get('api/search')
  @ActorOnly()
  searchQuery(@CurrentActor() actor: ActorContext, @Query('q') q?: string) {
    return this.search.search(actor, q ?? '');
  }

  @Get('api/timeline')
  @ActorOnly()
  timelineQuery(
    @CurrentActor() actor: ActorContext,
    @Query('subjectType') subjectType?: string,
    @Query('subjectId') subjectId?: string,
  ) {
    return this.timeline.list(actor, subjectType ?? '', subjectId ?? '');
  }

  @Get('api/workflows/overdue')
  @RequirePermission('oversight.overdue.view')
  overdueQuery(@CurrentActor() actor: ActorContext) {
    return this.overdue.list(actor);
  }
}
