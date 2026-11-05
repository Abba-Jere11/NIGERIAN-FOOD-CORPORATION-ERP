import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { z } from 'zod';
import { CurrentActor } from '../auth/current-actor.decorator';
import { ActorOnly } from '../auth/require-permission.decorator';
import { zodPipe } from '../common/validation/zod-validation.pipe';
import { NotificationsService } from './notifications.service';

const preferenceSchema = z.object({
  category: z.string().trim().min(1),
  emailEnabled: z.boolean(),
});

@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ActorOnly()
  list(
    @CurrentActor() actor: ActorContext,
    @Query('unread') unread?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notifications.list(actor, unread === 'true' || unread === '1', limit ? Number(limit) : 100);
  }

  @Post('read-all')
  @ActorOnly()
  markAllRead(@CurrentActor() actor: ActorContext) {
    return this.notifications.markAllRead(actor);
  }

  @Get('unread-count')
  @ActorOnly()
  unreadCount(@CurrentActor() actor: ActorContext) {
    return this.notifications.unreadCount(actor);
  }

  @Get('preferences')
  @ActorOnly()
  preferences(@CurrentActor() actor: ActorContext) {
    return this.notifications.preferences(actor);
  }

  @Patch('preferences')
  @ActorOnly()
  setPreference(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(preferenceSchema)) body: z.infer<typeof preferenceSchema>,
  ) {
    return this.notifications.setPreference(actor, body.category, body.emailEnabled);
  }

  @Post(':id/read')
  @ActorOnly()
  markRead(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.setRead(actor, id, true);
  }

  @Post(':id/unread')
  @ActorOnly()
  markUnread(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.setRead(actor, id, false);
  }
}
