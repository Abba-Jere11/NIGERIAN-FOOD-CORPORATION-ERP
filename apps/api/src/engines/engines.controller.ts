import {
  Body,
  Controller,
  Get,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { z } from 'zod';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { zodPipe } from '../common/validation/zod-validation.pipe';
import { EnginesService } from './engines.service';
import { JobsService } from './jobs.service';
import { NotificationsService } from './notifications.service';

const createRecordSchema = z.object({
  title: z.string().trim().min(1),
  kind: z.string().trim().min(1).optional(),
  entityId: z.string().uuid().optional(),
});

@Controller()
export class EnginesController implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly engines: EnginesService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.jobs.start();
  }

  onModuleDestroy(): void {
    this.jobs.stop();
  }

  @Post('api/engine/records')
  @RequirePermission('organization.view')
  create(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createRecordSchema)) body: z.infer<typeof createRecordSchema>,
  ) {
    return this.engines.createRecord(actor, body);
  }

  @Get('api/engine/records/:id')
  @RequirePermission('organization.view')
  get(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.engines.getRecord(actor, id);
  }

  @Get('api/admin/reference-counters')
  @RequirePermission('admin.health.view')
  counters(@CurrentActor() actor: ActorContext) {
    return this.engines.listCounters(actor);
  }

  @Post('api/jobs/run')
  @RequirePermission('admin.health.view')
  runJobs() {
    return this.jobs.runOnce();
  }

  @Get('api/admin/ops')
  @RequirePermission('admin.health.view')
  async ops(@CurrentActor() actor: ActorContext) {
    const [deadLetters, failedNotificationDeliveries, failedMail, unread] = await Promise.all([
      this.jobs.deadLetters(),
      this.notifications.failedDeliveryCount(actor),
      this.notifications.failedMailCount(actor),
      this.notifications.unreadCount(actor),
    ]);
    return {
      deadLetters: deadLetters.map((row) => ({
        deliveryId: row.deliveryId,
        eventType: row.eventType,
        handlerKey: row.handlerKey,
        lastError: row.lastError,
        attempts: row.attempts,
        processedAt: row.processedAt?.toISOString() ?? null,
      })),
      failedNotificationDeliveries,
      failedMail,
      unreadNotifications: unread.count,
    };
  }
}
